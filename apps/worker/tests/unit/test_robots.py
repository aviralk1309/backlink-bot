import asyncio
import ipaddress
import time

import pytest
import respx

from worker.fetch.fetcher import FetcherConfig, PoliteFetcher
from worker.fetch.rate_limiter import DomainRateLimiter
from worker.fetch.robots import RobotsPolicy, origin_for, retry_seconds

pytestmark = pytest.mark.unit


class MemoryCache:
    def __init__(self):
        self.entries = {}
        self.blocked = {}
        self.leases = {}

    async def claim(self, origin, token):
        if self.blocked.get(origin, 0) > time.monotonic():
            return {"action": "blocked"}
        if origin in self.entries:
            return {"action": "cached", **self.entries[origin]}
        if origin in self.leases:
            return {"action": "wait"}
        self.leases[origin] = token
        return {"action": "refresh"}

    async def complete(self, origin, token, state, text, ttl):
        if self.leases.get(origin) != token:
            return False
        self.entries[origin] = {"state": state, "robots_txt": text, "ttl": ttl}
        del self.leases[origin]
        return True

    async def block(self, origin, seconds):
        self.blocked[origin] = time.monotonic() + seconds


class Resolver:
    async def resolve(self, host, port):
        return [ipaddress.ip_address("93.184.216.34")]


def fetcher(cache=None, **kwargs):
    f = PoliteFetcher(
        FetcherConfig(user_agent="BacklinkBot/1.0", total_timeout=3, max_retries=0, **kwargs),
        dns_resolver=Resolver(),
        rate_limiter=DomainRateLimiter(0),
    )
    f.robots_policy = RobotsPolicy(cache or MemoryCache(), f._fetch_robots, f.config.user_agent)
    return f


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://WWW.Example.com/a", "https://www.example.com:443"),
        ("https://example.com:443/b", "https://example.com:443"),
        ("http://example.com/a", "http://example.com:80"),
        ("https://example.com:80/a", "https://example.com:80"),
        ("https://bücher.de/a", "https://xn--bcher-kva.de:443"),
        ("https://[2606:4700:4700::1111]/a", "https://[2606:4700:4700::1111]:443"),
    ],
)
def test_origin(url, expected):
    assert origin_for(url) == expected


@pytest.mark.parametrize(
    "rules,path,denied",
    [
        ("User-agent: *\nDisallow: /private", "/private/a", True),
        ("User-agent: *\nDisallow: /private\nAllow: /private/public", "/private/public", False),
        ("User-agent: Googlebot\nDisallow: /", "/a", False),
        (
            "User-agent: BacklinkBot\nDisallow: /a\nUser-agent: BacklinkBot\nDisallow: /b",
            "/b",
            True,
        ),
        ("User-agent: *\nDisallow: /*.pdf$", "/file.pdf", True),
        ("User-agent: *\nDisallow: /café", "/caf%C3%A9", True),
        ("garbage\nUser-agent: *\nDisallow: /a", "/a", True),
        ("User-agent: *\nDisallow:", "/a", False),
    ],
)
async def test_rules(rules, path, denied):
    with respx.mock(assert_all_called=False) as router:
        router.get("https://example.com/robots.txt").respond(200, text=rules)
        page = router.get("https://example.com" + path).respond(
            200, text="<html>hello</html>", content_type="text/html"
        )
        async with fetcher() as f:
            result = await f.fetch("https://example.com" + path)
    assert page.called is not denied
    assert result.reason_code == ("robots_disallowed_for_bot" if denied else None)


@pytest.mark.parametrize(
    "status,body,allowed",
    [
        (404, "missing", True),
        (410, "gone", True),
        (403, "forbidden", False),
        (401, "auth", False),
        (429, "rate limited", False),
        (503, "down", False),
        (200, "<html>Checking your browser</html>", False),
        (200, "", True),
    ],
)
async def test_status_policy(status, body, allowed):
    with respx.mock(assert_all_called=False) as router:
        robots = router.get("https://example.com/robots.txt").respond(status, text=body)
        page = router.get("https://example.com/a").respond(
            200, text="<html>ok</html>", content_type="text/html"
        )
        async with fetcher() as f:
            result = await f.fetch("https://example.com/a")
            await f.fetch("https://example.com/a")
    assert robots.call_count == 1
    assert page.called is allowed
    if not allowed:
        assert result.outcome == "could_not_check"
        assert result.reason_code == "robots_unavailable"


@pytest.mark.parametrize("concurrency", [1, 10])
async def test_parallel_urls_share_refresh(concurrency):
    with respx.mock as router:
        robots = router.get("https://example.com/robots.txt").respond(200, text="User-agent: *")
        router.get(url__regex=r"https://example.com/page/.*").respond(
            200, text="<html>ok</html>", content_type="text/html"
        )
        async with fetcher(concurrency=concurrency) as f:
            results = await asyncio.gather(
                *(f.fetch(f"https://example.com/page/{i}") for i in range(10))
            )
    assert robots.call_count == 1
    assert all(r.outcome == "ok" for r in results)


async def test_page_redirect_checks_destination():
    with respx.mock as router:
        router.get("https://example.com/robots.txt").respond(404)
        router.get("https://example.com/a").respond(
            302, headers={"location": "https://www.example.com/a"}
        )
        router.get("https://www.example.com/robots.txt").respond(
            200, text="User-agent: *\nDisallow: /"
        )
        async with fetcher() as f:
            result = await f.fetch("https://example.com/a")
    assert result.reason_code == "robots_disallowed_for_bot"
    assert len(result.redirect_chain) == 1


async def test_robots_redirect_keeps_original_scope():
    with respx.mock as router:
        router.get("https://example.com/robots.txt").respond(
            302, headers={"location": "https://cdn.example.com/rules.txt"}
        )
        router.get("https://cdn.example.com/rules.txt").respond(
            200, text="User-agent: *\nDisallow: /"
        )
        cache = MemoryCache()
        async with fetcher(cache) as f:
            result = await f.fetch("https://example.com/a")
    assert result.reason_code == "robots_disallowed_for_bot"
    assert list(cache.entries) == ["https://example.com:443"]


@pytest.mark.parametrize("target", ["http://127.0.0.1/private", "https://example.com:8080/rules"])
async def test_robots_redirect_ssrf(target):
    with respx.mock as router:
        router.get("https://example.com/robots.txt").respond(302, headers={"location": target})
        async with fetcher() as f:
            result = await f.fetch("https://example.com/a")
    assert result.reason_code == "robots_unavailable"


@pytest.mark.parametrize("size", [512000, 524288, 524289])
async def test_robots_size_budget(size):
    suffix = b"\nUser-agent: *\nDisallow: /\n"
    rules = b"#" + b"x" * (size - 1 - len(suffix)) + suffix
    with respx.mock as router:
        router.get("https://example.com/robots.txt").respond(200, content=rules)
        async with fetcher() as f:
            result = await f.fetch("https://example.com/a")
    assert result.reason_code == (
        "robots_disallowed_for_bot" if size <= 524288 else "robots_unavailable"
    )


async def test_page_block_cooldown_scoped_and_expires():
    cache = MemoryCache()
    with respx.mock as router:
        router.get("https://example.com/robots.txt").respond(404)
        page = router.get("https://example.com/a").respond(429, headers={"retry-after": "1200"})
        router.get("https://www.example.com/robots.txt").respond(404)
        router.get("https://www.example.com/a").respond(
            200, content_type="text/html", text="<html>ok</html>"
        )
        async with fetcher(cache) as f:
            assert (await f.fetch("https://example.com/a")).outcome == "blocked_suspected"
            assert (await f.fetch("https://example.com/b")).reason_code == "origin_blocked_cooldown"
            assert (await f.fetch("https://www.example.com/a")).outcome == "ok"
            cache.blocked.clear()
            await f.fetch("https://example.com/a")
    assert page.call_count == 2


async def test_cache_failure_propagates():
    class BrokenCache(MemoryCache):
        async def claim(self, origin, token):
            raise RuntimeError("database down")

    async with fetcher(BrokenCache()) as f:
        with pytest.raises(RuntimeError, match="database down"):
            await f.fetch("https://example.com/a")


def test_retry_after_bounds():
    assert retry_seconds({"retry-after": "1200"}, 900) == 1200
    assert retry_seconds({"retry-after": "bad"}, 900) == 900
    assert retry_seconds({"retry-after": "9999999"}, 900) == 86400


@pytest.mark.parametrize("content_type", ["text/html", "application/json", "image/png"])
async def test_non_text_robots_is_unavailable(content_type):
    with respx.mock as router:
        router.get("https://example.com/robots.txt").respond(
            200, content=b"not robots", content_type=content_type
        )
        async with fetcher() as f:
            result = await f.fetch("https://example.com/a")
    assert result.reason_code == "robots_unavailable"


async def test_network_failure_cached_without_page_request():
    import httpx

    with respx.mock as router:
        robots = router.get("https://example.com/robots.txt").mock(
            side_effect=httpx.ConnectError("connection refused")
        )
        async with fetcher() as f:
            assert (await f.fetch("https://example.com/a")).reason_code == "robots_unavailable"
            assert (await f.fetch("https://example.com/b")).reason_code == "robots_unavailable"
    assert robots.call_count == 1


async def test_robots_and_page_share_dispatch_limiter():
    domains = []

    class RecordingLimiter:
        async def acquire(self, domain):
            domains.append(domain)

    with respx.mock as router:
        router.get("https://example.com/robots.txt").respond(
            302, headers={"location": "https://www.example.com/rules.txt"}
        )
        router.get("https://www.example.com/rules.txt").respond(200, text="User-agent: *")
        router.get("https://example.com/a").respond(
            200, content_type="text/html", text="<html>ok</html>"
        )
        async with fetcher() as f:
            f.rate_limiter = RecordingLimiter()
            assert (await f.fetch("https://example.com/a")).outcome == "ok"
    assert domains == ["example.com"] * 3


async def test_total_deadline_bounds_robots_wait_and_suppresses_page():
    class WaitingCache(MemoryCache):
        async def claim(self, origin, token):
            return {"action": "wait"}

    async with fetcher(WaitingCache()) as f:
        f.config.total_timeout = 0.03
        result = await f.fetch("https://example.com/a")
    assert result.outcome == "timeout"
    assert result.elapsed_seconds < 0.5


async def test_superseded_refresh_cannot_authorize_page():
    class SupersededCache(MemoryCache):
        async def complete(self, origin, token, state, text, ttl):
            self.entries[origin] = {"state": "rules", "robots_txt": "User-agent: *\nDisallow: /"}
            return False

    with respx.mock as router:
        router.get("https://example.com/robots.txt").respond(404)
        async with fetcher(SupersededCache()) as f:
            result = await f.fetch("https://example.com/a")
    assert result.reason_code == "robots_disallowed_for_bot"
