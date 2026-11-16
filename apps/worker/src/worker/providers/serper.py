"""Serper's Google Search API, with bounded retries and minimal result mapping."""

from __future__ import annotations

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_random_exponential

from worker.providers.search import (
    SearchAuthError,
    SearchProviderError,
    SearchRateLimitError,
    SearchResponse,
    SearchResponseError,
    SearchResult,
    SearchServerError,
    SearchTimeoutError,
)

SEARCH_URL = "https://google.serper.dev/search"


def parse_search_response(data: object) -> SearchResponse:
    if not isinstance(data, dict) or not isinstance(data.get("organic", []), list):
        raise SearchResponseError("Invalid Serper search response")

    credits = data.get("credits")
    if type(credits) is not int or credits < 0:
        raise SearchResponseError("Serper did not report valid per-call credit usage")

    results: list[SearchResult] = []
    for item in data.get("organic", []):
        if not isinstance(item, dict):
            continue
        url = item.get("link")
        position = item.get("position")
        if not isinstance(url, str) or not url or type(position) is not int or position < 1:
            continue
        title = item.get("title")
        snippet = item.get("snippet")
        results.append(
            SearchResult(
                url=url,
                title=title if isinstance(title, str) else "",
                snippet=snippet if isinstance(snippet, str) else "",
                position=position,
            )
        )

    meta: dict[str, int | float] = {}
    info = data.get("searchInformation")
    if isinstance(info, dict):
        for source, target in (("totalResults", "total_results"), ("timeTaken", "time_taken")):
            value = info.get(source)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
                meta[target] = value
    return SearchResponse(tuple(results), credits, meta)


class SerperProvider:
    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise ValueError("SERPER_API_KEY is required for search")
        self._api_key = api_key
        self._client = httpx.AsyncClient(timeout=10.0, trust_env=False, follow_redirects=False)

    async def __aenter__(self) -> SerperProvider:
        return self

    async def __aexit__(self, *args: object) -> None:
        await self._client.aclose()

    async def search(
        self,
        query: str,
        gl: str | None,
        hl: str | None,
        location: str | None,
        num: int,
        page: int,
    ) -> SearchResponse:
        if not query.strip() or num < 1 or page < 1:
            raise ValueError("Search requires a query, positive num and positive page")
        payload: dict[str, str | int] = {"q": query, "num": num, "page": page}
        payload.update({k: v for k, v in (("gl", gl), ("hl", hl), ("location", location)) if v})
        response = await self._post(payload)
        try:
            data = response.json()
        except ValueError as exc:
            raise SearchResponseError("Invalid Serper JSON response") from exc
        return parse_search_response(data)

    @retry(
        retry=retry_if_exception_type((SearchRateLimitError, SearchServerError)),
        stop=stop_after_attempt(3),
        wait=wait_random_exponential(multiplier=0.5, max=4),
        reraise=True,
    )
    async def _post(self, payload: dict[str, str | int]) -> httpx.Response:
        try:
            response = await self._client.post(
                SEARCH_URL,
                headers={"X-API-KEY": self._api_key, "Content-Type": "application/json"},
                json=payload,
                follow_redirects=False,
            )
        except httpx.TimeoutException as exc:
            raise SearchTimeoutError("Serper request timed out") from exc
        except httpx.RequestError as exc:
            raise SearchServerError("Serper network request failed") from exc
        if response.status_code in (401, 403):
            raise SearchAuthError("Serper rejected the API key")
        if response.status_code == 429:
            raise SearchRateLimitError("Serper rate limit exceeded")
        if response.status_code >= 500:
            raise SearchServerError(f"Serper HTTP {response.status_code}")
        if response.status_code != 200:
            raise SearchProviderError(f"Serper HTTP {response.status_code}")
        return response
