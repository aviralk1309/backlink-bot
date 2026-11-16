"""Language detection and weighted, stemmed relevance. No network dependencies."""

from __future__ import annotations

import unicodedata
from functools import lru_cache
from typing import Any

import snowballstemmer  # type: ignore[import-untyped]
from lingua import Language, LanguageDetector, LanguageDetectorBuilder
from pydantic import JsonValue

from worker.checks.framework import CheckContext, CheckResult
from worker.checks.page import tokens


@lru_cache(maxsize=1)
def language_detector() -> LanguageDetector:
    return LanguageDetectorBuilder.from_all_languages().with_low_accuracy_mode().build()


class LanguageCheck:
    async def run(self, context: CheckContext) -> CheckResult:
        target = (context.job.language or "").lower()
        if not target:
            return CheckResult("could_not_check", "language_not_configured")
        supported = {lang.iso_code_639_1.name.lower() for lang in Language.all()}
        # Norwegian is represented by Bokmal/Nynorsk in Lingua.
        if target == "no":
            target = "nb"
        if target not in supported:
            return CheckResult(
                "could_not_check", "language_unsupported", evidence={"target": target}
            )
        text = context.page.body[:20000]
        settings = context.job.check_settings
        letters = sum(unicodedata.category(c)[0] in ("L", "M") for c in text)
        headers = {k.lower(): v for k, v in context.fetch.headers.items()}
        declarations = {context.page.html_lang.split("-")[0]}
        declarations.update(
            v.strip().split("-")[0].lower() for v in headers.get("content-language", "").split(",")
        )
        declarations.discard("")
        declarations = {"nb" if lang == "no" else lang for lang in declarations}
        evidence: dict[str, JsonValue] = {
            "target": target,
            "letters": letters,
            "declared": [value for value in sorted(declarations)[:10]],
        }
        if letters < settings.language_min_letters:
            return CheckResult("could_not_check", "language_insufficient_text", evidence=evidence)
        values = language_detector().compute_language_confidence_values(text)
        if not values:
            return CheckResult("could_not_check", "language_uncertain", evidence=evidence)
        best = values[0]
        detected = best.language.iso_code_639_1.name.lower()
        margin = best.value - (values[1].value if len(values) > 1 else 0)
        evidence.update(
            {"detected": detected, "confidence": round(best.value, 4), "margin": round(margin, 4)}
        )
        if best.value < settings.language_confidence or margin < settings.language_margin:
            return CheckResult("could_not_check", "language_uncertain", evidence=evidence)
        # Whole-page confidence can hide a bilingual page. Check substantial
        # halves independently before interpreting a mismatch as a clear failure.
        half_languages = set()
        for half in (text[: len(text) // 2], text[len(text) // 2 :]):
            if (
                sum(unicodedata.category(c)[0] in ("L", "M") for c in half)
                < settings.language_min_letters
            ):
                continue
            predictions = language_detector().compute_language_confidence_values(half)
            if predictions and predictions[0].value >= settings.language_confidence:
                half_languages.add(predictions[0].language.iso_code_639_1.name.lower())
        if len(half_languages) > 1:
            evidence["detected_segments"] = [value for value in sorted(half_languages)]
            return CheckResult("could_not_check", "language_mixed", evidence=evidence)
        if declarations and declarations != {detected}:
            return CheckResult("could_not_check", "language_conflicting", evidence=evidence)
        match = detected == target or target == "nb" and detected == "nn"
        return CheckResult(
            "pass" if match else "fail",
            "language_matches" if match else "language_mismatch",
            evidence=evidence,
        )


_STEMMERS = {
    "en": "english",
    "fr": "french",
    "de": "german",
    "es": "spanish",
    "it": "italian",
    "pt": "portuguese",
    "nl": "dutch",
    "ru": "russian",
    "sv": "swedish",
    "no": "norwegian",
    "da": "danish",
    "fi": "finnish",
    "ar": "arabic",
    "tr": "turkish",
    "ro": "romanian",
    "hu": "hungarian",
    "el": "greek",
    "hi": "hindi",
    "id": "indonesian",
}


@lru_cache(maxsize=32)
def stemmer(language: str) -> Any:
    algorithm = _STEMMERS.get(language)
    return snowballstemmer.stemmer(algorithm) if algorithm in snowballstemmer.algorithms() else None


def normalized(text: str, language: str = "") -> str:
    words = tokens(text)
    engine = stemmer(language)
    if engine:
        words = engine.stemWords(words)
    return " ".join(words)


def phrase_in(normalized_text: str, phrase: str) -> bool:
    if not phrase:
        return False
    # CJK has no mandatory word separators; literal matching is the fallback.
    if any("\u3400" <= c <= "\u9fff" or "\u3040" <= c <= "\u30ff" for c in phrase):
        return phrase in normalized_text
    return f" {phrase} " in f" {normalized_text} "


class Relevance:
    async def run(self, context: CheckContext) -> CheckResult:
        job, page = context.job, context.page
        terms = list(
            dict.fromkeys(
                t.strip()
                for t in [*job.seed_keywords, *job.brand_variants, job.sub_niche or ""]
                if t.strip()
            )
        )
        if not terms:
            return CheckResult("could_not_check", "relevance_no_terms")
        if not any(
            (page.title.strip(), page.headings.strip(), page.meta.strip(), page.body.strip())
        ):
            return CheckResult("could_not_check", "relevance_no_text")
        language = job.language or ""
        stopwords = (
            {"a", "an", "and", "for", "in", "of", "the", "to", "with"}
            if language == "en"
            else set()
        )
        phrases = {term: normalized(term, language) for term in terms}
        concepts = {
            term: tuple(dict.fromkeys(word for word in phrase.split() if word not in stopwords))
            for term, phrase in phrases.items()
        }
        if not any(concepts.values()):
            return CheckResult("could_not_check", "relevance_no_terms")
        fields = {
            name: normalized(getattr(page, name), language)
            for name in ("title", "headings", "meta", "body")
        }
        field_words = {name: set(text.split()) for name, text in fields.items()}
        profiles = [
            p for p in context.activity_profiles if p.enabled and p.key in job.activity_keys
        ]
        rules = [(p.key, p.relevance_rule) for p in profiles] or [
            ("default", job.check_settings.relevance_rule)
        ]
        scores = []
        for key, rule in rules:
            weights = rule.field_weights.model_dump()
            total = sum(weights.values())
            if not total:
                raise ValueError("Relevance field weights must have a positive total")
            for term, words in concepts.items():
                if not words:
                    continue
                found = {name: set(words) & field_words[name] for name in fields}
                exact = {name: phrase_in(text, phrases[term]) for name, text in fields.items()}
                # A single place name on an otherwise generic page is not a topic match.
                if not any(exact.values()) and len(set.union(*found.values())) < min(2, len(words)):
                    continue
                score = (
                    sum(
                        weights[name] * (1 if exact[name] else 0.8 * len(found[name]) / len(words))
                        for name in fields
                    )
                    / total
                )
                scores.append((score, key, rule.min_score, term, found, exact))
        if scores:
            score, profile, minimum, selected, found, exact = sorted(
                scores, key=lambda item: (-item[0], item[1])
            )[0]
        else:
            score, profile, minimum = 0.0, rules[0][0], rules[0][1].min_score
            selected, found, exact = "", {name: set() for name in fields}, {}
        matches = sorted(set.union(*found.values()))
        if selected and any(exact.values()) and not matches:
            matches = [selected]
        geography: list[JsonValue] = [
            region[:120]
            for region in job.regions[:20]
            if phrase_in(" ".join(fields.values()), normalized(region, language))
        ]
        evidence: dict[str, JsonValue] = {
            "algorithm_version": 2,
            "score": round(score, 4),
            "minimum": minimum,
            "profile": profile,
            "matched_term": selected[:120],
            "matched_terms": [selected[:120]] if selected else [],
            "matched_count": len(matches),
            "matched_concepts": [word[:120] for word in matches[:20]],
            "exact_phrase": any(exact.values()),
            "term_count": len(terms),
            "fields": {name: len(values) for name, values in found.items()},
            "geography_matches": geography,
        }
        passed = bool(matches) and score >= minimum
        detail = (
            f"Best keyword: {selected[:120]}; "
            f"matched concepts: {', '.join(str(m) for m in matches[:8])}."
            if selected
            else "No configured keyword has enough matching topic concepts."
        )
        return CheckResult(
            "pass" if passed else "fail",
            "relevance_matches" if passed else "relevance_low",
            detail,
            evidence=evidence,
        )
