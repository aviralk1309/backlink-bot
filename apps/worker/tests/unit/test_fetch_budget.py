"""Regression proof for fetch budgets and every-attempt politeness."""

import asyncio
import ipaddress
import time

import httpx
import pytest
import respx

from worker.fetch.fetcher import FetcherConfig, PoliteFetcher
from worker.fetch.rate_limiter import DomainRateLimiter

pytestmark = pytest.mark.unit


class Resolver:
    async def resolve(self, host, port):
        return [ipaddress.ip_address("93.184.216.34")]


def fetcher(**kwargs):
    config = FetcherConfig(user_agent="TestBot", **kwargs)
    return PoliteFetcher(config, Resolver(), DomainRateLimiter(config.domain_delay_seconds))


@pytest.mark.parametrize("failure", ["500", "timeout"])
async def test_every_retry_obeys_domain_spacing(failure):
    starts = []

    def respond(request):
        starts.append(time.monotonic())
        if failure == "timeout":
            raise httpx.ReadTimeout("test")
        return httpx.Response(500, text="server error")

    with respx.mock:
        respx.get("https://example.com/").mock(side_effect=respond)
        async with fetcher(domain_delay_seconds=0.06, retry_backoff_base=0) as client:
            await client.fetch("https://example.com/")
    assert len(starts) == 3
    assert all(b - a >= 0.05 for a, b in zip(starts, starts[1:], strict=False))


async def test_total_deadline_includes_stalled_dns():
    class StalledResolver:
        async def resolve(self, host, port):
            await asyncio.Event().wait()

    async with fetcher(total_timeout=0.06) as client:
        client.dns_resolver = StalledResolver()
        result = await asyncio.wait_for(client.fetch("https://example.com/"), 0.4)
    assert result.outcome == "timeout", result
    assert result.elapsed_seconds < 0.3


async def test_total_deadline_closes_trickling_response():
    class Trickle(httpx.AsyncByteStream):
        closed = False

        async def __aiter__(self):
            for _ in range(10):
                await asyncio.sleep(0.03)
                yield b"<p>slow content</p>"

        async def aclose(self):
            self.closed = True

    stream = Trickle()
    with respx.mock:
        respx.get("https://example.com/").mock(
            return_value=httpx.Response(200, headers={"content-type": "text/html"}, stream=stream)
        )
        async with fetcher(total_timeout=0.08) as client:
            result = await client.fetch("https://example.com/")
    assert result.outcome == "timeout", result
    assert result.elapsed_seconds < 0.25
    assert stream.closed


async def test_redirect_wait_uses_remaining_budget_and_preserves_chain():
    with respx.mock(assert_all_called=False) as router:
        router.get("https://example.com/").respond(302, headers={"location": "/next"})
        last = router.get("https://example.com/next").respond(200)
        async with fetcher(total_timeout=0.06, domain_delay_seconds=0.2) as client:
            result = await client.fetch("https://example.com/")
    assert result.outcome == "timeout", result
    assert result.final_url == "https://example.com/next"
    assert len(result.redirect_chain) == 1
    assert not last.called


async def test_backoff_and_semaphore_wait_share_deadline():
    with respx.mock:
        route = respx.get("https://example.com/").respond(500)
        async with fetcher(total_timeout=0.06, retry_backoff_base=1, concurrency=1) as client:
            results = await asyncio.gather(
                *[client.fetch("https://example.com/") for _ in range(2)]
            )
    assert all(result.outcome == "timeout" for result in results)
    assert all(result.elapsed_seconds < 0.3 for result in results)
    assert route.call_count == 1


async def test_cancellation_propagates_and_releases_concurrency():
    entered = asyncio.Event()

    class BlockingLimiter:
        async def acquire(self, domain):
            entered.set()
            await asyncio.Event().wait()

    async with fetcher(concurrency=1) as client:
        client.rate_limiter = BlockingLimiter()
        task = asyncio.create_task(client.fetch("https://example.com/"))
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not client._concurrency_semaphore.locked()


def test_implicit_process_local_limiter_is_rejected():
    with pytest.raises(ValueError, match="shared database pool"):
        PoliteFetcher(FetcherConfig(user_agent="TestBot"))


async def test_coordination_failure_never_dispatches_http():
    class BrokenLimiter:
        async def acquire(self, domain):
            raise ConnectionError("database unavailable")

    with respx.mock(assert_all_called=False) as router:
        route = router.get("https://example.com/").respond(200)
        async with fetcher() as client:
            client.rate_limiter = BrokenLimiter()
            with pytest.raises(ConnectionError, match="database unavailable"):
                await client.fetch("https://example.com/")
        assert not route.called
