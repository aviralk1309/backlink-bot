from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    log_level: str = "INFO"
    heartbeat_seconds: int = 15

    # Job engine (M3-D3 defaults). Bounds match the SQL function checks.
    poll_seconds: float = Field(default=5.0, gt=0)
    claim_batch: int = Field(default=10, ge=1, le=100)
    worker_concurrency: int = Field(default=4, ge=1, le=100)
    lease_seconds: int = Field(default=120, ge=10, le=3600)
    max_attempts: int = Field(default=3, ge=1)
    shutdown_grace_seconds: float = Field(default=30.0, ge=0)
    pool_max_size: int = Field(default=10, ge=2)
    runner_enabled: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
