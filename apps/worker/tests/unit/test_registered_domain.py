"""M3-S2: registered-domain extraction."""

import pytest

from worker.urls import registered_domain
from worker.urls.domain import _EXTRACT

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("example.com", "example.com"),
        ("www.example.com", "example.com"),
        ("a.b.c.example.com", "example.com"),
        ("example.co.uk", "example.co.uk"),
        ("www.example.co.uk", "example.co.uk"),
        ("example.com.au", "example.com.au"),
        ("shop.example.com.au", "example.com.au"),
        ("a.blogspot.com", "a.blogspot.com"),
        ("b.blogspot.com", "b.blogspot.com"),
        ("x.a.blogspot.com", "a.blogspot.com"),
        ("user.github.io", "user.github.io"),
        ("EXAMPLE.COM", "example.com"),
        ("example.com.", "example.com"),
        ("  example.com  ", "example.com"),
        ("xn--mnchen-3ya.de", "xn--mnchen-3ya.de"),
    ],
)
def test_registered_domain(host: str, expected: str) -> None:
    assert registered_domain(host) == expected


@pytest.mark.parametrize(
    "host",
    [
        "",
        ".",
        "localhost",
        "intranet",
        "127.0.0.1",
        "192.168.0.1",
        "::1",
        "[::1]",
        "2001:db8::1",
        "co.uk",
        "blogspot.com",
        "example.invalidtld",
    ],
)
def test_not_a_registered_domain(host: str) -> None:
    assert registered_domain(host) is None


def test_blogspot_sites_are_different_domains() -> None:
    assert registered_domain("a.blogspot.com") != registered_domain("b.blogspot.com")


def test_extractor_never_uses_the_network() -> None:
    assert _EXTRACT.suffix_list_urls == ()
    assert _EXTRACT.include_psl_private_domains is True
