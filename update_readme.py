#!/usr/bin/env python3
"""
光遇每日任务 README 更新脚本
从 Cloudflare Worker 获取数据并更新 README.md
"""

import os
import sys
import requests
import re
from datetime import datetime, timezone, timedelta

# 从环境变量获取配置
WORKER_URL = os.environ.get('WORKER_URL')
API_SECRET = os.environ.get('API_SECRET')

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
        response = requests.get(WORKER_URL, headers=headers, timeout=30)
        response.raise_for_status()
        data = response.json()
        
        if not data.get('success'):
            print(f"Worker 返回错误: {data.get('error', '未知错误')}")
            sys.exit(1)
        
        # 显示缓存状态
        if data.get('cached'):
            print(f"✅ 使用缓存数据 (缓存时间: {data.get('cacheTime', 'N/A')})")
        else:
            print(f"🔄 从网易 API 获取新数据")
        
        return data['data']
    except requests.exceptions.RequestException as e:
        print(f"请求失败: {e}")
        sys.exit(1)

def extract_tasks(task_data):
    """提取任务列表（使用 Worker 已处理好的数据）"""
    # 如果有 taskList，直接格式化
    if 'taskList' in task_data and task_data['taskList']:
        tasks = []
        tasks.append('【今日旅行指南】')
        for task in task_data['taskList']:
            tasks.append(f"{task['number']}. {task['task']}")
        return '\n'.join(tasks)
    
    # 否则使用 rawAnswer
    return task_data.get('rawAnswer', '')

def format_events(events):
    """格式化活动列表"""
    if not events:
        return "今日暂无特殊活动"
    
    result = []
    for event in events:
        times = ', '.join(event['times'])
        result.append(f"**{event['title']}** - {event['description']}")
        result.append(f"- 时间: {times}")
        result.append(f"- 地点: {event['location']}")
        result.append("")
    
    return '\n'.join(result)

def format_weather(weather_data):
    """格式化天气预报"""
    if not weather_data:
        return None

    # 支持不同来源的字段名: 优先使用 'text' 或 'answer' 或 'rawAnswer'
    raw = None
    if isinstance(weather_data, dict):
        raw = weather_data.get('text') or weather_data.get('answer') or weather_data.get('rawAnswer')
    else:
        raw = str(weather_data)

    if not raw:
        return None

    # 清理 HTML 标签和特殊控制序列 (#r, #n 等)
    # 去掉 HTML
    clean = re.sub(r'<[^>]+>', '', raw)
    # 替换控制序列为换行
    clean = clean.replace('#r', '\n').replace('#n', '\n')
    # 去掉多余空白
    clean = re.sub(r'\s+', ' ', clean).strip()

    # 提取以“天气播报：”开头的短句，截断在常见分隔词处（如 如果, ===, 请）
    m = re.search(r'天气播报：\s*([^\n\r]+)', clean)
    if m:
        text = m.group(0)  # 包含“天气播报：”
        # 在可能的推广或额外提示前截断
        text = re.split(r'如果|===|请给|请帮|如上|点赞|感谢', text)[0].strip()
        return text

    # 回退策略：寻找第一句包含“天气”或“播报”的短句
    m2 = re.search(r'([^。\n\r]{0,100}(天气|播报)[^。\n\r]{0,100})', clean)
    if m2:
        return m2.group(1).strip()

    # 最后回退，截取前120字符作为展示
    return clean[:120].strip()

def format_task_details(details_list):
    """格式化任务详情（先祖位置等）"""
    if not details_list:
        return ""
    
    result = []
    for detail in details_list:
        keyword = detail.get('keyword', '')
        title = detail.get('title', keyword)
        
        result.append(f"\n#### 📍 {title}")
        
        # 添加文字内容
        text = detail.get('text', '')
        if text:
            result.append(f"\n{text}\n")
        
        # 添加图片
        images = detail.get('images', [])
        if images:
            result.append("")  # 空行
            for i, img_url in enumerate(images):
                result.append(f"![{keyword}-{i+1}]({img_url})")
        
        result.append("\n---\n")  # 分隔线
    
    return '\n'.join(result)

def format_calendar(calendar_data):
    """格式化日历图片"""
    if not calendar_data:
        return ""
    
    images = calendar_data.get('images', [])
    if not images:
        return ""
    
    # 显示第一张日历图片
    return f"![光遇日历]({images[0]})"

def update_readme(task_data, events_data, weather_data, task_details=None, calendar_data=None):
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
    
    # 格式化天气
    weather = format_weather(weather_data)
    
    # 格式化任务详情
    details = format_task_details(task_details) if task_details else ""
    
    # 格式化日历
    calendar = format_calendar(calendar_data) if calendar_data else ""
    
    # 生成天气部分
    weather_section = ""
    if weather:
        weather_section = f"""
### 🌤️ 天气预报

{weather}

"""
    
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
    start_marker = "<!-- DAILY_TASK_START -->"
    end_marker = "<!-- DAILY_TASK_END -->"
    
    if start_marker in content and end_marker in content:
        # 替换现有内容
        pattern = f"{re.escape(start_marker)}.*?{re.escape(end_marker)}"
        new_content = re.sub(
            pattern,
            f"{start_marker}\n{new_section}{end_marker}",
            content,
            flags=re.DOTALL
        )
    else:
        # 如果没有标记，在文件末尾添加
        if not content.strip().endswith('---'):
            content += '\n\n---\n\n'
        new_content = content + f"\n{start_marker}\n{new_section}{end_marker}\n"
    
    # 写入文件
    with open(readme_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    print(f"✅ README.md 已更新 ({date_str} {time_str})")
    if task_details:
        print(f"   📍 包含 {len(task_details)} 个任务详情")
    if calendar_data:
        print(f"   📅 包含本月日历")

def main():
    print("🌤 开始更新光遇每日任务...")
    
    # 获取数据
    data = fetch_daily_data()
    print("✅ 成功获取数据")
    
    # 更新 README
    update_readme(
        data['task'], 
        data['events'], 
        data.get('weather'),
        data.get('taskDetails'),
        data.get('calendar')
    )
    print("✅ 完成!")

if __name__ == '__main__':
    main()
