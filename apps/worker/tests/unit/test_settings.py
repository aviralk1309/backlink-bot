import pytest

from worker.config.settings import Settings


@pytest.mark.unit
def test_defaults(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x")
    s = Settings()
    assert s.heartbeat_seconds == 15
