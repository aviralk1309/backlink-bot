from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

FetchOutcome = Literal[
    "ok",
    "could_not_check",
    "http_4xx",
    "http_5xx",
    "timeout",
    "dns_fail",
    "tls_error",
    "blocked_suspected",
    "js_only_suspected",
    "non_html",
    "too_large",
    "ssrf_blocked",
    "too_many_redirects",
]


class SSRFBlockedError(ValueError):
    """Raised when a URL target violates SSRF protection rules."""


class DNSResolutionError(RuntimeError):
    """Raised when DNS resolution for a host fails."""


@dataclass(frozen=True)
class RedirectStep:
    url: str
    status_code: int


@dataclass
class FetchResult:
    url: str
    final_url: str
    outcome: FetchOutcome
    reason_code: str | None = None
    status_code: int | None = None
    redirect_chain: list[RedirectStep] = field(default_factory=list)
    content: bytes = b""
    text: str | None = None
    content_type: str | None = None
    headers: dict[str, str] = field(default_factory=dict)
    x_robots_tags: list[str] = field(default_factory=list)
    robots_txt: str | None = None
    error_message: str | None = None
    elapsed_seconds: float = 0.0

    def to_summary_dict(self) -> dict[str, Any]:
        """Summary representation suitable for storing in opportunities.fetch_summary."""
        return {
            "outcome": self.outcome,
            "reason_code": self.reason_code,
            "status_code": self.status_code,
            "final_url": self.final_url,
            "redirect_chain": [
                {"url": step.url, "status_code": step.status_code} for step in self.redirect_chain
            ],
            "error_message": self.error_message,
            "elapsed_seconds": round(self.elapsed_seconds, 3),
        }
