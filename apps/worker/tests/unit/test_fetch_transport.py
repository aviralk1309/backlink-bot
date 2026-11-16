"""Exercise the real HTTP pool, mocking only the socket boundary (no respx)."""

from __future__ import annotations

import ipaddress
import ssl
from collections.abc import Iterable

import httpcore
import httpx
import pytest

from worker.fetch.fetcher import FetcherConfig, PoliteFetcher
from worker.fetch.transport import PublicHTTPTransport

pytestmark = pytest.mark.unit


class Resolver:
    def __init__(self, answers: list[list[str]]) -> None:
        self.answers = answers
        self.calls: list[str] = []

    async def resolve(
        self, host: str, port: int
    ) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        self.calls.append(host)
        return [
            ipaddress.ip_address(ip)
            for ip in self.answers[min(len(self.calls) - 1, len(self.answers) - 1)]
        ]


class SocketStream(httpcore.AsyncMockStream):
    def __init__(self, response: bytes) -> None:
        super().__init__([response])
        self.written = b""
        self.server_hostname: str | None = None

    async def write(
        self,
        buffer: bytes,
        timeout: float | None = None,  # noqa: ASYNC109 - httpcore interface
    ) -> None:
        self.written += buffer

    async def start_tls(
        self,
        ssl_context: ssl.SSLContext,
        server_hostname: str | None = None,
        timeout: float | None = None,  # noqa: ASYNC109 - httpcore interface
    ) -> httpcore.AsyncNetworkStream:
        assert ssl_context.check_hostname
        assert ssl_context.verify_mode == ssl.CERT_REQUIRED
        self.server_hostname = server_hostname
        return self


class Sockets:
    def __init__(self, monkeypatch: pytest.MonkeyPatch, responses: list[bytes]) -> None:
        self.connections: list[tuple[str, int]] = []
        self.streams: list[SocketStream] = []

        async def connect(
            backend: httpcore.AnyIOBackend,
            host: str,
            port: int,
            timeout: float | None = None,  # noqa: ASYNC109 - httpcore interface
            local_address: str | None = None,
            socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
        ) -> httpcore.AsyncNetworkStream:
            self.connections.append((host, port))
            stream = SocketStream(responses[min(len(self.streams), len(responses) - 1)])
            self.streams.append(stream)
            return stream

        monkeypatch.setattr(httpcore.AnyIOBackend, "connect_tcp", connect)


OK = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
ERROR = b"HTTP/1.1 500 Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"


def config() -> FetcherConfig:
    return FetcherConfig(user_agent="TestBot", domain_delay_seconds=0, retry_backoff_base=0)


@pytest.mark.parametrize("address", ["93.184.216.34", "2606:4700:4700::1111"])
async def test_socket_uses_public_ip_preserving_host_and_verified_tls(
    monkeypatch: pytest.MonkeyPatch, address: str
) -> None:
    sockets = Sockets(monkeypatch, [OK])
    async with local_fetcher(config(), dns_resolver=Resolver([[address]])) as fetcher:
        result = await fetcher.fetch("https://example.org/page")
    assert result.status_code == 200
    assert sockets.connections == [(address, 443)]
    assert sockets.streams[0].server_hostname == "example.org"
    assert b"Host: example.org\r\n" in sockets.streams[0].written


async def test_rebinding_between_preflight_and_connection_never_opens_socket(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sockets = Sockets(monkeypatch, [OK])
    resolver = Resolver([["93.184.216.34"], ["127.0.0.1"]])
    async with local_fetcher(config(), dns_resolver=resolver) as fetcher:
        result = await fetcher.fetch("https://example.org/private")
    assert result.outcome == "ssrf_blocked"
    assert sockets.connections == []


async def test_retry_cannot_connect_to_rebound_private_address(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sockets = Sockets(monkeypatch, [ERROR, OK])
    resolver = Resolver([["93.184.216.34"], ["93.184.216.34"], ["169.254.169.254"]])
    async with local_fetcher(config(), dns_resolver=resolver) as fetcher:
        result = await fetcher.fetch("https://example.org/retry")
    assert result.outcome == "ssrf_blocked"
    assert sockets.connections == [("93.184.216.34", 443)]


async def test_environment_proxy_cannot_bypass_validated_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:8080")
    monkeypatch.setenv("ALL_PROXY", "http://proxy.example:8080")
    monkeypatch.setenv("NO_PROXY", "")
    sockets = Sockets(monkeypatch, [OK])
    async with local_fetcher(config(), dns_resolver=Resolver([["93.184.216.34"]])) as fetcher:
        result = await fetcher.fetch("https://example.org/page")
    assert result.status_code == 200
    assert sockets.connections == [("93.184.216.34", 443)]


async def test_redirect_rechecks_address_at_connection_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redirect = (
        b"HTTP/1.1 302 Found\r\nLocation: https://other.org/private\r\n"
        b"Content-Length: 0\r\nConnection: close\r\n\r\n"
    )
    sockets = Sockets(monkeypatch, [redirect, OK])
    resolver = Resolver([["93.184.216.34"], ["93.184.216.34"], ["93.184.216.35"], ["10.0.0.1"]])
    async with local_fetcher(config(), dns_resolver=resolver) as fetcher:
        result = await fetcher.fetch("https://example.org/page")
    assert result.outcome == "ssrf_blocked"
    assert result.final_url == "https://other.org/private"
    assert sockets.connections == [("93.184.216.34", 443)]


@pytest.mark.parametrize(
    ("answer", "outcome"),
    [([], "dns_fail"), (["93.184.216.34", "10.0.0.1"], "ssrf_blocked")],
)
async def test_connection_rejects_empty_or_mixed_public_private_dns(
    monkeypatch: pytest.MonkeyPatch, answer: list[str], outcome: str
) -> None:
    sockets = Sockets(monkeypatch, [OK])
    resolver = Resolver([["93.184.216.34"], answer])
    async with local_fetcher(config(), dns_resolver=resolver) as fetcher:
        result = await fetcher.fetch("https://example.org/page")
    assert result.outcome == outcome
    assert sockets.connections == []


async def test_shared_ip_does_not_share_connections_across_tls_origins(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sockets = Sockets(monkeypatch, [OK.replace(b"Connection: close\r\n", b"")])
    async with local_fetcher(config(), dns_resolver=Resolver([["93.184.216.34"]])) as fetcher:
        await fetcher.fetch("https://example.org/page")
        await fetcher.fetch("https://other.org/page")
    assert sockets.connections == [("93.184.216.34", 443), ("93.184.216.34", 443)]
    assert [stream.server_hostname for stream in sockets.streams] == ["example.org", "other.org"]


async def test_stream_errors_remain_httpx_errors_and_release_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sockets = Sockets(
        monkeypatch, [b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\nshort"]
    )
    transport = PublicHTTPTransport(Resolver([["93.184.216.34"]]))
    async with httpx.AsyncClient(transport=transport, trust_env=False) as client:
        with pytest.raises(httpx.RemoteProtocolError):
            await client.get("https://example.org/page")
    assert sockets.streams[0]._closed


def local_fetcher(config, dns_resolver, rate_limiter=None):
    from worker.fetch.rate_limiter import DomainRateLimiter

    return PoliteFetcher(
        config=config,
        dns_resolver=dns_resolver,
        rate_limiter=rate_limiter or DomainRateLimiter(config.domain_delay_seconds),
    )
