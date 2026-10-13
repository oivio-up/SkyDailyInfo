import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

import requests

from image_store import ImageStore, MAX_IMAGE_BYTES


class ImageStoreTests(unittest.TestCase):
    def session_with_content(self, chunks):
        session = MagicMock()
        response = session.get.return_value.__enter__.return_value
        response.iter_content.return_value = chunks
        return session

    def test_mirrors_image_with_misleading_headers_and_reuses_across_runs(self):
        session = self.session_with_content([b'\x89PNG\r\n\x1a\nimage'])
        with tempfile.TemporaryDirectory() as directory:
            first = ImageStore(directory, session)
            path = first.save('https://example.com/image')
            self.assertTrue(Path(path).is_file())
            self.assertTrue(path.endswith('.png'))
            self.assertEqual(first.save('https://example.com/image'), path)
            second = ImageStore(directory, session)
            self.assertEqual(second.save('https://example.com/image'), path)
            session.get.assert_called_once()

    def test_download_failure_falls_back_to_clickable_source(self):
        session = MagicMock()
        session.get.side_effect = requests.Timeout('timeout')
        with tempfile.TemporaryDirectory() as directory:
            store = ImageStore(directory, session)
            markdown = store.render('天气', 'https://example.com/image')
            self.assertEqual(markdown, '[天气（原图）](<https://example.com/image>)')
            store.render('天气', 'https://example.com/image')
            session.get.assert_called_once()

    def test_rejects_error_pages_and_oversized_images(self):
        for chunks in ([b'<html>access denied</html>'], [b'x' * (MAX_IMAGE_BYTES + 1)]):
            with self.subTest(), tempfile.TemporaryDirectory() as directory:
                store = ImageStore(directory, self.session_with_content(chunks))
                self.assertIsNone(store.save('https://example.com/image'))
                self.assertEqual(list(Path(directory).iterdir()), [])

    def test_prune_preserves_current_images_and_manual_files(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ImageStore(directory, self.session_with_content([b'GIF89aimage']))
            current = Path(store.save('https://example.com/image'))
            old = Path(directory) / ('a' * 64 + '.png')
            manual = Path(directory) / 'manual.png'
            old.write_bytes(b'old')
            manual.write_bytes(b'manual')
            store.prune()
            self.assertTrue(current.exists())
            self.assertTrue(manual.exists())
            self.assertFalse(old.exists())
