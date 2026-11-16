from __future__ import annotations

import pytest

from worker.fetch.detector import (
    is_blocked_suspected,
    is_html,
    is_js_only_suspected,
)


@pytest.mark.unit
def test_is_html() -> None:
    assert is_html("text/html") is True
    assert is_html("text/html; charset=utf-8") is True
    assert is_html("application/xhtml+xml") is True
    assert is_html("application/pdf") is False
    assert is_html("image/png") is False
    assert is_html("application/json") is False
    assert is_html(None) is False
    assert is_html("") is False


@pytest.mark.unit
def test_is_blocked_suspected_429() -> None:
    assert is_blocked_suspected(429, {}) is True


@pytest.mark.unit
def test_is_blocked_suspected_cloudflare() -> None:
    # CF header marker
    assert is_blocked_suspected(403, {"cf-mitigated": "challenge"}) is True
    assert is_blocked_suspected(403, {"cf-ray": "123456789"}) is True
    assert is_blocked_suspected(503, {"cf-ray": "123456789"}) is True

    # CF body markers
    body = (
        b"<!DOCTYPE html><html><head><title>Just a moment...</title></head>"
        b"<body>Checking your browser</body></html>"
    )
    assert is_blocked_suspected(403, {}, body) is True
    assert is_blocked_suspected(503, {"server": "cloudflare"}, body) is True

    # Cloudflare turnstile
    turnstile_body = (
        b"<html><body><div class='cf-turnstile'>Please complete security check</div></body></html>"
    )
    assert is_blocked_suspected(403, {}, turnstile_body) is True


@pytest.mark.unit
def test_is_blocked_suspected_normal_errors() -> None:
    # Normal 403 (e.g. login required) without anti-bot markers
    assert is_blocked_suspected(403, {}, b"Forbidden: Invalid user credentials") is False
    # Normal 503 without anti-bot markers
    assert (
        is_blocked_suspected(503, {}, b"Service Unavailable: Database connection failed") is False
    )
    # Normal 200 or 404
    assert is_blocked_suspected(200, {}) is False
    assert is_blocked_suspected(404, {}) is False


@pytest.mark.unit
def test_is_js_only_suspected() -> None:
    # React empty app shell
    react_shell = b"""<!DOCTYPE html>
<html>
<head><title>My App</title></head>
<body>
  <div id="root"></div>
  <noscript>You need to enable JavaScript to run this app.</noscript>
  <script src="/static/js/main.chunk.js"></script>
</body>
</html>"""
    assert is_js_only_suspected(react_shell, "text/html") is True

    # Vue empty app shell
    vue_shell = b"""<!DOCTYPE html>
<html>
<head><title>Dashboard</title></head>
<body>
  <div id="app"></div>
  <script src="/js/app.js"></script>
</body>
</html>"""
    assert is_js_only_suspected(vue_shell, "text/html") is True

    # Non-empty page with actual substantive content
    real_page = b"""<!DOCTYPE html>
<html>
<head><title>Comprehensive Guide to SEO</title></head>
<body>
  <h1>The Ultimate SEO Guide</h1>
  <p>Search engine optimization is the practice of orienting your website
  to rank higher on search engine results pages. This comprehensive guide covers
  everything from keyword research to backlink acquisition.
  Make sure your content is high quality and provides genuine value to readers.</p>
  <div id="root"></div>
  <script src="/app.js"></script>
</body>
</html>"""
    assert is_js_only_suspected(real_page, "text/html") is False

    # Non-HTML content is never js_only_suspected
    assert is_js_only_suspected(react_shell, "application/pdf") is False
