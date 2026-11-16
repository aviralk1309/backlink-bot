import json
from pathlib import Path

import httpx
import pytest
import respx
from tenacity import wait_none

from worker.providers import (
    FakeProvider,
    SearchAuthError,
    SearchProvider,
    SearchProviderError,
    SearchRateLimitError,
    SearchResponseError,
    SearchServerError,
    SearchTimeoutError,
    SerperProvider,
)
from worker.providers.serper import SEARCH_URL, parse_search_response

pytestmark = pytest.mark.unit
FIXTURE = Path(__file__).resolve().parents[4] / "fixtures/serp/search.json"


async def test_serper_sends_search_params_and_returns_only_selected_fields() -> None:
    with respx.mock:
        route = respx.post(SEARCH_URL).mock(
            return_value=httpx.Response(200, json=json.loads(FIXTURE.read_text()) | {"credits": 2})
        )
        async with SerperProvider("test-secret") as provider:
            typed_provider: SearchProvider = provider
            result = await typed_provider.search("write for us", "us", "en", "New York", 20, 2)

    assert route.call_count == 1
    request = route.calls[0].request
    assert str(request.url) == SEARCH_URL
    assert request.headers["X-API-KEY"] == "test-secret"
    assert json.loads(request.content) == {
        "q": "write for us",
        "gl": "us",
        "hl": "en",
        "location": "New York",
        "num": 20,
        "page": 2,
    }
    assert result.credits_used == 2
    assert result.meta == {"total_results": 1234, "time_taken": 0.42}
    assert [(r.url, r.title, r.snippet, r.position) for r in result.results] == [
        ("https://example.org/write-for-us", "Contribute", "Contributor guidelines", 1),
        ("https://example.net/resources", "Resources", "", 2),
    ]
    assert "sitelinks" not in vars(result.results[0])


async def test_fake_replays_fixture_credit_usage() -> None:
    provider: SearchProvider = FakeProvider({("write for us", 1): FIXTURE})
    result = await provider.search("write for us", None, None, None, 10, 1)
    assert result.credits_used == 1
    assert len(result.results) == 2
    with pytest.raises(SearchProviderError, match="No search fixture"):
        await provider.search("other", None, None, None, 10, 1)
    assert parse_search_response({"organic": [], "credits": 0}).credits_used == 0


@pytest.mark.parametrize("credits", [None, True, -1, "2", 1.5])
def test_invalid_credit_usage_is_rejected(credits: object) -> None:
    with pytest.raises(SearchResponseError, match="credit"):
        parse_search_response({"organic": [], "credits": credits})


def test_missing_credit_usage_is_rejected() -> None:
    with pytest.raises(SearchResponseError, match="credit"):
        parse_search_response({"organic": []})


@pytest.mark.parametrize(
    ("status", "error", "attempts"),
    [
        (401, SearchAuthError, 1),
        (403, SearchAuthError, 1),
        (400, SearchProviderError, 1),
        (302, SearchProviderError, 1),
        (429, SearchRateLimitError, 3),
        (503, SearchServerError, 3),
    ],
)
async def test_http_error_taxonomy_and_retry_count(
    monkeypatch: pytest.MonkeyPatch, status: int, error: type[Exception], attempts: int
) -> None:
    monkeypatch.setattr(SerperProvider._post.retry, "wait", wait_none())
    with respx.mock:
        route = respx.post(SEARCH_URL).mock(
            return_value=httpx.Response(
                status,
                text="secret must not appear in errors",
                headers={"location": "https://elsewhere.example/"} if status == 302 else {},
            )
        )
        async with SerperProvider("test-secret") as provider:
            with pytest.raises(error) as raised:
                await provider.search("query", None, None, None, 10, 1)
    assert route.call_count == attempts
    assert "test-secret" not in str(raised.value)
    assert "secret must not appear" not in str(raised.value)


async def test_timeout_does_not_repeat_possibly_charged_request() -> None:
    with respx.mock:
        route = respx.post(SEARCH_URL).mock(
            side_effect=[
                httpx.ReadTimeout("slow"),
                httpx.Response(200, json={"organic": [], "credits": 1}),
            ]
        )
        async with SerperProvider("test-secret") as provider:
            with pytest.raises(SearchTimeoutError):
                await provider.search("query", None, None, None, 10, 1)
    assert route.call_count == 1


async def test_timeout_keeps_timeout_category() -> None:
    with respx.mock:
        route = respx.post(SEARCH_URL).mock(side_effect=httpx.ReadTimeout("slow"))
        async with SerperProvider("test-secret") as provider:
            with pytest.raises(SearchTimeoutError):
                await provider.search("query", None, None, None, 10, 1)
    assert route.call_count == 1
