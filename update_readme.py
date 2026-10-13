#!/usr/bin/env python3
"""
光遇每日任务 README 更新脚本
从 Cloudflare Worker 获取数据并更新 README.md
"""

import os
import re
import sys
import json
from pathlib import Path
from datetime import datetime, timezone, timedelta
from urllib.parse import urlsplit
from html import unescape

import requests
from image_store import ImageStore
from task_content import filter_task_details


# Windows 的旧默认终端编码无法输出日志中的 emoji。
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, 'reconfigure'):
        stream.reconfigure(encoding='utf-8')

# 从环境变量获取配置
WORKER_URL = os.environ.get('WORKER_URL')
API_SECRET = os.environ.get('API_SECRET')

START_MARKER = "<!-- DAILY_TASK_START -->"
END_MARKER = "<!-- DAILY_TASK_END -->"
MAX_RESPONSE_BYTES = 5 * 1024 * 1024
REQUEST_TIMEOUT = (10, 60)


def sanitize_text(value):
    """移除会破坏 README 自动更新区域的控制内容。"""
    if value is None:
        return ''

    return (str(value)
            .replace('\x00', '')
            .replace(START_MARKER, '')
            .replace(END_MARKER, '')
            .replace('```', "'''"))


def safe_image_url(value):
    """只允许 README 引用 HTTPS 图片。"""
    if not isinstance(value, str):
        return None

    url = unescape(value.strip())
    try:
        parsed = urlsplit(url)
    except ValueError:
        return None
    # 网易历史资料也可能返回 HTTP；同一 CDN 支持 HTTPS。
    if parsed.scheme == 'http' and parsed.hostname == 'ok.166.net':
        url = 'https:' + url[5:]
        parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.netloc:
        return None

    return url.replace('(', '%28').replace(')', '%29')

def fetch_daily_data():
    """从 Cloudflare Worker 获取每日数据"""
    if not WORKER_URL or not API_SECRET:
        print("错误: 未设置 WORKER_URL 或 API_SECRET 环境变量")
        sys.exit(1)
    
    headers = {
        'Authorization': f'Bearer {API_SECRET}',
        'Content-Type': 'application/json'
    }
    
    try:
        print(f"正在请求 Worker: {WORKER_URL}")
        response = requests.get(
            WORKER_URL,
            headers=headers,
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        if len(response.content) > MAX_RESPONSE_BYTES:
            raise ValueError("Worker 响应超过 5 MiB 限制")

        data = response.json()
        
        if not isinstance(data, dict) or not data.get('success'):
            error_message = data.get('error', '未知错误') if isinstance(data, dict) else '响应不是 JSON 对象'
            print(f"Worker 返回错误: {error_message}")
            sys.exit(1)

        if not isinstance(data.get('data'), dict):
            raise ValueError("Worker 响应缺少 data 对象")

        payload = data['data']
        if not isinstance(payload.get('task'), dict):
            raise ValueError("Worker 响应缺少有效的 task 对象")
        
        # 显示缓存状态
        if data.get('cached'):
            print(f"✅ 使用缓存数据 (缓存时间: {data.get('cacheTime', 'N/A')})")
        else:
            print(f"🔄 从网易 API 获取新数据")
        
        return payload
    except (requests.exceptions.RequestException, ValueError) as e:
        print(f"请求失败: {e}")
        sys.exit(1)

def extract_tasks(task_data):
    """提取任务列表（使用 Worker 已处理好的数据）"""
    if not isinstance(task_data, dict):
        return ''

    # 如果有 taskList，直接格式化
    if 'taskList' in task_data and task_data['taskList']:
        tasks = []
        tasks.append('【今日旅行指南】')
        for task in task_data['taskList']:
            if not isinstance(task, dict):
                continue
            number = task.get('number')
            text = sanitize_text(task.get('task')).strip()
            if isinstance(number, int) and text:
                tasks.append(f"{number}. {text}")
        return '\n'.join(tasks)
    
    # 否则使用 rawAnswer
    return sanitize_text(task_data.get('rawAnswer', ''))

def format_events(events):
    """格式化活动列表"""
    if not isinstance(events, list) or not events:
        return "今日暂无特殊活动"
    
    result = []
    for event in events:
        if not isinstance(event, dict):
            continue
        times = ', '.join(sanitize_text(item) for item in event.get('times', []))
        title = sanitize_text(event.get('title', '未知活动')).strip()
        description = sanitize_text(event.get('description', '')).strip()
        location = sanitize_text(event.get('location', '未知地点')).strip()
        result.append(f"**{title}** - {description}")
        result.append(f"- 时间: {times}")
        result.append(f"- 地点: {location}")
        result.append("")
    
    return '\n'.join(result)

def format_weather(weather_data):
    """格式化天气预报 - 包含文字和图片"""
    if not weather_data:
        return None, None
    
    # 处理字典格式(包含 text 和 images)
    if isinstance(weather_data, dict):
        text = sanitize_text(weather_data.get('text', ''))
        images = [url for item in weather_data.get('images', [])
                  if (url := safe_image_url(item))]
        return text, images
    
    # 兼容旧的纯文本格式
    return sanitize_text(weather_data), []

def format_task_details(details_list, image_store=None):
    """格式化任务详情（先祖位置等）"""
    if not isinstance(details_list, list) or not details_list:
        return ""
    
    result = []
    for detail in details_list:
        if not isinstance(detail, dict):
            continue
        keyword = sanitize_text(detail.get('keyword', '')).strip()
        title = sanitize_text(detail.get('title', keyword)).strip()
        
        result.append(f"\n#### 📍 {title}")
        
        # 添加文字内容
        text = sanitize_text(detail.get('text', '')).strip()
        if text:
            result.append(f"\n{text}\n")
        
        # 添加图片
        images = detail.get('images', [])
        if images:
            result.append("")  # 空行
            for i, img_url in enumerate(images):
                safe_url = safe_image_url(img_url)
                if safe_url:
                    label = f'{keyword}-{i+1}'
                    result.append(image_store.render(label, safe_url) if image_store
                                  else f'![{label}]({safe_url})')
        
        result.append("\n---\n")  # 分隔线
    
    return '\n'.join(result)

def format_calendar(calendar_data, image_store=None):
    """格式化日历图片"""
    if not isinstance(calendar_data, dict) or not calendar_data:
        return ""
    
    images = [url for item in calendar_data.get('images', [])
              if (url := safe_image_url(item))]
    if not images:
        return ""
    
    # 显示第一张日历图片
    return (image_store.render('光遇日历', images[0]) if image_store
            else f'![光遇日历]({images[0]})')

def update_readme(task_data, events_data, weather_data, task_details=None, calendar_data=None,
                  image_store=None, prune_images=True):
    """更新 README.md 文件"""
    readme_path = 'README.md'
    
    # 读取现有 README
    try:
        with open(readme_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except FileNotFoundError:
        print("README.md 不存在，将创建新文件")
        content = ""
    
    # 获取北京时间
    beijing_tz = timezone(timedelta(hours=8))
    now = datetime.now(beijing_tz)
    date_str = now.strftime('%Y年%m月%d日')
    time_str = now.strftime('%H:%M:%S')
    
    # 提取任务内容
    tasks = extract_tasks(task_data)
    
    # 格式化活动
    events = format_events(events_data)
    image_store = image_store or ImageStore()
    task_details = filter_task_details(task_data, task_details)
    
    # 格式化天气 (返回文字和图片)
    weather_text, weather_images = format_weather(weather_data)
    
    # 格式化任务详情
    details = format_task_details(task_details, image_store) if task_details else ""
    
    # 格式化日历
    calendar = format_calendar(calendar_data, image_store) if calendar_data else ""
    
    # 生成天气部分
    weather_section = ""
    if weather_text:
        weather_section = f"""
### 🌤️ 天气预报

{weather_text}

"""
        # 添加天气图片
        if weather_images:
            for img_url in weather_images:
                weather_section += image_store.render('天气预报', img_url) + '\n\n'
    
    # 生成日历部分
    calendar_section = ""
    if calendar:
        calendar_section = f"""
### 📅 本月日历

{calendar}

"""
    
    # 生成任务详情部分
    details_section = ""
    if details:
        details_section = f"""
### 📖 任务详细攻略

{details}
"""
    
    new_section = f"""## 📅 {date_str} 每日任务

> 最后更新: {date_str} {time_str} (北京时间)

### 🎯 今日旅行指南

```
{tasks}
```
{weather_section}{calendar_section}{details_section}
### 🎪 今日活动

{events}

---

"""
    
    # 替换或插入内容
    # 查找标记位置
    if START_MARKER in content and END_MARKER in content:
        # 替换现有内容
        pattern = f"{re.escape(START_MARKER)}.*?{re.escape(END_MARKER)}"
        new_content = re.sub(
            pattern,
            lambda _: f"{START_MARKER}\n{new_section}{END_MARKER}",
            content,
            flags=re.DOTALL
        )
    else:
        # 如果没有标记，在文件末尾添加
        if not content.strip().endswith('---'):
            content += '\n\n---\n\n'
        new_content = content + f"\n{START_MARKER}\n{new_section}{END_MARKER}\n"
    
    # 写入文件
    with open(readme_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    if prune_images:
        image_store.prune()
    
    print(f"✅ README.md 已更新 ({date_str} {time_str})")
    if task_details:
        print(f"   📍 包含 {len(task_details)} 个任务详情")
    if calendar_data:
        print(f"   📅 包含本月日历")

def build_public_data(data, image_store, now=None):
    """明确选取公开字段，绝不序列化 Worker 原始响应或环境配置。"""
    now = now or datetime.now(timezone(timedelta(hours=8)))
    def images(items):
        result = []
        for item in items if isinstance(items, list) else []:
            url = safe_image_url(item)
            if url:
                result.append({'src': image_store.save(url) or url, 'source': url})
        return result

    task_data = data.get('task', {})
    tasks = []
    for line in extract_tasks(task_data).splitlines():
        match = re.match(r'^\s*([1-4])[.．、]\s*(.+)', line)
        if match:
            tasks.append({'number': int(match[1]), 'text': match[2].strip()})
    weather_text, weather_images = format_weather(data.get('weather'))
    calendar = data.get('calendar')
    details = []
    for detail in filter_task_details(task_data, data.get('taskDetails')):
        details.append({
            'keyword': sanitize_text(detail.get('keyword', '')),
            'title': sanitize_text(detail.get('title') or detail.get('keyword', '')),
            'text': sanitize_text(detail.get('text', '')),
            'images': images(detail.get('images')),
        })
    events = []
    for event in data.get('events') or []:
        if isinstance(event, dict):
            events.append({
                'title': sanitize_text(event.get('title', '')),
                'description': sanitize_text(event.get('description', '')),
                'location': sanitize_text(event.get('location', '')),
                'times': [sanitize_text(time) for time in event.get('times', [])],
            })
    return {
        'date': now.strftime('%Y-%m-%d'),
        'updatedAt': now.isoformat(),
        'tasks': tasks,
        'weather': {'text': weather_text or '', 'images': images(weather_images)},
        'calendar': {'images': images(calendar.get('images')) if isinstance(calendar, dict) else []},
        'details': details,
        'events': events,
    }


def write_site_data(data, image_store):
    path = Path('site/data.json')
    path.parent.mkdir(parents=True, exist_ok=True)
    public_data = build_public_data(data, image_store)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(public_data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)
    print('✅ 网页数据已更新')


def main():
    print("🌤 开始更新光遇每日任务...")
    
    # 获取数据
    data = fetch_daily_data()
    print("✅ 成功获取数据")
    
    image_store = ImageStore()
    write_site_data(data, image_store)
    if os.environ.get('UPDATE_README', 'true').lower() != 'false':
        update_readme(
            data.get('task', {}), data.get('events', []), data.get('weather'),
            data.get('taskDetails'), data.get('calendar'), image_store, prune_images=False,
        )
    # 网页单独更新时保留现有 README 引用，避免使它的图片失效。
    if Path('README.md').exists():
        content = Path('README.md').read_text(encoding='utf-8')
        for reference in re.findall(r'!\[[^\]]*\]\((assets/daily/[0-9a-f]{64}\.(?:png|jpg|gif|webp))\)', content):
            image_store.used.add(Path(reference))
    image_store.prune()
    print("✅ 完成!")

if __name__ == '__main__':
    main()
