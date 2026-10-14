import pytest

from worker.config.settings import Settings


@pytest.mark.unit
def test_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://x")
    s = Settings()  # type: ignore[call-arg]
    assert s.heartbeat_seconds == 15


@pytest.mark.unit
def test_engine_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://x")
    s = Settings()  # type: ignore[call-arg]
    assert (s.poll_seconds, s.claim_batch, s.lease_seconds, s.max_attempts) == (5.0, 10, 120, 3)


@pytest.mark.unit
def test_runner_is_off_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://x")
    monkeypatch.delenv("RUNNER_ENABLED", raising=False)
    s = Settings()  # type: ignore[call-arg]
    assert s.runner_enabled is False
