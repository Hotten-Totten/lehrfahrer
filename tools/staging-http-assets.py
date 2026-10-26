#!/usr/bin/env python3
"""Check the local CSS/JS URLs referenced by the authenticated staging editor."""

import base64
from html.parser import HTMLParser
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class AssetCheckError(Exception):
    pass


class EditorAssets(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.has_html = False
        self.has_head = False
        self.has_body = False
        self.refs = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "html":
            self.has_html = True
        elif tag == "head":
            self.has_head = True
        elif tag == "body":
            self.has_body = True
        elif tag == "link" and "stylesheet" in (values.get("rel") or "").lower().split():
            self.refs.append(("css", values.get("href")))
        elif tag == "script" and "src" in values:
            self.refs.append(("js", values.get("src")))


def parse_editor_assets(html):
    parser = EditorAssets()
    parser.feed(html)
    if not (parser.has_html and parser.has_head and parser.has_body):
        raise AssetCheckError("Editor-HTML ist unvollständig.")

    assets = {}
    for kind, ref in parser.refs:
        if not ref:
            raise AssetCheckError("CSS-/JS-Referenz ohne URL.")
        parts = urlsplit(ref)
        if parts.scheme or parts.netloc:
            if parts.scheme != "https" or parts.netloc != "unpkg.com":
                raise AssetCheckError("Unerwartete externe CSS-/JS-Quelle.")
            continue
        path = parts.path
        if (not re.fullmatch(r"[A-Za-z0-9._/-]+", path or "")
                or path.startswith("/") or "//" in path or ".." in path.split("/")
                or not path.endswith((".css", ".js")) or parts.fragment):
            raise AssetCheckError("Ungültiger lokaler CSS-/JS-Pfad.")
        if (kind == "css") != path.endswith(".css"):
            raise AssetCheckError("CSS-/JS-Referenz hat den falschen Dateityp.")
        version = parse_qs(parts.query, keep_blank_values=True).get("v", [])
        if len(version) != 1 or not version[0]:
            raise AssetCheckError("Lokale CSS-/JS-Referenz ohne Cache-Schlüssel.")
        if path in assets:
            raise AssetCheckError("CSS-/JS-Ressource ist mehrfach referenziert.")
        assets[path] = ref

    for required in ("editor.css", "js/editor.api.js", "js/editor.routing.js"):
        if required not in assets:
            raise AssetCheckError(f"Erforderliche Editor-Ressource fehlt: {required}")
    return assets


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def verify_assets(html, origin, output_dir, fetch):
    assets = parse_editor_assets(html)
    for path, ref in assets.items():
        url = origin.rstrip("/") + "/" + ref
        status, content_type, body = fetch(url)
        if status != 200 or not body or "text/html" in content_type.lower():
            raise AssetCheckError(f"Referenzierte Ressource nicht verwendbar: {path} (HTTP {status})")
        target = output_dir / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    return assets


def main():
    if len(sys.argv) != 4:
        raise AssetCheckError("Aufruf: staging-http-assets.py HTML ORIGIN AUSGABEVERZEICHNIS")
    html_path, origin, output_path = sys.argv[1:]
    if origin != "https://staging.lehrfahrer.de":
        raise AssetCheckError("Nur der vorgesehene Staging-Host ist erlaubt.")
    html = Path(html_path).read_text(encoding="utf-8")
    user = os.environ["BASIC_USER"]
    password = os.environ["BASIC_PASSWORD"]
    auth = base64.b64encode(f"{user}:{password}".encode()).decode("ascii")
    opener = build_opener(NoRedirect())

    def fetch(url):
        request = Request(url, headers={"Authorization": "Basic " + auth})
        try:
            with opener.open(request, timeout=20) as response:
                return response.status, response.headers.get("Content-Type", ""), response.read()
        except HTTPError as error:
            return error.code, error.headers.get("Content-Type", ""), b""
        except URLError as error:
            raise AssetCheckError("Referenzierte Ressource ist nicht erreichbar.") from error

    assets = verify_assets(html, origin, Path(output_path), fetch)
    print(f"Staging-CSS/JS geprüft: {len(assets)} referenzierte lokale Ressourcen.")


if __name__ == "__main__":
    try:
        main()
    except (AssetCheckError, OSError, UnicodeError, ValueError) as error:
        print(f"Staging-CSS/JS-Postcheck fehlgeschlagen: {error}", file=sys.stderr)
        sys.exit(1)
