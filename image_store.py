"""将 README 图片保存到仓库，避免依赖 GitHub Camo 访问网易外链。"""

import hashlib
import re
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


IMAGE_DIRECTORY = Path('assets/daily')
MAX_IMAGE_BYTES = 10 * 1024 * 1024
GENERATED_IMAGE = re.compile(r'^[0-9a-f]{64}\.(?:png|jpg|gif|webp)$')


def image_extension(content):
    if content.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png'
    if content.startswith(b'\xff\xd8\xff'):
        return 'jpg'
    if content.startswith((b'GIF87a', b'GIF89a')):
        return 'gif'
    if content.startswith(b'RIFF') and content[8:12] == b'WEBP':
        return 'webp'
    raise ValueError('响应不是支持的 PNG/JPEG/GIF/WebP 图片')


class ImageStore:
    def __init__(self, directory=IMAGE_DIRECTORY, session=None):
        self.directory = Path(directory)
        self.session = session or requests.Session()
        if session is None:
            retry = Retry(total=2, backoff_factor=0.5, status_forcelist=(429, 500, 502, 503, 504))
            self.session.mount('https://', HTTPAdapter(max_retries=retry))
        self.used = set()
        self.results = {}

    def save(self, url):
        if url in self.results:
            return self.results[url]
        digest = hashlib.sha256(url.encode('utf-8')).hexdigest()
        # 同一 URL 的不可变 CDN 图片跨日期复用，避免每日重复下载。
        for extension in ('png', 'jpg', 'gif', 'webp'):
            cached = self.directory / f'{digest}.{extension}'
            if cached.is_file() and cached.stat().st_size:
                self.used.add(cached)
                self.results[url] = cached.as_posix()
                return self.results[url]
        try:
            with self.session.get(url, timeout=(10, 20), stream=True) as response:
                response.raise_for_status()
                chunks = []
                size = 0
                for chunk in response.iter_content(64 * 1024):
                    size += len(chunk)
                    if size > MAX_IMAGE_BYTES:
                        raise ValueError('图片超过 10 MiB 限制')
                    chunks.append(chunk)
                content = b''.join(chunks)
            extension = image_extension(content)
            path = self.directory / f'{digest}.{extension}'
            self.directory.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix('.tmp')
            temporary.write_bytes(content)
            temporary.replace(path)
            self.used.add(path)
            self.results[url] = path.as_posix()
        except (requests.RequestException, ValueError) as error:
            print(f'⚠️ 图片下载失败，保留原图链接: {url} ({error})')
            self.results[url] = None
        return self.results[url]

    def render(self, label, url):
        path = self.save(url)
        if path:
            return f'![{label}]({path})'
        return f'[{label}（原图）](<{url}>)'

    def prune(self):
        """README 成功写入后只清理本脚本生成、当前不再引用的图片。"""
        if self.directory.is_dir():
            for path in self.directory.iterdir():
                if GENERATED_IMAGE.fullmatch(path.name) and path not in self.used:
                    path.unlink()
