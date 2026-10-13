"""按任务正文的结构选择攻略，兼容尚未重新部署的 Worker。"""

import html
import re
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlsplit


SUPPLEMENTARY_GUIDE = re.compile(r'^(?:季节蜡烛|大蜡烛|红石|碎片)(?:位置|探索|攻略|指南)')


class AskLinks(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.keywords = []

    def handle_starttag(self, tag, attrs):
        if tag != 'a':
            return
        attrs = dict(attrs)
        if attrs.get('data-ask', '').lower() != 'true':
            return
        try:
            query = parse_qs(urlsplit(attrs.get('href', '')).query)
        except ValueError:
            return
        self.keywords.extend(query.get('q', []))


def task_keywords(answer):
    """只取前四项任务中的问答链接，以及明确的蜡烛/碎片攻略。"""
    rows = re.sub(r'</?(?:br|p|div)\b[^>]*>', '\n', answer, flags=re.I)
    rows = rows.replace('#r', '\n')
    keywords = []
    for row in rows.splitlines():
        visible = html.unescape(re.sub(r'<[^>]*>', '', row))
        visible = re.sub(r'#c[\da-fA-F]{6}|#n', '', visible).strip()
        is_task = re.match(r'^[1-4][.．、]\s*', visible)
        links = AskLinks()
        links.feed(row)
        for keyword in links.keywords:
            if (is_task or SUPPLEMENTARY_GUIDE.match(keyword)) and keyword not in keywords:
                keywords.append(keyword)
    return keywords


def is_promotion(detail):
    """旧响应缺少原始正文时的兜底；保留“小精灵提示”等有效攻略。"""
    text = '\n'.join(str(detail.get(key, '')) for key in ('keyword', 'title', 'text'))
    return bool(re.search(r'(?:拯救|解救|营救)小精灵|小精灵.*(?:被抓|重获自由)|妙脆角', text))


def filter_task_details(task_data, details):
    if not isinstance(details, list):
        return []
    answer = task_data.get('answer') if isinstance(task_data, dict) else None
    allowed = set(task_keywords(answer)) if isinstance(answer, str) and answer.strip() else None
    return [detail for detail in details if isinstance(detail, dict)
            and not is_promotion(detail)
            and (allowed is None or detail.get('keyword') in allowed)]
