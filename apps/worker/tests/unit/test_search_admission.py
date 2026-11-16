import pytest

from worker.engine.search import search_result_rejection
from worker.urls.normalize import normalize_url

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "raw",
    [
        "https://www.google.com/goto?url=CAESabc",
        "https://google.co.in/url?q=https%3A%2F%2Fexample.org",
        "https://google.com/search?q=yoga",
    ],
)
def test_rejects_search_navigation_urls(raw: str) -> None:
    assert search_result_rejection(normalize_url(raw)) == "search_redirect"


@pytest.mark.parametrize(
    "raw",
    [
        "https://example.org/resources",
        "https://sites.google.com/view/yoga-resources",
        "https://google.com/about",
    ],
)
def test_keeps_ordinary_pages(raw: str) -> None:
    assert search_result_rejection(normalize_url(raw)) is None


def test_rejects_invalid_url() -> None:
    assert search_result_rejection(normalize_url("javascript:alert(1)")) == "invalid_url"
