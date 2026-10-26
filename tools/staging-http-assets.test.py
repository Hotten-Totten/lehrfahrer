#!/usr/bin/env python3
"""Regression tests for the version-independent staging CSS/JS postcheck."""

import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("staging-http-assets.py")
SPEC = importlib.util.spec_from_file_location("staging_http_assets", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
ORIGIN = "https://staging.lehrfahrer.de"


def editor_html(version="next-release"):
    return ("<!doctype html><html><head>"
            f'<link rel="stylesheet" href="editor.css?v={version}&amp;layout=phase2a">'
            "</head><body>"
            f'<script src="js/editor.api.js?v={version}"></script>'
            f'<script src="js/editor.routing.js?v={version}"></script>'
            f'<script src="js/editor.route.js?v={version}"></script>'
            "</body></html>")


class StagingHttpAssetsTest(unittest.TestCase):
    def test_new_cache_key_fetches_exact_referenced_resources(self):
        html = editor_html("future-987")
        seen = []

        def fetch(url):
            seen.append(url)
            if "future-987" not in url:
                return 404, "text/plain", b""
            return 200, "text/css" if "editor.css" in url else "text/javascript", b"asset bytes"

        with tempfile.TemporaryDirectory() as directory:
            assets = MODULE.verify_assets(html, ORIGIN, Path(directory), fetch)
            self.assertEqual(len(assets), 4)
            self.assertEqual(len(seen), 4)
            self.assertIn(ORIGIN + "/editor.css?v=future-987&layout=phase2a", seen)
            self.assertEqual((Path(directory) / "editor.css").read_bytes(), b"asset bytes")
            self.assertEqual((Path(directory) / "js/editor.route.js").read_bytes(), b"asset bytes")

    def test_missing_referenced_css_or_js_fails(self):
        for missing in ("editor.css", "js/editor.route.js"):
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as directory:
                def fetch(url):
                    if url.split("/", 3)[-1].split("?", 1)[0] == missing:
                        return 404, "text/html", b""
                    return 200, "text/javascript", b"asset bytes"

                with self.assertRaises(MODULE.AssetCheckError):
                    MODULE.verify_assets(editor_html(), ORIGIN, Path(directory), fetch)

    def test_only_exact_reference_is_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            def fetch(url):
                if "editor.css?v=old" in url:
                    return 200, "text/css", b"old CSS"
                if "editor.css?" in url:
                    return 404, "text/html", b""
                return 200, "text/javascript", b"asset bytes"

            with self.assertRaises(MODULE.AssetCheckError):
                MODULE.verify_assets(editor_html("new"), ORIGIN, Path(directory), fetch)

    def test_missing_or_invalid_editor_html_fails(self):
        for html in ("", "<html><body>Login</body></html>",
                     "<html><head></head><body></body></html>"):
            with self.subTest(html=html), self.assertRaises(MODULE.AssetCheckError):
                MODULE.parse_editor_assets(html)
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [sys.executable, str(SCRIPT), str(Path(directory) / "missing.html"),
                 ORIGIN, str(Path(directory) / "assets")],
                env={**os.environ, "BASIC_USER": "test", "BASIC_PASSWORD": "test"},
                capture_output=True, text=True, check=False,
            )
            self.assertNotEqual(result.returncode, 0)

    def test_duplicate_or_unversioned_local_assets_fail(self):
        for html in (editor_html().replace("editor.css?v=next-release", "editor.css"),
                     editor_html().replace("</head>", '<link rel="stylesheet" href="editor.css?v=other"></head>')):
            with self.subTest(html=html), self.assertRaises(MODULE.AssetCheckError):
                MODULE.parse_editor_assets(html)


if __name__ == "__main__":
    unittest.main()
