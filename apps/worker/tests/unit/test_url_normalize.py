"""M3-S1: URL normalization. Vector file is shared with the web app tests."""

import json
from pathlib import Path
from typing import Any

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from worker.urls import (
    DEFAULT_TRACKING_PARAMS,
    NormalizedUrl,
    normalize_domain,
    normalize_url,
)

VECTOR_FILE = Path(__file__).resolve().parents[4] / "fixtures" / "url-normalization.json"
DATA: dict[str, Any] = json.loads(VECTOR_FILE.read_text(encoding="utf-8"))
URL_VECTORS: list[dict[str, Any]] = DATA["url_vectors"]
DOMAIN_VECTORS: list[dict[str, Any]] = DATA["domain_vectors"]
OK_VECTORS = [v for v in URL_VECTORS if "error" not in v]

pytestmark = pytest.mark.unit


def _id(v: dict[str, Any]) -> str:
    return repr(v["input"])[:60]


def test_vector_file_is_big_enough() -> None:
    assert len(URL_VECTORS) >= 100
    assert len(OK_VECTORS) >= 80
    assert any("error" in v for v in URL_VECTORS)


@pytest.mark.parametrize("vec", URL_VECTORS, ids=_id)
def test_url_vector(vec: dict[str, Any]) -> None:
    r = normalize_url(vec["input"])
    assert r.original == vec["input"]
    if "error" in vec:
        assert r.error == vec["error"]
        assert r.normalized is None
        assert r.host is None
        assert r.registered_domain is None
        assert not r.ok
    else:
        assert r.error is None
        assert r.normalized == vec["normalized"]
        assert r.host == vec["host"]
        assert r.registered_domain == vec["registered_domain"]
        assert r.ok


@pytest.mark.parametrize("vec", OK_VECTORS, ids=_id)
def test_vectors_are_idempotent(vec: dict[str, Any]) -> None:
    again = normalize_url(vec["normalized"])
    assert again.normalized == vec["normalized"]
    assert again.host == vec["host"]
    assert again.registered_domain == vec["registered_domain"]


@pytest.mark.parametrize("vec", DOMAIN_VECTORS, ids=_id)
def test_domain_vector(vec: dict[str, Any]) -> None:
    assert normalize_domain(vec["input"]) == vec["domain"]


def test_too_long_url_is_rejected() -> None:
    assert normalize_url("https://example.com/" + "a" * 2100).error == "too_long"
    assert normalize_url("https://example.com/" + "a" * 100).ok


def test_original_is_kept_exactly() -> None:
    raw = "  HTTP://WWW.Example.com/A?utm_source=x#f  "
    assert normalize_url(raw).original == raw


def test_custom_tracking_params() -> None:
    url = "https://example.com/p?ref=abc&id=1"
    assert normalize_url(url).normalized == "https://example.com/p?id=1&ref=abc"
    custom = DEFAULT_TRACKING_PARAMS | {"ref"}
    assert normalize_url(url, tracking_params=custom).normalized == "https://example.com/p?id=1"


def test_result_is_immutable() -> None:
    r = normalize_url("https://example.com")
    with pytest.raises(AttributeError):
        r.normalized = "x"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Property tests. deadline=None: the first call loads the suffix list.
# ---------------------------------------------------------------------------

_HOSTS = st.sampled_from(
    [
        "example.com",
        "WWW.Example.COM",
        "www.www.example.co.uk",
        "a.blogspot.com",
        "münchen.de",
        "sub.user.github.io",
        "example.com.",
        "www.co.uk",
        "localhost",
        "127.0.0.1",
        "bad_host.com",
    ]
)
_PATH_CHARS = st.text(
    alphabet=st.sampled_from(list("abcXYZ019/._~%-+ ?#&=:@!$'()*,;[]{}<>|\\^`\"é€")),
    max_size=40,
)


def _build_structured_url(
    scheme: str, host: str, port: str, path: str, query: str, frag: str
) -> str:
    return (
        f"{scheme}{host}{port}/{path}"
        + (f"?{query}" if query else "")
        + (f"#{frag}" if frag else "")
    )


_STRUCTURED = st.builds(
    _build_structured_url,
    scheme=st.sampled_from(["http://", "https://", "HTTP://", "", "//"]),
    host=_HOSTS,
    port=st.sampled_from(["", ":80", ":443", ":8080", ":0", ":x"]),
    path=_PATH_CHARS,
    query=_PATH_CHARS,
    frag=_PATH_CHARS,
)

_SETTINGS = settings(
    max_examples=400,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)


def _check_invariants(r: NormalizedUrl) -> None:
    if not r.ok:
        assert r.normalized is None
        return
    assert r.normalized is not None
    assert r.normalized.startswith("https://")
    assert r.normalized.isascii()
    assert "#" not in r.normalized
    assert " " not in r.normalized
    again = normalize_url(r.normalized)
    assert again.normalized == r.normalized
    assert again.registered_domain == r.registered_domain


@_SETTINGS
@given(_STRUCTURED)
def test_structured_inputs_are_idempotent(raw: str) -> None:
    _check_invariants(normalize_url(raw))


@_SETTINGS
@given(st.text(max_size=120))
def test_arbitrary_text_never_raises(raw: str) -> None:
    _check_invariants(normalize_url(raw))
