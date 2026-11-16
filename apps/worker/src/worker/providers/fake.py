"""Fixture replay for search tests; no network access."""

import json
from collections.abc import Mapping
from pathlib import Path

from worker.providers.search import SearchProviderError, SearchResponse
from worker.providers.serper import parse_search_response


class FakeProvider:
    def __init__(self, fixtures: Mapping[tuple[str, int], Path]) -> None:
        self.fixtures = fixtures

    async def search(
        self,
        query: str,
        gl: str | None,
        hl: str | None,
        location: str | None,
        num: int,
        page: int,
    ) -> SearchResponse:
        try:
            path = self.fixtures[(query, page)]
        except KeyError as exc:
            raise SearchProviderError(f"No search fixture for page {page}") from exc
        return parse_search_response(json.loads(path.read_text(encoding="utf-8")))
