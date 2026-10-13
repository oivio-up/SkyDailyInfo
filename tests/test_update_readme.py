import os
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import update_readme
from image_store import ImageStore


class UpdateReadmeTests(unittest.TestCase):
    def test_sanitize_text_removes_section_markers_and_fences(self):
        value = "before<!-- DAILY_TASK_END -->```after"
        self.assertEqual(update_readme.sanitize_text(value), "before'''after")

    def test_safe_image_url_only_accepts_https(self):
        self.assertEqual(
            update_readme.safe_image_url('https://example.com/a(b).png'),
            'https://example.com/a%28b%29.png',
        )
        self.assertIsNone(update_readme.safe_image_url('http://example.com/a.png'))
        self.assertIsNone(update_readme.safe_image_url('javascript:alert(1)'))
        self.assertEqual(update_readme.safe_image_url('http://ok.166.net/a.png?x=1&amp;y=2'),
                         'https://ok.166.net/a.png?x=1&y=2')

    def test_extract_tasks_ignores_malformed_items(self):
        task_data = {
            'taskList': [
                {'number': 1, 'task': '任务一'},
                {'number': '2', 'task': '类型错误'},
                'not-an-object',
            ]
        }
        self.assertEqual(
            update_readme.extract_tasks(task_data),
            '【今日旅行指南】\n1. 任务一',
        )

    def test_update_readme_keeps_exactly_one_generated_section(self):
        original_directory = os.getcwd()
        with tempfile.TemporaryDirectory() as directory:
            try:
                os.chdir(directory)
                Path('README.md').write_text(
                    '# Demo\n\n<!-- DAILY_TASK_START -->\nold\n'
                    '<!-- DAILY_TASK_END -->\n',
                    encoding='utf-8',
                )
                update_readme.update_readme(
                    {'taskList': [{'number': 1, 'task': '测试任务'}]},
                    [],
                    None,
                )
                result = Path('README.md').read_text(encoding='utf-8')
            finally:
                os.chdir(original_directory)

        self.assertEqual(result.count(update_readme.START_MARKER), 1)
        self.assertEqual(result.count(update_readme.END_MARKER), 1)
        self.assertIn('1. 测试任务', result)

    def test_update_mirrors_all_sections_and_filters_old_worker_promotions(self):
        original_directory = os.getcwd()
        with tempfile.TemporaryDirectory() as directory:
            try:
                os.chdir(directory)
                session = MagicMock()
                session.get.return_value.__enter__.return_value.iter_content.return_value = [
                    b'\x89PNG\r\n\x1a\nimage'
                ]
                store = ImageStore(session=session)
                Path('README.md').write_text(
                    '# Demo\n<!-- DAILY_TASK_START -->\nold\n<!-- DAILY_TASK_END -->\nfooter',
                    encoding='utf-8',
                )
                with patch.object(update_readme, 'ImageStore', return_value=store):
                    update_readme.update_readme(
                        {'taskList': [{'number': 1, 'task': '冥想'}],
                         'answer': '1. 冥想 <a data-ask="true" href="?q=冥想">指引</a>'},
                        [], {'text': '天气播报：晴', 'images': ['https://example.com/a.png']},
                        [{'keyword': '冥想', 'text': r'小精灵提示：C:\new\route',
                          'images': ['https://example.com/a.png']},
                         {'keyword': '拯救小精灵', 'title': '妙脆角-一颗爱心',
                          'images': ['https://example.com/ad.png']}],
                        {'images': ['https://example.com/calendar.png']},
                    )
                result = Path('README.md').read_text(encoding='utf-8')
                images = list(Path('assets/daily').glob('*.png'))
                self.assertEqual(len(images), 2)
                self.assertEqual(session.get.call_count, 2)
                for path in images:
                    self.assertIn(path.as_posix(), result)
                self.assertEqual(result.count('](assets/daily/'), 3)
                self.assertNotIn('妙脆角', result)
                self.assertNotIn('ad.png', result)
                self.assertIn(r'C:\new\route', result)
                self.assertIn('小精灵提示', result)
                self.assertTrue(result.endswith('footer'))
            finally:
                os.chdir(original_directory)

    def test_public_site_data_excludes_private_fields_and_original_answers(self):
        data = {
            'task': {'taskList': [{'number': 1, 'task': '冥想'}],
                     'rawAnswer': 'do-not-publish', 'uid': 'do-not-publish'},
            'uid': 'do-not-publish', 'token': 'do-not-publish',
            'WORKER_URL': 'do-not-publish', 'API_SECRET': 'do-not-publish',
            'events': [], 'taskDetails': [],
        }
        public = update_readme.build_public_data(data, MagicMock())
        self.assertEqual(public['tasks'], [{'number': 1, 'text': '冥想'}])
        self.assertNotIn('do-not-publish', json.dumps(public))
        self.assertEqual(set(public), {'date', 'updatedAt', 'tasks', 'weather', 'calendar', 'details', 'events'})

    def test_site_only_update_preserves_readme_and_its_images(self):
        original_directory = os.getcwd()
        with tempfile.TemporaryDirectory() as directory:
            try:
                os.chdir(directory)
                image = Path('assets/daily') / ('a' * 64 + '.png')
                image.parent.mkdir(parents=True)
                image.write_bytes(b'cached')
                original = '# Demo\n![保留图片](' + image.as_posix() + ')'
                Path('README.md').write_text(original, encoding='utf-8')
                with patch.dict(os.environ, {'UPDATE_README': 'false'}), patch.object(
                    update_readme, 'fetch_daily_data', return_value={'task': {'taskList': [{'number': 1, 'task': '冥想'}]}}
                ):
                    update_readme.main()
                self.assertEqual(Path('README.md').read_text(encoding='utf-8'), original)
                self.assertTrue(image.exists())
                self.assertTrue(Path('site/data.json').exists())
            finally:
                os.chdir(original_directory)


if __name__ == '__main__':
    unittest.main()
