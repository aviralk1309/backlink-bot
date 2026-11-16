"""Explainable region, spam, activity and banned-category heuristics."""

from __future__ import annotations

from urllib.parse import unquote, urlsplit

from pydantic import JsonValue

from worker.checks.framework import CheckContext, CheckResult
from worker.checks.page import contains, tokens
from worker.checks.text import normalized, phrase_in


def region_code(tag: str) -> str | None:
    parts = tag.replace("_", "-").split("-")
    for part in parts[1:]:
        if len(part) == 2 and part.isalpha():
            return "GB" if part.upper() == "UK" else part.upper()
    return None


class Region:
    async def run(self, context: CheckContext) -> CheckResult:
        job, page = context.job, context.page
        if not job.require_language_region_match:
            return CheckResult("pass", "region_disabled")
        target = (job.country or "").upper()
        target = "GB" if target == "UK" else target
        if not target and not job.regions:
            return CheckResult("could_not_check", "region_not_configured")
        host = urlsplit(context.fetch.final_url).hostname or ""
        suffix = host.rsplit(".", 1)[-1].upper()
        # These ccTLDs commonly represent generic/global services; do not infer geography.
        cctld = (
            ("GB" if suffix == "UK" else suffix)
            if len(suffix) == 2
            and suffix.isalpha()
            and suffix not in ("IO", "AI", "CO", "ME", "TV", "FM", "CC", "WS", "TO")
            else None
        )
        lang_region = region_code(page.html_lang)
        alternatives = sorted({code for tag in page.hreflangs if (code := region_code(tag))})
        text_regions = [r for r in job.regions if contains(page.body, r)]
        evidence: dict[str, JsonValue] = {
            "target": target or None,
            "cctld": cctld,
            "html_region": lang_region,
            "alternate_regions": [value for value in alternatives[:20]],
            "content_matches": [r[:120] for r in text_regions[:20]],
        }
        if text_regions or target and target in (cctld, lang_region):
            if cctld and lang_region and cctld != lang_region:
                return CheckResult("could_not_check", "region_conflicting", evidence=evidence)
            return CheckResult("pass", "region_matches", evidence=evidence)
        # Alternate translations describe other pages, not this page's location.
        if cctld and lang_region and cctld == lang_region and target and cctld != target:
            return CheckResult("fail", "region_mismatch", evidence=evidence)
        return CheckResult("could_not_check", "region_unknown", evidence=evidence)


class SpamSignals:
    async def run(self, context: CheckContext) -> CheckResult:
        page, settings = context.page, context.job.check_settings
        words = len(tokens(page.body))
        ratio = page.outbound_links / page.link_count if page.link_count else 0
        signals: list[str] = []
        if page.outbound_links > settings.outbound_link_limit:
            signals.append("spam_outbound_count")
        if (
            page.link_count >= settings.outbound_ratio_min_links
            and ratio > settings.outbound_link_ratio
        ):
            signals.append("spam_outbound_ratio")
        # Whitespace word counts are not meaningful for CJK; preserve that uncertainty.
        cjk = any("\u3400" <= c <= "\u9fff" or "\u3040" <= c <= "\u30ff" for c in page.body)
        if not cjk and words < settings.thin_content_words:
            signals.append("spam_thin_content")
        text = normalized(" ".join((page.title, page.headings, page.body)))
        matched = [term for term in settings.spam_terms if phrase_in(text, normalized(term))]
        if matched:
            signals.append("spam_keywords")
        facts = context.domain_facts
        if (
            facts
            and facts.has_contact_page is False
            and facts.has_about_page is False
            and not page.contact_link
            and not page.about_link
        ):
            signals.append("spam_missing_contact_about")
        suffix = (urlsplit(context.fetch.final_url).hostname or "").rsplit(".", 1)[-1].lower()
        if suffix in {t.lower().lstrip(".") for t in settings.suspicious_tlds}:
            signals.append("spam_suspicious_tld")
        evidence: dict[str, JsonValue] = {
            "signals": [value for value in signals],
            "word_count": words,
            "thin_content_evaluated": not cjk,
            "outbound_links": page.outbound_links,
            "total_links": page.link_count,
            "outbound_ratio": round(ratio, 4),
            "matched_terms": [t[:120] for t in matched[:20]],
            "contact_link": page.contact_link,
            "about_link": page.about_link,
            "domain_contact": facts.has_contact_page if facts else None,
            "domain_about": facts.has_about_page if facts else None,
        }
        return CheckResult(
            "fail" if signals else "pass",
            signals[0] if signals else "spam_no_signals",
            evidence=evidence,
        )


class ActivityFit:
    async def run(self, context: CheckContext) -> CheckResult:
        page = context.page
        profiles = sorted(
            (
                p
                for p in context.activity_profiles
                if p.enabled and p.key in context.job.activity_keys
            ),
            key=lambda p: p.key,
        )
        if not profiles:
            return CheckResult("could_not_check", "activity_profiles_missing")
        fields = {name: normalized(getattr(page, name)) for name in ("title", "headings", "body")}
        path = unquote(urlsplit(context.fetch.final_url).path).casefold()
        candidates = []
        for profile in profiles:
            signals = profile.page_type_signals
            earned = possible = 0
            matched: list[str] = []
            for name, phrases, weight in (
                ("url", signals.url_patterns, 3),
                ("title", signals.title_phrases, 3),
                ("headings", signals.heading_phrases, 2),
                ("body", signals.body_phrases, 1),
            ):
                if not phrases:
                    continue
                possible += weight
                found = [
                    phrase
                    for phrase in phrases
                    if phrase.strip()
                    and (
                        phrase.casefold() in path
                        if name == "url"
                        else phrase_in(fields[name], normalized(phrase))
                    )
                ]
                if found:
                    earned += weight
                    matched.extend(found)
            if signals.structure.link_list:
                possible += 2
                if page.outbound_list_links >= max(1, signals.structure.min_outbound_links):
                    earned += 2
                    matched.append("outbound_link_list")
            candidates.append(
                (earned / possible if possible else 0, profile.key, profile.version, matched)
            )
        score, key, version, matches = sorted(candidates, key=lambda v: (-v[0], v[1]))[0]
        fits = bool(matches) and score >= context.job.check_settings.activity_min_score
        return CheckResult(
            "pass" if fits else "fail",
            "activity_matches" if fits else "activity_no_match",
            evidence={
                "activity_key": key if fits else None,
                "profile_version": version,
                "score": round(score, 4),
                "matched_signals": [t[:120] for t in matches[:20]],
            },
        )


class Linkability:
    """Evidence of an editorial placement route, separate from topical fit."""

    async def run(self, context: CheckContext) -> CheckResult:
        # shortcut: add route rules for other activities when labeled examples exist.
        profiles = sorted(
            (
                p
                for p in context.activity_profiles
                if p.enabled
                and p.key in context.job.activity_keys
                and p.key in {"resource_page", "guest_post"}
            ),
            key=lambda p: p.key,
        )
        if not profiles:
            return CheckResult("could_not_check", "linkability_profiles_missing")
        page = context.page
        language = context.job.language or ""
        path = unquote(urlsplit(context.fetch.final_url).path).casefold()
        title = normalized(page.title, language)
        contact = page.contact_link or bool(
            context.domain_facts and context.domain_facts.has_contact_page
        )
        candidates = []
        for profile in profiles:
            signals = profile.page_type_signals
            headings = normalized(
                page.primary_heading if profile.key == "resource_page" else page.headings,
                language,
            )
            locator = (
                any(phrase.casefold() in path for phrase in signals.url_patterns if phrase.strip())
                or any(
                    phrase_in(title, normalized(phrase, language))
                    for phrase in signals.title_phrases
                )
                or any(
                    phrase_in(headings, normalized(phrase, language))
                    for phrase in signals.heading_phrases
                )
            )
            if profile.key == "resource_page":
                editorial = page.outbound_list_links >= max(2, signals.structure.min_outbound_links)
                passed = locator and editorial
                score = 0.5 * locator + 0.4 * editorial + 0.1 * contact
                matched = [
                    signal
                    for signal, present in (
                        ("resource_page_heading_or_url", locator),
                        ("editorial_external_link_list", editorial),
                        ("contact_route", contact),
                    )
                    if present
                ]
            else:
                body = normalized(page.body, language)
                guidelines = any(
                    phrase_in(body, normalized(phrase, language))
                    for phrase in signals.body_phrases
                    if phrase.strip()
                )
                passed = locator and (guidelines or contact)
                score = 0.6 * locator + 0.25 * guidelines + 0.15 * contact
                matched = [
                    signal
                    for signal, present in (
                        ("contribution_page_heading_or_url", locator),
                        ("contribution_guidance", guidelines),
                        ("contact_route", contact),
                    )
                    if present
                ]
            candidates.append((passed, score, profile.key, profile.version, matched))
        passed, score, key, version, matched = sorted(
            candidates, key=lambda item: (-int(item[0]), -item[1], item[2])
        )[0]
        return CheckResult(
            "pass" if passed else "fail",
            "linkability_route_found" if passed else "linkability_no_route",
            (
                f"{key.replace('_', ' ').title()}: {', '.join(matched) or 'no placement signals'}; "
                f"{page.outbound_list_links} external links in lists."
            ),
            evidence={
                "algorithm_version": 2,
                "activity_key": key,
                "profile_version": version,
                "score": round(score, 4),
                "matched_signals": [signal for signal in matched],
                "outbound_list_links": page.outbound_list_links,
            },
        )


class BannedCategory:
    async def run(self, context: CheckContext) -> CheckResult:
        categories = context.job.banned_categories
        if not categories:
            return CheckResult("pass", "banned_categories_clear", evidence={"enabled": False})
        page = context.page
        text = normalized(" ".join((page.title, page.meta, page.headings, page.body)))
        mapping = context.job.check_settings.banned_category_terms
        hits = []
        matched = []
        for category in categories:
            terms = mapping.get(category.casefold(), [category])
            found = [term for term in terms if phrase_in(text, normalized(term))]
            if found:
                hits.append(category)
                matched.extend(found)
        return CheckResult(
            "fail" if hits else "pass",
            "banned_category_match" if hits else "banned_categories_clear",
            evidence={
                "enabled": True,
                "categories": [t[:120] for t in hits[:20]],
                "matched_terms": [t[:120] for t in sorted(set(matched))[:20]],
            },
        )
