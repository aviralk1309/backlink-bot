import pytest

from worker.fetch.types import FetchResult
from worker.verify.links import verify_link

pytestmark = pytest.mark.unit


def test_verified_link_records_rel_and_redirected_source():
    result = FetchResult(
        "https://publisher.com/page",
        "https://publisher.com/new-page",
        "ok",
        text='<a href="https://client.com/retreat?utm_source=blog" rel="ugc nofollow">Yoga</a>',
    )
    check = verify_link(result, "https://client.com/retreat")
    assert (check.status, check.rel, check.final_url) == (
        "verified",
        ["nofollow", "ugc"],
        "https://publisher.com/new-page",
    )


def test_missing_and_blocked_pages_do_not_count_as_verified():
    missing = verify_link(
        FetchResult("https://publisher.com", "https://publisher.com", "ok", text="<p>Removed</p>"),
        "https://client.com/retreat",
    )
    blocked = verify_link(
        FetchResult(
            "https://publisher.com",
            "https://publisher.com",
            "could_not_check",
            reason_code="robots_disallow",
        ),
        "https://client.com/retreat",
    )
    gone = verify_link(
        FetchResult("https://publisher.com", "https://publisher.com", "http_4xx", status_code=404),
        "https://client.com/retreat",
    )
    assert (missing.status, blocked.status, gone.status) == ("unverified", "unknown", "unverified")
