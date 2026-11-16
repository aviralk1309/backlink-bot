"""HTTP transport that validates and pins DNS at the socket boundary.

The pool retains the original origin for Host, TLS verification and connection
reuse. Only TCP receives an IP literal, so it cannot resolve the hostname again.
Uses the public httpcore backend/pool and httpx transport interfaces.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterable, Iterator
from contextlib import contextmanager

import httpcore
import httpx

from worker.fetch.ssrf import DNSResolver, validate_target_url


class PublicNetworkBackend(httpcore.AsyncNetworkBackend):
    def __init__(self, resolver: DNSResolver) -> None:
        self._resolver = resolver
        self._backend = httpcore.AnyIOBackend()

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,  # noqa: ASYNC109 - httpcore interface
        local_address: str | None = None,
        socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        # Scheme is immaterial to TCP; the original request controls TLS in the
        # pool. URL validation enforces the same host/IP/port policy as preflight.
        target = httpx.URL("http://placeholder").copy_with(host=host, port=port)
        try:
            async with asyncio.timeout(timeout):
                _, _, addresses = await validate_target_url(str(target), self._resolver)
                last_error: Exception | None = None
                for address in dict.fromkeys(addresses):
                    try:
                        return await self._backend.connect_tcp(
                            str(address),
                            port,
                            timeout=timeout,
                            local_address=local_address,
                            socket_options=socket_options,
                        )
                    except (httpcore.ConnectError, httpcore.ConnectTimeout) as exc:
                        last_error = exc
                assert last_error is not None  # validation refuses an empty answer
                raise last_error
        except TimeoutError as exc:
            raise httpcore.ConnectTimeout("DNS/connect deadline exceeded") from exc


_ERRORS: dict[type[Exception], type[httpx.HTTPError]] = {
    httpcore.ConnectTimeout: httpx.ConnectTimeout,
    httpcore.ReadTimeout: httpx.ReadTimeout,
    httpcore.WriteTimeout: httpx.WriteTimeout,
    httpcore.PoolTimeout: httpx.PoolTimeout,
    httpcore.ConnectError: httpx.ConnectError,
    httpcore.ReadError: httpx.ReadError,
    httpcore.WriteError: httpx.WriteError,
    httpcore.LocalProtocolError: httpx.LocalProtocolError,
    httpcore.RemoteProtocolError: httpx.RemoteProtocolError,
    httpcore.UnsupportedProtocol: httpx.UnsupportedProtocol,
}


@contextmanager
def _http_errors() -> Iterator[None]:
    try:
        yield
    except tuple(_ERRORS) as exc:
        for source, target in _ERRORS.items():
            if isinstance(exc, source):
                raise target(str(exc)) from exc
        raise


class _ResponseStream(httpx.AsyncByteStream):
    def __init__(self, response: httpcore.Response) -> None:
        self._response = response

    async def __aiter__(self) -> AsyncIterator[bytes]:
        with _http_errors():
            async for chunk in self._response.aiter_stream():
                yield chunk

    async def aclose(self) -> None:
        with _http_errors():
            await self._response.aclose()


class PublicHTTPTransport(httpx.AsyncBaseTransport):
    def __init__(self, resolver: DNSResolver) -> None:
        self._pool = httpcore.AsyncConnectionPool(
            network_backend=PublicNetworkBackend(resolver),
            # No proxy, UDS, alternate SNI, or implicit connection retries.
            # Retries and redirects are owned by PoliteFetcher.
            retries=0,
        )

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        assert isinstance(request.stream, httpx.AsyncByteStream)
        core_request = httpcore.Request(
            method=request.method,
            url=httpcore.URL(
                scheme=request.url.raw_scheme,
                host=request.url.raw_host,
                port=request.url.port,
                target=request.url.raw_path,
            ),
            headers=request.headers.raw,
            content=request.stream,
            extensions={"timeout": request.extensions.get("timeout", {})},
        )
        with _http_errors():
            response = await self._pool.handle_async_request(core_request)
        return httpx.Response(
            response.status,
            headers=response.headers,
            stream=_ResponseStream(response),
            extensions=response.extensions,
        )

    async def aclose(self) -> None:
        await self._pool.aclose()
