from pathlib import Path

import pytest

from worker.config.settings import Settings, get_settings


@pytest.mark.unit
def test_worker_profile_selects_its_env_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    (tmp_path / ".env.local").write_text("DATABASE_URL=postgresql://worker@127.0.0.1/postgres\n")
    (tmp_path / ".env.production").write_text(
        "DATABASE_URL=postgresql://worker@cloud.example/postgres\n"
    )
    try:
        monkeypatch.setenv("WORKER_ENV", "local")
        get_settings.cache_clear()
        assert get_settings().database_url == "postgresql://worker@127.0.0.1/postgres"
        monkeypatch.setenv("WORKER_ENV", "production")
        get_settings.cache_clear()
        assert get_settings().database_url == "postgresql://worker@cloud.example/postgres"
        (tmp_path / ".env.production").write_text("DATABASE_URL=\n")
        get_settings.cache_clear()
        with pytest.raises(ValueError, match="restricted worker role"):
            get_settings()
        monkeypatch.setenv("WORKER_ENV", "local")
        (tmp_path / ".env.local").write_text(
            "DATABASE_URL=postgresql://worker@cloud.example/postgres\n"
        )
        get_settings.cache_clear()
        with pytest.raises(ValueError, match="must use local"):
            get_settings()
    finally:
        get_settings.cache_clear()


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
def test_runner_is_on_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://x")
    monkeypatch.delenv("RUNNER_ENABLED", raising=False)
    s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert s.runner_enabled is True


@pytest.mark.unit
def test_live_search_is_off_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://x")
    monkeypatch.delenv("SEARCH_ENABLED", raising=False)
    s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert s.search_enabled is False


@pytest.mark.unit
def test_storage_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://x")
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:54321")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "secret-key")
    s = Settings()  # type: ignore[call-arg]
    assert s.supabase_url == "http://127.0.0.1:54321"
    assert s.supabase_service_role_key == "secret-key"


@pytest.mark.unit
def test_csv_row_limit_default_and_positive_bound() -> None:
    from pydantic import ValidationError

    assert Settings(database_url="postgresql://x", _env_file=None).csv_max_rows == 2_000_000
    with pytest.raises(ValidationError):
        Settings(database_url="postgresql://x", csv_max_rows=0, _env_file=None)
