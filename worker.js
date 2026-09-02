/**
 * Cloudflare Worker - 光遇每日任务数据中转服务
 * 
 * ⚠️ 重要：所有环境变量都必须配置，代码中没有默认值
 * 
 * 环境变量配置 (在 Cloudflare Workers 设置中添加):
 * 
 * 账号信息:
 * - SKY_UID: 你的用户ID
 * - SKY_GAME_UID: 你的游戏UID
 * - SKY_GAME_SERVER: 游戏服务器（如 8000）
 * - API_SECRET: 用于验证 GitHub Actions 请求的密钥
 * 
 * 缓存配置:
 * - CACHE_TTL: 缓存时长(秒)，推荐 3600 (1小时)
 * 
 * Sky API 配置:
 * - NETEASE_TOKEN_API: 获取 token 的 API 地址
 * - NETEASE_TASK_API: 获取每日任务的 API 地址
 * - NETEASE_EVENT_API: 获取活动数据的 API 地址
 * - NETEASE_TASK_ORIGIN: 任务 API 的 Origin 请求头
 * - NETEASE_TASK_REFERER: 任务 API 的 Referer 请求头
 * - NETEASE_USER_AGENT: User-Agent 请求头
 * - NETEASE_TOKEN_HOST: Token API 的 Host 请求头
 * 
 * 缓存策略:
 * - 使用 Cloudflare Cache API 存储响应
 * - 基于日期的缓存键，每天自动更新
 * - 同一天内多次请求返回缓存数据，避免频繁请求
 */

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

const REQUIRED_CONFIG = [
  'SKY_UID',
  'SKY_GAME_UID',
  'SKY_GAME_SERVER',
  'API_SECRET',
  'CACHE_TTL',
  'NETEASE_TOKEN_API',
  'NETEASE_TASK_API',
  'NETEASE_EVENT_API',
  'NETEASE_TASK_ORIGIN',
  'NETEASE_TASK_REFERER',
  'NETEASE_USER_AGENT',
  'NETEASE_TOKEN_HOST'
]

const UPSTREAM_TIMEOUT_MS = 30000

/**
 * 读取并校验 Worker 环境变量。
 * 经典 Service Worker 格式中的 bindings 可从 globalThis 访问。
 */
function getConfig() {
  const config = {}
  const missing = []

  for (const name of REQUIRED_CONFIG) {
    const value = globalThis[name]
    if (typeof value !== 'string' || value.trim() === '') {
      missing.push(name)
    } else {
      config[name] = value.trim()
    }
  }

  if (missing.length > 0) {
    throw new Error(`缺少必需的环境变量: ${missing.join(', ')}`)
  }

  config.SKY_GAME_SERVER = Number.parseInt(config.SKY_GAME_SERVER, 10)
  if (!Number.isInteger(config.SKY_GAME_SERVER)) {
    throw new Error('SKY_GAME_SERVER 必须是整数')
  }

  config.CACHE_TTL = Number.parseInt(config.CACHE_TTL, 10)
  if (!Number.isInteger(config.CACHE_TTL) || config.CACHE_TTL < 60 || config.CACHE_TTL > 86400) {
    throw new Error('CACHE_TTL 必须是 60 到 86400 之间的整数')
  }

  return config
}

/**
 * 对两个字符串的摘要进行完整比较，避免普通字符串比较的早退。
 * 这是低成本的防御性加固；真正的暴力破解防护仍然依赖高强度随机密钥和 Cloudflare 限速。
 */
async function timingSafeEqual(left, right) {
  const encoder = new TextEncoder()
  const leftBytes = encoder.encode(String(left))
  const rightBytes = encoder.encode(String(right))
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', leftBytes),
    crypto.subtle.digest('SHA-256', rightBytes)
  ])

  const leftView = new Uint8Array(leftDigest)
  const rightView = new Uint8Array(rightDigest)
  let difference = leftBytes.length ^ rightBytes.length
  for (let index = 0; index < leftView.length; index++) {
    difference |= leftView[index] ^ rightView[index]
  }
  return difference === 0
}

function getBeijingDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function handleRequest(request) {
  // CORS 预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      }
    })
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: '不支持的请求方法' }, 405, { Allow: 'GET, OPTIONS' })
  }

  let config
  try {
    config = getConfig()
  } catch (error) {
    console.error('❌ Worker 配置错误:', error)
    return jsonResponse({ error: '服务配置错误' }, 503)
  }

  // 验证请求来源，且必须在密钥配置成功后才进行比较。
  const authHeader = request.headers.get('Authorization') || ''
  if (!(await timingSafeEqual(authHeader, `Bearer ${config.API_SECRET}`))) {
    return jsonResponse({ error: '未授权访问' }, 401)
  }

  try {
    // 检查是否强制刷新缓存
    const url = new URL(request.url)
    const forceRefresh = url.searchParams.get('refresh') === 'true'
    
    // 生成今日缓存键（需要是完整的 URL）
    const today = getBeijingDate()
    const cacheUrl = new URL(request.url)
    cacheUrl.pathname = `/cache/sky-daily-${today}`
    cacheUrl.search = '' // 清除查询参数
    
    // 1. 尝试从缓存获取数据（除非强制刷新）
    if (!forceRefresh) {
      const cache = caches.default
      const cachedResponse = await cache.match(cacheUrl.toString())
      
      if (cachedResponse) {
        console.log('✅ 使用缓存数据')
        const data = await cachedResponse.json()
        return jsonResponse({
          ...data,
          cached: true,
          cacheTime: data.timestamp
        })
      }
    } else {
      console.log('🔄 强制刷新缓存')
    }

    console.log('🔄 缓存未命中，请求Sky API')

    // 2. 获取客服 token
    const token = await getKefuToken(config)
    if (!token) {
      return jsonResponse({ error: '获取token失败' }, 500)
    }

    // 3. 使用 token 获取每日任务
    const taskData = await getDailyTask(token, config)
    if (!taskData) {
      return jsonResponse({ error: '获取每日任务失败' }, 500)
    }

    // 4. 获取任务详情（先祖位置等）
    const taskDetails = await getTaskDetails(token, taskData, config)

    // 5. 获取今日活动
    const eventData = await getTodayEvents(config)

    // 6. 获取天气预报
    const weatherData = await getWeatherForecast(token, config)

    // 7. 获取日历图片
    const calendarData = await getCalendarImage(token, config)

    // 8. 组合数据
    const responseData = {
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        task: taskData,
        taskDetails: taskDetails,
        events: eventData,
        weather: weatherData,
        calendar: calendarData
      }
    }

    // 9. 存储到缓存
    const cacheTTL = config.CACHE_TTL
    const responseToCache = new Response(JSON.stringify(responseData), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${cacheTTL}`,
      }
    })
    
    // 将响应存入缓存
    const cache = caches.default
    await cache.put(cacheUrl.toString(), responseToCache.clone())
    console.log(`💾 数据已缓存，TTL: ${cacheTTL}秒`)

    // 8. 返回数据
    return jsonResponse({
      ...responseData,
      cached: false
    })

  } catch (error) {
    console.error('❌ 错误:', error)
    return jsonResponse({ error: '获取每日数据失败' }, 500)
  }
}

/**
 * 获取客服 Token
 */
async function getKefuToken(config) {
  const payload = {
    cmd: "kefu_get_token",
    uid: config.SKY_UID,
    game_uid: config.SKY_GAME_UID,
    os: "android",
    game_server: config.SKY_GAME_SERVER,
    login_from: 0,
    map: "CandleSpace",
    return_buff: "false"
  }

  try {
    const response = await fetchWithTimeout(config.NETEASE_TOKEN_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': config.NETEASE_USER_AGENT,
        'Host': config.NETEASE_TOKEN_HOST,
        'Accept-Encoding': 'gzip'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    
    if (data.status === "ok" && data.result) {
      const result = JSON.parse(data.result)
      return result.token
    }
    
    return null
  } catch (error) {
    console.error('获取token失败:', error)
    return null
  }
}

/**
 * 获取每日任务
 */
async function getDailyTask(token, config) {
  const payload = {
    question: "今日任务指南",
    gameId: "ma75",
    pid: "ma75"
  }

  try {
    const response = await fetchWithTimeout(config.NETEASE_TASK_API, {
      method: 'POST',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'origin': config.NETEASE_TASK_ORIGIN,
        'referer': config.NETEASE_TASK_REFERER,
        'token-type': 'gmsdk',
        'token': token
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    
    if (data.code === 200) {
      const cleanedText = cleanText(data.data.answer)
      return {
        title: '今日任务',
        answer: data.data.answer,
        rawAnswer: cleanedText,
        taskList: extractTaskList(cleanedText)
      }
    }
    
    return null
  } catch (error) {
    console.error('获取每日任务失败:', error)
    return null
  }
}

/**
 * 获取今日活动
 */
async function getTodayEvents(config) {
  try {
    const response = await fetchWithTimeout(config.NETEASE_EVENT_API)
    if (!response.ok) {
      return []
    }

    const events = await response.json()
    const todayDate = getBeijingDate()
    
    const todayEvents = []
    
    for (const event of events) {
      const schedules = event.schedules || []
      const todayTimes = schedules
        .filter(s => s.time.startsWith(todayDate))
        .map(s => {
          // 直接从 ISO 字符串中提取时间部分
          // 格式: 2025-10-25T08:00:00.000+08:00
          const match = s.time.match(/T(\d{2}):(\d{2})/)
          if (match) {
            return `${match[1]}:${match[2]}` // HH:MM
          }
          return ''
        })
        .filter(t => t) // 过滤空字符串
      
      if (todayTimes.length > 0) {
        todayEvents.push({
          title: event.title || "未知活动",
          description: event.description || "",
          location: event.location || "未知地点",
          times: todayTimes
        })
      }
    }
    
    return todayEvents
  } catch (error) {
    console.error('获取活动数据失败:', error)
    return []
  }
}

/**
 * 获取天气预报
 * 复用 NETEASE_TASK_API,只改变 question 参数
 */
async function getWeatherForecast(token, config) {
  const payload = {
    ismanual: 0,
    loginFrom: "sprite",
    method: "hotNews",
    question: "天气预报"
  }

  try {
    const response = await fetchWithTimeout(config.NETEASE_TASK_API, {
      method: 'POST',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'origin': config.NETEASE_TASK_ORIGIN,
        'referer': config.NETEASE_TASK_REFERER,
        'token-type': 'gmsdk',
        'token': token
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    
    if (data.code === 200 && data.data && data.data.answer) {
      // 从 HTML 响应中提取图片和文字
      const htmlText = data.data.answer
      
      // 提取图片URL (过滤广告图片)
      const imgRegex = /<img\s+src="([^"]+)"/g
      const images = []
      const imageBlacklist = [
        '154572ba48115878409a93239e5028e54f392adb.gif', // 点赞表情包
      ]
      
      let match
      while ((match = imgRegex.exec(htmlText)) !== null) {
        const imgUrl = match[1]
        // 检查是否包含黑名单中的图片
        const isBlacklisted = imageBlacklist.some(blocked => imgUrl.includes(blocked))
        if (!isBlacklisted) {
          images.push(imgUrl)
        }
      }
      
      // 提取文字内容
      const textOnly = htmlText
        .replace(/<img[^>]*>/g, '') // 移除图片标签
        .replace(/<[^>]+>/g, '') // 移除所有 HTML 标签
        .replace(/&nbsp;/g, ' ') // 替换 &nbsp;
        .replace(/#r/g, '\n') // 替换换行控制字符
        .replace(/#n/g, '') // 移除 #n
        .replace(/#c[0-9a-fA-F]{6}/g, '') // 移除颜色代码 (如 #cffb6f9)
        .trim()
      
      // 提取 "天气播报：..." 这一行
      const lines = textOnly.split('\n').filter(line => line.trim())
      const weatherLine = lines.find(line => line.includes('天气播报'))
      
      if (weatherLine) {
        return {
          text: weatherLine.trim(),
          images: images
        }
      }
      
      return null
    }
    
    return null
  } catch (error) {
    console.error('获取天气预报失败:', error)
    return null
  }
}

/**
 * 通用查询函数 - 查询任意问题
 */
async function queryKnowledge(token, question, method = "link", config) {
  const payload = {
    ismanual: 0,
    loginFrom: "sprite",
    method: method,
    question: question
  }

  try {
    const response = await fetchWithTimeout(config.NETEASE_TASK_API, {
      method: 'POST',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'origin': config.NETEASE_TASK_ORIGIN,
        'referer': config.NETEASE_TASK_REFERER,
        'token-type': 'gmsdk',
        'token': token
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    
    if (data.code === 200 && data.data && data.data.answer) {
      // 提取所有图片URL (过滤广告图片)
      const imgRegex = /<img\s+src="([^"]+)"/g
      const images = []
      const imageBlacklist = [
        '154572ba48115878409a93239e5028e54f392adb.gif', // 点赞表情包
      ]
      
      let match
      while ((match = imgRegex.exec(data.data.answer)) !== null) {
        const imgUrl = match[1]
        // 检查是否包含黑名单中的图片
        const isBlacklisted = imageBlacklist.some(blocked => imgUrl.includes(blocked))
        if (!isBlacklisted) {
          images.push(imgUrl)
        }
      }
      
      // 提取文字内容
      let textContent = data.data.answer
        .replace(/<[^>]*>/g, '')
        .replace(/#r/g, '\n')
        .replace(/#c[0-9a-fA-F]{6}/g, '')
        .replace(/#n/g, '')
        .trim()
      
      // 清理多余的空行和提示文字
      const lines = textContent.split('\n').filter(line => {
        line = line.trim()
        return line && 
               !line.includes('===') && 
               !line.includes('点个赞') &&
               !line.includes('看不了图片') &&
               !line.includes('温馨提示')
      })
      
      return {
        title: data.data.knowledge?.title || question,
        text: lines.join('\n'),
        images: images,
        rawAnswer: data.data.answer
      }
    }
    
    return null
  } catch (error) {
    console.error(`查询 ${question} 失败:`, error)
    return null
  }
}

/**
 * 获取日历图片
 */
async function getCalendarImage(token, config) {
  return await queryKnowledge(token, "日历", "link", config)
}

/**
 * 获取任务详情 - 解析任务中的关键词链接
 */
async function getTaskDetails(token, taskData, config) {
  if (!taskData || !taskData.answer) {
    return []
  }
  
  // 提取所有 <a> 标签中的 question
  const linkRegex = /<a\s+href="[^"]*q=([^"&]+)"[^>]*data-ask="true"/g
  const keywords = []
  let match
  
  // 需要过滤的关键词（广告和无用内容）
  const blacklist = [
    '专属客服',
    '客服',
    '在线',
    '7×8',
    '光遇小生',
    '表情包',
    '精灵表情包'
  ]
  
  while ((match = linkRegex.exec(taskData.answer)) !== null) {
    const keyword = decodeURIComponent(match[1])
    
    // 检查是否包含黑名单关键词
    const isBlacklisted = blacklist.some(blocked => keyword.includes(blocked))
    
    if (!isBlacklisted) {
      keywords.push(keyword)
    }
  }
  
  // 查询每个关键词的详情
  const details = []
  for (const keyword of keywords) {
    const result = await queryKnowledge(token, keyword, "link", config)
    if (result) {
      details.push({
        keyword: keyword,
        ...result
      })
    }
  }
  
  return details
}

/**
 * 清理 HTML 标签和游戏标记，并提取纯净的任务列表
 */
function cleanText(html) {
  let text = html
  // 解码 HTML 实体
  text = text.replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
  
  // 替换游戏内标记
  text = text.replace(/#r/g, '\n')
  text = text.replace(/#c[0-9a-fA-F]{6}/g, '')
  text = text.replace(/#n/g, '')
  
  // 去除 HTML 标签
  text = text.replace(/<[^>]*>/g, '')
  
  // 清除多余空行
  text = text.replace(/\n{3,}/g, '\n\n')
  
  // 提取【今日旅行指南】到第5行任务为止
  const guideMatch = text.match(/【今日旅行指南】([\s\S]*?)(?:【|$)/)
  if (guideMatch) {
    text = '【今日旅行指南】' + guideMatch[1]
  }
  
  // 只保留以数字开头的任务行和标题
  const lines = text.split('\n')
  const cleanedLines = []
  let taskCount = 0
  
  for (let line of lines) {
    line = line.trim()
    
    // 保留标题行
    if (line.startsWith('【今日旅行指南】')) {
      cleanedLines.push(line)
      continue
    }
    
    // 保留数字开头的任务（1. 2. 3. 等）
    if (/^\d+\./.test(line)) {
      taskCount++
      
      // 如果是第5行任务，直接停止处理
      if (taskCount >= 5) {
        break
      }
      
      // 去掉链接提示文字（如 >>祝福位置）
      line = line.replace(/\s*[>》]+.*$/, '')
      cleanedLines.push(line)
    }
  }
  
  return cleanedLines.join('\n').trim()
}

/**
 * 从清理后的文本中提取任务列表数组
 */
function extractTaskList(cleanedText) {
  const lines = cleanedText.split('\n')
  const tasks = []
  
  for (let line of lines) {
    line = line.trim()
    // 提取数字开头的任务
    const match = line.match(/^(\d+)\.(.+)$/)
    if (match) {
      const taskNumber = parseInt(match[1])
      const taskText = match[2].trim()
      
      tasks.push({
        number: taskNumber,
        task: taskText
      })
    }
  }
  
  // cleanText 函数已经在第5行前停止，这里返回所有提取到的任务
  return tasks
}

/**
 * 返回 JSON 响应
 */
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    }
  })
}
