import json
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
import respx

from worker.providers.serper import SEARCH_URL

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import verify_serper_credits  # noqa: E402

pytestmark = pytest.mark.unit


def test_three_call_limit_and_report(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    monkeypatch.setattr(
        verify_serper_credits, "Settings", lambda: SimpleNamespace(serper_api_key="test-key")
    )
    with respx.mock:
        route = respx.post(SEARCH_URL).mock(
            side_effect=[
                httpx.Response(200, json={"organic": [], "credits": 1}),
                httpx.Response(200, json={"organic": [], "credits": 2}),
                httpx.Response(200, json={"organic": [], "credits": 1}),
            ]
        )
        report = tmp_path / "credit-report.md"
        assert verify_serper_credits.run(True, report) == 0
    assert route.call_count == 3
    assert [
        (json.loads(call.request.content)["num"], json.loads(call.request.content)["page"])
        for call in route.calls
    ] == [(10, 1), (20, 1), (10, 2)]
    assert "| 20 results | 20 | 1 | 200 | 0 | 2 | unreported |" in report.read_text()
    assert "Reported total: 4 credits across 3 calls." in report.read_text()
    assert "test-key" not in report.read_text()


def test_unreported_body_credits_keep_verification_incomplete(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    monkeypatch.setattr(
        verify_serper_credits, "Settings", lambda: SimpleNamespace(serper_api_key="test-key")
    )
    with respx.mock:
        route = respx.post(SEARCH_URL).mock(return_value=httpx.Response(200, json={"organic": []}))
        report = tmp_path / "credit-report.md"
        assert verify_serper_credits.run(True, report) == 1
    assert route.call_count == 3
    assert "Status: incomplete" in report.read_text()


def test_guard_stops_ci_before_any_call(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CI", "true")
    with pytest.raises(SystemExit, match="must not run in CI"):
        verify_serper_credits.run(True, tmp_path / "should-not-exist.md")
    assert not (tmp_path / "should-not-exist.md").exists()
