import json
import unittest
from pathlib import Path

from task_content import filter_task_details, task_keywords


class TaskContentTests(unittest.TestCase):
    def test_shared_keyword_fixtures(self):
        fixtures = json.loads(Path(__file__).with_name('task_keywords.json').read_text(encoding='utf-8'))
        for fixture in fixtures:
            with self.subTest(fixture['name']):
                self.assertEqual(task_keywords(fixture['answer']), fixture['expected'])

    def test_old_worker_details_are_filtered_by_original_task_rows(self):
        task = {'answer': '1. 冥想 <a href="?q=冥想" data-ask="true">指引</a>#r'
                          '4. 招手#r<a href="?q=未知广告" data-ask="true">推荐</a>'}
        useful = {'keyword': '冥想', 'text': '小精灵提示：前往雨林'}
        self.assertEqual(filter_task_details(task, [useful, {'keyword': '未知广告'},
                         {'keyword': '拯救小精灵', 'title': '妙脆角-一颗爱心'}]), [useful])

    def test_legacy_response_without_original_answer_keeps_useful_sprite_tips(self):
        useful = {'keyword': '冥想', 'text': '小精灵提醒您：在亭子里冥想'}
        self.assertEqual(filter_task_details({}, [useful,
            {'keyword': '新的标题', 'text': '小精灵被抓住啦！点击图标助力小精灵重获自由吧！'}]), [useful])
