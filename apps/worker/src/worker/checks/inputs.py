"""Pinned inputs for deterministic free checks; defaults are initial calibration values."""

from pydantic import BaseModel, Field

from worker.fetch.domain_cache import DomainFacts


class Structure(BaseModel):
    link_list: bool = False
    min_outbound_links: int = Field(default=10, ge=0)


class PageSignals(BaseModel):
    url_patterns: list[str] = Field(default_factory=list)
    title_phrases: list[str] = Field(default_factory=list)
    heading_phrases: list[str] = Field(default_factory=list)
    body_phrases: list[str] = Field(default_factory=list)
    structure: Structure = Field(default_factory=Structure)


class FieldWeights(BaseModel):
    title: float = Field(default=3, ge=0, le=100, allow_inf_nan=False)
    headings: float = Field(default=2, ge=0, le=100, allow_inf_nan=False)
    meta: float = Field(default=2, ge=0, le=100, allow_inf_nan=False)
    body: float = Field(default=1, ge=0, le=100, allow_inf_nan=False)


class RelevanceRule(BaseModel):
    field_weights: FieldWeights = Field(default_factory=FieldWeights)
    min_score: float = Field(default=0.2, ge=0, le=1, allow_inf_nan=False)


class ActivityProfile(BaseModel):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    version: int = Field(default=1, ge=1)
    enabled: bool = True
    page_type_signals: PageSignals = Field(default_factory=PageSignals)
    relevance_rule: RelevanceRule = Field(default_factory=RelevanceRule)


class CheckSettings(BaseModel):
    language_min_letters: int = Field(default=120, ge=20, le=10000)
    language_confidence: float = Field(default=0.9, ge=0.5, le=1, allow_inf_nan=False)
    language_margin: float = Field(default=0.2, ge=0, le=1, allow_inf_nan=False)
    thin_content_words: int = Field(default=100, ge=0)
    outbound_link_limit: int = Field(default=100, ge=1)
    outbound_link_ratio: float = Field(default=0.8, ge=0, le=1, allow_inf_nan=False)
    outbound_ratio_min_links: int = Field(default=20, ge=1)
    spam_terms: list[str] = Field(
        default_factory=lambda: ["online casino", "buy viagra", "payday loan"]
    )
    suspicious_tlds: list[str] = Field(default_factory=lambda: ["xyz", "top", "click"])
    banned_category_terms: dict[str, list[str]] = Field(
        default_factory=lambda: {
            "gambling": ["casino", "sports betting", "online poker"],
            "pharma": ["buy viagra", "buy cialis", "no prescription"],
            "adult": ["porn", "pornography"],
        }
    )
    activity_min_score: float = Field(default=0.2, ge=0, le=1, allow_inf_nan=False)
    relevance_rule: RelevanceRule = Field(default_factory=RelevanceRule)


class JobCheckConfig(BaseModel):
    language: str | None = None
    country: str | None = None
    regions: list[str] = Field(default_factory=list)
    seed_keywords: list[str] = Field(default_factory=list)
    brand_variants: list[str] = Field(default_factory=list)
    sub_niche: str | None = None
    activity_keys: list[str] = Field(default_factory=list)
    banned_categories: list[str] = Field(default_factory=list)
    require_language_region_match: bool = False
    check_settings: CheckSettings = Field(default_factory=CheckSettings)


__all__ = ["ActivityProfile", "CheckSettings", "DomainFacts", "JobCheckConfig"]
