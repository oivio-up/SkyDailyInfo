const $ = id => document.getElementById(id)
let journal = null
const beijingDate = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(date)

function safeUrl(value) {
  try {
    const url = new URL(value, location.href)
    if (url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === location.origin)) return url.href
  } catch {}
  return null
}

function paragraph(text, className = '') {
  const element = document.createElement('p')
  element.textContent = text
  element.className = className
  return element
}

function showImages(target, images, label) {
  target.replaceChildren()
  for (const [index, image] of (images || []).entries()) {
    const src = safeUrl(image.src)
    const source = safeUrl(image.source)
    if (!src) continue
    const figure = document.createElement('figure')
    const link = document.createElement('a')
    link.href = source || src
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.setAttribute('aria-label', `${label} ${index + 1}，打开原图`)
    const img = document.createElement('img')
    img.src = src
    img.alt = `${label} ${index + 1}`
    img.loading = 'lazy'
    img.decoding = 'async'
    img.addEventListener('error', () => {
      link.replaceChildren(paragraph('图片暂时无法加载，点击查看原图 ↗', 'image-failure'))
    }, { once: true })
    link.append(img)
    const caption = document.createElement('figcaption')
    caption.textContent = '点击图片，查看原图 ↗'
    figure.append(link, caption)
    target.append(figure)
  }
}

function guideText(target, text) {
  for (const line of (text || '').split('\n').filter(line => line.trim())) {
    const row = document.createElement('p')
    let end = 0
    for (const match of line.matchAll(/https?:\/\/[^\s<>]+/g)) {
      row.append(document.createTextNode(line.slice(end, match.index)))
      const href = safeUrl(match[0])
      if (href) {
        const link = document.createElement('a')
        link.href = href
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.textContent = /\.mp4(?:\?|$)/i.test(href) ? '观看视频 ↗' : '查看原文 ↗'
        row.append(link)
      }
      end = match.index + match[0].length
    }
    row.append(document.createTextNode(line.slice(end)))
    target.append(row)
  }
}

function render(data) {
  journal = data
  const date = new Date(`${data.date}T12:00:00+08:00`)
  if (!Number.isFinite(date.getTime()) || !Array.isArray(data.tasks)) throw new Error('Invalid journal')
  $('date-label').textContent = new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'}).format(date)
  $('updated').textContent = `最近更新 ${new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}).format(new Date(data.updatedAt))} · 北京时间`
  $('notice').hidden = data.date === beijingDate(new Date())
  $('notice').textContent = `当前显示 ${data.date} 的手册，今天的数据尚未更新。`

  const storageKey = `sky-journal:${data.date}`
  let saved = []
  try { saved = JSON.parse(localStorage.getItem(storageKey) || '[]'); if (!Array.isArray(saved)) saved = [] } catch {}
  $('task-list').replaceChildren()
  for (const task of data.tasks) {
    const row = document.createElement('label')
    row.className = 'task-row'
    const check = document.createElement('input')
    check.type = 'checkbox'
    check.checked = saved.includes(task.text)
    const number = document.createElement('span')
    number.className = 'task-number'
    number.textContent = String(task.number).padStart(2, '0')
    number.setAttribute('aria-hidden', 'true')
    const text = document.createElement('span')
    text.className = 'task-text'
    text.textContent = task.text
    check.addEventListener('change', () => {
      const completed = [...$('task-list').querySelectorAll('input:checked')].map(input => input.parentElement.querySelector('.task-text').textContent)
      try { localStorage.setItem(storageKey, JSON.stringify(completed)) } catch { $('feedback').textContent = '本次勾选仅在当前页面保留。' }
      updateProgress()
    })
    row.append(check, number, text)
    $('task-list').append(row)
  }
  $('task-empty').hidden = data.tasks.length > 0
  $('copy-tasks').disabled = data.tasks.length === 0
  updateProgress()

  $('weather-text').textContent = data.weather?.text || '暂时没有天气播报。'
  showImages($('weather-images'), data.weather?.images, '天气与碎片')
  showImages($('calendar-images'), data.calendar?.images, '本月日历')
  if (!data.calendar?.images?.length) $('calendar-images').append(paragraph('本月日历暂未更新。', 'empty'))

  $('guide-list').replaceChildren()
  for (const [index, detail] of (data.details || []).entries()) {
    const guide = document.createElement('details')
    guide.className = 'guide'
    guide.open = index === 0
    const summary = document.createElement('summary')
    summary.textContent = detail.title || detail.keyword
    const body = document.createElement('div')
    body.className = 'guide-body'
    const text = document.createElement('div')
    text.className = 'guide-text'
    guideText(text, detail.text)
    const images = document.createElement('div')
    images.className = 'image-list'
    showImages(images, detail.images, detail.title)
    body.append(text, images)
    guide.append(summary, body)
    $('guide-list').append(guide)
  }
  if (!data.details?.length) $('guide-list').append(paragraph('今天暂无额外攻略。', 'empty'))
  $('event-list').replaceChildren()
  for (const event of data.events || []) {
    const article = document.createElement('article')
    article.className = 'event'
    const title = document.createElement('h3')
    title.textContent = event.title
    article.append(title, paragraph(event.description), paragraph(`地点 · ${event.location}`), paragraph((event.times || []).join(' / '), 'event-times'))
    $('event-list').append(article)
  }
  if (!data.events?.length) $('event-list').append(paragraph('今日暂无特殊活动，按自己的节奏旅行吧。', 'empty'))
  $('content').hidden = false
}

function updateProgress() {
  const total = journal.tasks.length
  const done = $('task-list').querySelectorAll('input:checked').length
  $('progress-text').textContent = total && done === total ? '今日任务已完成，愿你满载而归。' : `已完成 ${done} / ${total}`
  $('progress-bar').style.transform = `scaleX(${total ? done / total : 0})`
}

async function load() {
  $('error').hidden = true
  $('retry').disabled = true
  try {
    const response = await fetch('data.json', {cache: 'no-cache'})
    if (!response.ok) throw new Error('Data unavailable')
    render(await response.json())
  } catch {
    $('content').hidden = true
    $('error').hidden = false
    $('date-label').textContent = '旅行手册暂时无法加载'
  } finally { $('retry').disabled = false }
}

$('retry').addEventListener('click', load)
$('copy-tasks').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(`光遇 ${journal.date} 今日任务\n${journal.tasks.map(task => `${task.number}. ${task.text}`).join('\n')}`)
    $('feedback').textContent = '今日任务已复制。'
  } catch { $('feedback').textContent = '复制未成功，请长按任务文字复制。' }
})
load()
