"""打包 GitHub Pages；仅复制前端、公开数据及图片。"""

import shutil
from pathlib import Path


def build(destination='dist'):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    for name in ('index.html', 'styles.css', 'app.js', 'favicon.svg', 'data.json'):
        shutil.copy2(Path('site') / name, destination / name)
    shutil.copytree('assets/daily', destination / 'assets/daily', dirs_exist_ok=True)
    (destination / '.nojekyll').touch()
    print(f'GitHub Pages files prepared: {destination}')


if __name__ == '__main__':
    build()
