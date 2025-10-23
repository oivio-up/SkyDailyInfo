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
 * - NETEASE_WEATHER_API: 获取天气预报的 API 地址
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

async function handleRequest(request) {
  // CORS 预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    })
  }

  // 验证请求来源
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${API_SECRET}`) {
    return jsonResponse({ error: '未授权访问' }, 401)
  }

  try {
    // 检查是否强制刷新缓存
    const url = new URL(request.url)
    const forceRefresh = url.searchParams.get('refresh') === 'true'
    
    // 生成今日缓存键（需要是完整的 URL）
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
    const cacheUrl = new URL(request.url)
    cacheUrl.pathname = `/cache/sky-daily-${today}`
    cacheUrl.search = '' // 清除查询参数
    
    // 1. 尝试从缓存获取数据（除非强制刷新）
    if (!forceRefresh) {
      const cache = caches.default
      let cachedResponse = await cache.match(cacheUrl.toString())
      
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
    const token = await getKefuToken()
    if (!token) {
      return jsonResponse({ error: '获取token失败' }, 500)
    }

    // 3. 使用 token 获取每日任务
    const taskData = await getDailyTask(token)
    if (!taskData) {
      return jsonResponse({ error: '获取每日任务失败' }, 500)
    }

    // 4. 获取任务详情（先祖位置等）
    const taskDetails = await getTaskDetails(token, taskData)

    // 5. 获取今日活动
    const eventData = await getTodayEvents()

    // 6. 获取天气预报
    const weatherData = await getWeatherForecast(token)

    // 7. 获取日历图片
    const calendarData = await getCalendarImage(token)

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
    const cacheTTL = parseInt(CACHE_TTL) // 缓存时长（秒）
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
    return jsonResponse({ error: error.message }, 500)
  }
}

/**
 * 获取客服 Token
 */
async function getKefuToken() {
  // 所有配置必须通过环境变量传入
  if (!NETEASE_TOKEN_API || !NETEASE_USER_AGENT || !NETEASE_TOKEN_HOST) {
    throw new Error('缺少必需的 API 配置环境变量')
  }
  
  const payload = {
    cmd: "kefu_get_token",
    uid: SKY_UID,
    game_uid: SKY_GAME_UID,
    os: "android",
    game_server: parseInt(SKY_GAME_SERVER),
    login_from: 0,
    map: "CandleSpace",
    return_buff: "false"
  }

  try {
    const response = await fetch(NETEASE_TOKEN_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': NETEASE_USER_AGENT,
        'Host': NETEASE_TOKEN_HOST,
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
async function getDailyTask(token) {
  // 必须通过环境变量传入
  if (!NETEASE_TASK_API || !NETEASE_TASK_ORIGIN || !NETEASE_TASK_REFERER) {
    throw new Error('缺少必需的任务 API 配置环境变量')
  }
  
  const payload = {
    question: "今日任务指南",
    gameId: "ma75",
    pid: "ma75"
  }

  try {
    const response = await fetch(NETEASE_TASK_API, {
      method: 'POST',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'origin': NETEASE_TASK_ORIGIN,
        'referer': NETEASE_TASK_REFERER,
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
async function getTodayEvents() {
  // 必须通过环境变量传入
  if (!NETEASE_EVENT_API) {
    throw new Error('缺少 NETEASE_EVENT_API 环境变量')
  }
  
  try {
    const response = await fetch(NETEASE_EVENT_API)
    if (!response.ok) {
      return []
    }

    const events = await response.json()
    const today = new Date()
    const todayDate = today.toISOString().split('T')[0]
    
    const todayEvents = []
    
    for (const event of events) {
      const schedules = event.schedules || []
      const todayTimes = schedules
        .filter(s => s.time.startsWith(todayDate))
        .map(s => {
          const time = new Date(s.time)
          return time.toTimeString().slice(0, 5) // HH:MM
        })
      
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
async function getWeatherForecast(token) {
  // 复用任务 API 的配置
  if (!NETEASE_TASK_API || !NETEASE_TASK_ORIGIN || !NETEASE_TASK_REFERER) {
    throw new Error('缺少必需的 API 配置环境变量')
  }
  
  const payload = {
    ismanual: 0,
    loginFrom: "sprite",
    method: "hotNews",
    question: "天气预报"
  }

  try {
    const response = await fetch(NETEASE_TASK_API, {
      method: 'POST',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'origin': NETEASE_TASK_ORIGIN,
        'referer': NETEASE_TASK_REFERER,
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
      // 从 HTML 响应中提取纯文本
      const htmlText = data.data.answer
      
      // 移除 HTML 标签
      const textOnly = htmlText
        .replace(/<img[^>]*>/g, '') // 移除图片标签
        .replace(/<[^>]+>/g, '') // 移除所有 HTML 标签
        .replace(/&nbsp;/g, ' ') // 替换 &nbsp;
        .replace(/#[rn]/g, '\n') // 替换控制字符
        .trim()
      
      // 提取 "天气播报：..." 这一行
      const lines = textOnly.split('\n').filter(line => line.trim())
      const weatherLine = lines.find(line => line.includes('天气播报'))
      
      if (weatherLine) {
        return weatherLine.trim()
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
async function queryKnowledge(token, question, method = "link") {
  if (!NETEASE_TASK_API || !NETEASE_TASK_ORIGIN || !NETEASE_TASK_REFERER) {
    throw new Error('缺少必需的 API 配置环境变量')
  }
  
  const payload = {
    ismanual: 0,
    loginFrom: "sprite",
    method: method,
    question: question
  }

  try {
    const response = await fetch(NETEASE_TASK_API, {
      method: 'POST',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'origin': NETEASE_TASK_ORIGIN,
        'referer': NETEASE_TASK_REFERER,
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
      // 提取所有图片URL
      const imgRegex = /<img\s+src="([^"]+)"/g
      const images = []
      let match
      while ((match = imgRegex.exec(data.data.answer)) !== null) {
        images.push(match[1])
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
async function getCalendarImage(token) {
  return await queryKnowledge(token, "日历", "link")
}

/**
 * 获取任务详情 - 解析任务中的关键词链接
 */
async function getTaskDetails(token, taskData) {
  if (!taskData || !taskData.answer) {
    return []
  }
  
  // 提取所有 <a> 标签中的 question
  const linkRegex = /<a\s+href="[^"]*q=([^"&]+)"[^>]*data-ask="true"/g
  const keywords = []
  let match
  
  while ((match = linkRegex.exec(taskData.answer)) !== null) {
    const keyword = decodeURIComponent(match[1])
    keywords.push(keyword)
  }
  
  // 查询每个关键词的详情
  const details = []
  for (const keyword of keywords) {
    const result = await queryKnowledge(token, keyword, "link")
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
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  })
}
