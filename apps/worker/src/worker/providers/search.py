"""Provider-neutral search results and failures."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class SearchResult:
    url: str
    title: str
    snippet: str
    position: int


@dataclass(frozen=True)
class SearchResponse:
    results: tuple[SearchResult, ...]
    credits_used: int
    meta: dict[str, int | float]


class SearchProvider(Protocol):
    async def search(
        self,
        query: str,
        gl: str | None,
        hl: str | None,
        location: str | None,
        num: int,
        page: int,
    ) -> SearchResponse: ...


class SearchProviderError(Exception):
    """A search request failed or its response could not be trusted."""


class SearchAuthError(SearchProviderError):
    """Credentials were rejected; do not retry."""


class SearchRateLimitError(SearchProviderError):
    """The provider refused the request due to a rate limit."""


class SearchServerError(SearchProviderError):
    """The provider or network failed temporarily."""


class SearchTimeoutError(SearchProviderError):
    """The provider request timed out."""


class SearchResponseError(SearchProviderError):
    """The provider returned an unusable successful response."""
