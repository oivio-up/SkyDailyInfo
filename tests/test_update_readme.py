import os
import tempfile
import unittest
from pathlib import Path

import update_readme


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


if __name__ == '__main__':
    unittest.main()
