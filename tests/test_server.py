import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("merqato_server", ROOT / "app" / "server.py")
server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server)


class UrlValidationTests(unittest.TestCase):
    def test_accepts_plain_http_urls(self):
        for value in ("https://example.com", "http://example.com/path?x=1"):
            cleaned, error = server.clean_url(value)
            self.assertIsNone(error)
            self.assertEqual(cleaned, value)

    def test_rejects_invalid_or_unsafe_urls(self):
        for value in (
            "not-a-url",
            "javascript:alert(1)",
            "https://user:password@example.com",
            "ftp://example.com",
        ):
            cleaned, error = server.clean_url(value)
            self.assertIsNone(cleaned)
            self.assertTrue(error)


if __name__ == "__main__":
    unittest.main()
