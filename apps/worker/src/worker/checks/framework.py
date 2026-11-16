"""Ordered checks over one fetched page; no network or persistence side effects."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from functools import cached_property
from string import Formatter
from types import MappingProxyType
from typing import Literal, Protocol

from pydantic import JsonValue

from worker.checks.inputs import ActivityProfile, DomainFacts, JobCheckConfig
from worker.checks.page import Page
from worker.fetch.types import FetchResult

CheckStatus = Literal["pass", "fail", "could_not_check"]
_STATUSES = {"pass", "fail", "could_not_check"}
_KEY = re.compile(r"[a-z][a-z0-9_]{0,63}\Z")


@dataclass(frozen=True)
class CheckContext:
    fetch: FetchResult
    config_version: int
    config: Mapping[str, JsonValue] = field(default_factory=dict)

    robots_txt: str | None = None
    domain_facts: DomainFacts | None = None
    activity_profiles: tuple[ActivityProfile, ...] = ()

    @cached_property
    def page(self) -> Page:
        return Page.from_fetch(self.fetch)

    @cached_property
    def job(self) -> JobCheckConfig:
        return JobCheckConfig.model_validate(dict(self.config))

    def __post_init__(self) -> None:
        if type(self.config_version) is not int or self.config_version < 1:
            raise ValueError("config_version must be a positive integer")


@dataclass(frozen=True)
class CheckResult:
    status: CheckStatus
    reason_code: str
    detail: str = ""
    evidence: dict[str, JsonValue] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.status not in _STATUSES or not _KEY.fullmatch(self.reason_code):
            raise ValueError("Invalid check status or reason code")
        if len(self.detail) > 2000 or "\x00" in self.detail:
            raise ValueError("Check detail must fit 2000 characters and contain no NUL")
        if not isinstance(self.evidence, dict):
            raise ValueError("Check evidence must be an object")

        # Reject non-JSON values, non-finite numbers and non-string object keys.
        def validate(value: object) -> None:
            if isinstance(value, dict):
                for key, child in value.items():
                    if not isinstance(key, str):
                        raise ValueError("Evidence keys must be strings")
                    validate(key)
                    validate(child)
            elif isinstance(value, list):
                for child in value:
                    validate(child)
            elif isinstance(value, str):
                if "\x00" in value:
                    raise ValueError("Evidence cannot contain NUL")
            elif value is not None and type(value) not in (bool, int, float):
                raise ValueError("Evidence must contain only JSON values")

        validate(self.evidence)
        encoded = json.dumps(self.evidence, allow_nan=False, ensure_ascii=False).encode("utf-8")
        if len(encoded) > 16384:
            raise ValueError("Check evidence exceeds 16 KiB; store signals, not page bodies")
        object.__setattr__(self, "evidence", json.loads(encoded))


class Check(Protocol):
    async def run(self, context: CheckContext) -> CheckResult: ...


@dataclass(frozen=True)
class Reason:
    status: CheckStatus
    template: str
    priority: int = 0

    def __post_init__(self) -> None:
        if self.status not in _STATUSES or not self.template.strip():
            raise ValueError("Reason requires a valid status and human-readable template")
        for _, name, spec, conversion in Formatter().parse(self.template):
            if name is not None and (not _KEY.fullmatch(name) or spec or conversion):
                raise ValueError("Templates support simple evidence fields only")

    def render(self, evidence: Mapping[str, JsonValue]) -> str:
        return self.template.format_map(evidence)


@dataclass(frozen=True)
class CheckDefinition:
    """One catalog entry registers the class, order, reasons and stopping policy."""

    key: str
    check: Check
    order: int
    reasons: Mapping[str, Reason]
    stop_on: frozenset[CheckStatus] = frozenset()


@dataclass(frozen=True)
class CheckRecord:
    check_key: str
    result: CheckResult


@dataclass(frozen=True)
class CheckRun:
    config_version: int
    records: tuple[CheckRecord, ...]
    stopped_after: str | None = None


class CheckRegistry:
    def __init__(self, definitions: Sequence[CheckDefinition]) -> None:
        if not 1 <= len(definitions) <= 64:
            raise ValueError("A check registry requires between one and 64 checks")
        self._definitions = tuple(
            replace(d, reasons=MappingProxyType(dict(d.reasons)))
            for d in sorted(definitions, key=lambda d: (d.order, d.key))
        )
        self._reasons: dict[str, Reason] = {}
        keys: set[str] = set()
        for definition in self._definitions:
            if not _KEY.fullmatch(definition.key) or definition.key in keys:
                raise ValueError("Invalid or duplicate check key")
            if not definition.reasons or not definition.stop_on <= _STATUSES:
                raise ValueError("Check requires reasons and valid stop statuses")
            keys.add(definition.key)
            for code, reason in definition.reasons.items():
                if not _KEY.fullmatch(code) or code in self._reasons:
                    raise ValueError("Invalid or duplicate reason code")
                self._reasons[code] = reason

    async def run(self, context: CheckContext) -> CheckRun:
        records: list[CheckRecord] = []
        for definition in self._definitions:
            result = await definition.check.run(context)
            # Revalidate mutable evidence before publication; programming errors
            # propagate rather than turning into an adverse site-quality verdict.
            result = CheckResult(result.status, result.reason_code, result.detail, result.evidence)
            reason = definition.reasons.get(result.reason_code)
            if reason is None or reason.status != result.status:
                raise ValueError(f"Undeclared result from {definition.key}: {result.reason_code}")
            reason.render(result.evidence)  # Missing template evidence fails before persistence.
            records.append(CheckRecord(definition.key, result))
            if result.status in definition.stop_on:
                return CheckRun(context.config_version, tuple(records), definition.key)
        return CheckRun(context.config_version, tuple(records))

    def top_reasons(self, run: CheckRun, limit: int = 3) -> list[str]:
        if not 0 <= limit <= 3:
            raise ValueError("Summary limit must be between zero and three")
        # Priority describes explanatory importance, not score. Stable ties
        # preserve execution order; S7 owns scoring contributions and weights.
        ranked = sorted(run.records, key=lambda r: -self._reasons[r.result.reason_code].priority)
        return [
            self._reasons[r.result.reason_code].render(r.result.evidence) for r in ranked[:limit]
        ]
