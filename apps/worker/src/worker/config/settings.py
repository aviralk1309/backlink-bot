import os
from functools import lru_cache
from urllib.parse import urlsplit

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env.local", extra="ignore")

    database_url: str
    log_level: str = "INFO"
    heartbeat_seconds: int = 15

    # Storage (M4)
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    serper_api_key: str = ""
    search_enabled: bool = False
    csv_lease_seconds: int = Field(default=120, ge=10, le=3600)
    csv_max_rows: int = Field(default=2_000_000, ge=1)
    csv_max_attempts: int = Field(default=3, ge=1)
    csv_processing_timeout_seconds: float = Field(default=900.0, gt=0)

    # Job engine (M3-D3 defaults). Bounds match the SQL function checks.
    poll_seconds: float = Field(default=5.0, gt=0)
    claim_batch: int = Field(default=10, ge=1, le=100)
    worker_concurrency: int = Field(default=4, ge=1, le=100)
    lease_seconds: int = Field(default=120, ge=10, le=3600)
    max_attempts: int = Field(default=3, ge=1)
    shutdown_grace_seconds: float = Field(default=30.0, ge=0)
    pool_max_size: int = Field(default=10, ge=2)
    runner_enabled: bool = True

    # Fetcher (M5-S1)
    bot_user_agent: str = "BacklinkBot/1.0 (+https://example.com/bot; bot@example.com)"
    fetch_connect_timeout: float = Field(default=5.0, gt=0)
    fetch_total_timeout: float = Field(default=15.0, gt=0)
    fetch_max_redirects: int = Field(default=5, ge=0, le=20)
    fetch_max_body_bytes: int = Field(default=2 * 1024 * 1024, ge=1024)
    fetch_domain_delay_seconds: float = Field(default=2.0, ge=0.0, le=3600)
    fetch_max_retries: int = Field(default=2, ge=0, le=5)
    fetch_concurrency: int = Field(default=10, ge=1, le=100)
    site_crawl_enabled: bool = False
    link_verification_enabled: bool = False


@lru_cache
def get_settings() -> Settings:
    profile = os.environ.get("WORKER_ENV", "local")
    if profile not in ("local", "production"):
        raise ValueError("WORKER_ENV must be local or production")
    settings = Settings(_env_file=f".env.{profile}")  # type: ignore[call-arg]
    if not settings.database_url:
        raise ValueError(f"Set DATABASE_URL in .env.{profile} to a restricted worker role")
    if profile == "local" and (
        urlsplit(settings.database_url).hostname not in ("127.0.0.1", "localhost")
        or (
            settings.supabase_url
            and urlsplit(settings.supabase_url).hostname not in ("127.0.0.1", "localhost")
        )
    ):
        raise ValueError("Local worker profile must use local Postgres and Storage")
    return settings
