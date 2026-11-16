"""Versioned, serializable scoring policy. Never reads live configuration in score()."""

from importlib.resources import files
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Weights(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
    relevance: int = Field(ge=0, le=100)
    language_region: int = Field(ge=0, le=100)
    activity_fit: int = Field(ge=0, le=100)
    overlap: int = Field(ge=0, le=100)
    multi_query: int = Field(ge=0, le=100)
    spam_penalty: int = Field(ge=0, le=100)

    @model_validator(mode="after")
    def total(self) -> Self:
        if sum(self.model_dump().values()) - self.spam_penalty != 100:
            raise ValueError("Positive scoring weights must sum to 100")
        return self


class ScoringConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
    version: int = Field(ge=1)
    weights: Weights
    high_threshold: float = Field(ge=0, le=100, allow_inf_nan=False)
    medium_threshold: float = Field(ge=0, le=100, allow_inf_nan=False)
    overlap_half_saturation: int = Field(ge=1)
    query_half_saturation: int = Field(ge=1)
    spam_signal_cap: int = Field(ge=1)

    @model_validator(mode="after")
    def thresholds(self) -> Self:
        if self.medium_threshold >= self.high_threshold:
            raise ValueError("Medium threshold must be below High")
        return self


class ProfileWeights(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
    version: int = Field(ge=1)
    weights: Weights | None = None


class ScoringSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
    policy: ScoringConfig
    profiles: dict[str, ProfileWeights] = Field(default_factory=dict)


DEFAULT_CONFIG = ScoringConfig.model_validate_json(
    files("worker.scoring").joinpath("defaults.json").read_text()
)


def from_job_snapshot(snapshot: dict[str, object]) -> ScoringSnapshot:
    """Old immutable job histories use v1 defaults; never silently read live weights."""
    if "scoring" not in snapshot:
        return ScoringSnapshot(policy=DEFAULT_CONFIG)
    return ScoringSnapshot.model_validate(snapshot["scoring"])
