"""Operator-only, three-call Serper credit check. Never run in CI."""

import argparse
import os
from datetime import UTC, datetime
from pathlib import Path

import httpx

from worker.config.settings import Settings
from worker.providers.serper import SEARCH_URL

REPORT = Path(__file__).resolve().parents[3] / "docs/serper-credit-verification.md"
CASES = (("10 results", 10, 1), ("20 results", 20, 1), ("page 2", 10, 2))
QUERY = "backlink outreach"


def credit(value: object) -> str:
    if value is None:
        return "unreported"
    if type(value) is int and value >= 0:
        return str(value)
    return "invalid"


def run(confirm_spend: bool, report: Path = REPORT) -> int:
    if os.environ.get("CI") or os.environ.get("GITHUB_ACTIONS"):
        raise SystemExit("Credit verification must not run in CI")
    if not confirm_spend:
        raise SystemExit("Pass --confirm-spend to authorize up to three Serper calls")
    key = Settings().serper_api_key  # type: ignore[call-arg]
    if not key:
        raise SystemExit("Set SERPER_API_KEY in the worker environment before running")

    rows: list[str] = []
    body_fields: set[str] = set()
    header_fields: set[str] = set()
    reported = True
    total_credits = 0
    result_counts: dict[str, int] = {}
    with httpx.Client(timeout=10.0, trust_env=False, follow_redirects=False) as client:
        for label, num, page in CASES:
            try:
                response = client.post(
                    SEARCH_URL,
                    headers={"X-API-KEY": key, "Content-Type": "application/json"},
                    json={"q": QUERY, "num": num, "page": page},
                    follow_redirects=False,
                )
            except httpx.RequestError:
                rows.append(
                    f"| {label} | {num} | {page} | request error | unknown "
                    "| unreported | unreported |"
                )
                reported = False
                break
            try:
                data = response.json() if response.status_code == 200 else {}
            except ValueError:
                data = None
            if not isinstance(data, dict):
                rows.append(
                    f"| {label} | {num} | {page} | {response.status_code} "
                    "| invalid JSON | unreported | unreported |"
                )
                reported = False
                break
            body_fields.update(k for k in data if "credit" in k.lower())
            header_fields.update(k for k in response.headers if "credit" in k.lower())
            organic = data.get("organic", [])
            result_count = str(len(organic)) if isinstance(organic, list) else "invalid"
            if isinstance(organic, list):
                result_counts[label] = len(organic)
            body_credit = credit(data.get("credits"))
            if body_credit.isdigit():
                total_credits += int(body_credit)
            header_value = response.headers.get("x-credits-used", "")
            header_credit = (
                credit(int(header_value))
                if header_value.isdigit()
                else ("invalid" if header_value else "unreported")
            )
            rows.append(
                f"| {label} | {num} | {page} | {response.status_code} | {result_count} "
                f"| {body_credit} | {header_credit} |"
            )
            if (
                response.status_code != 200
                or result_count == "invalid"
                or not body_credit.isdigit()
                or (
                    body_credit.isdigit()
                    and header_credit.isdigit()
                    and body_credit != header_credit
                )
            ):
                reported = False
            if response.status_code != 200:
                break

    complete = len(rows) == len(CASES) and reported
    conclusions = (
        [
            f"Reported total: {total_credits} credits across {len(CASES)} calls.",
            "The `num=20` request returned no more organic results than `num=10`; "
            "use 10 as the default until more results are demonstrated."
            if result_counts["20 results"] <= result_counts["10 results"]
            else "The `num=20` request returned more organic results; compare its reported cost.",
            "Page 2 was a separate call. Dashboard balance was not independently reconciled.",
        ]
        if complete
        else ["Per-call credit reporting remains unverified; keep paid search disabled."]
    )
    text = "\n".join(
        [
            "# Serper credit verification",
            "",
            f"Status: {'completed' if complete else 'incomplete'} on "
            f"{datetime.now(UTC).date()} (UTC).",
            "",
            "Operator run: three sequential requests maximum; no retries or raw responses saved.",
            f"Query: `{QUERY}`. Check the account dashboard against reported values.",
            "",
            "| Case | num | page | HTTP | organic results | body `credits` "
            "| header `x-credits-used` |",
            "|---|---:|---:|---:|---:|---:|---:|",
            *rows,
            "",
            f"Credit-related body fields: {', '.join(sorted(body_fields)) or 'none'}.",
            f"Credit-related header fields: {', '.join(sorted(header_fields)) or 'none'}.",
            "",
            *conclusions,
            "",
            "`unreported` is unknown, never zero. The provider requires a valid body "
            "`credits` value before accepting a search response.",
            "M8-S5 must count that value; a timed-out call has uncertain spend.",
            "",
        ]
    )
    report.write_text(text, encoding="utf-8")
    print(text)
    return 0 if complete else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-spend", action="store_true")
    args = parser.parse_args()
    raise SystemExit(run(args.confirm_spend))
