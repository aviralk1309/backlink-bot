import pytest

from worker.checks.page import Page
from worker.crawl.links import crawl_candidates
from worker.fetch.types import FetchResult

pytestmark = pytest.mark.unit


def test_depth_one_candidates_are_bounded_and_same_site():
    html = """<html><body>
      <a href="/search?q=yoga">Resources search</a>
      <a href="/login">Contribute</a>
      <a href="https://other.com/resources">Resources</a>
      <a href="/contact">Contact</a>
      <a href="/partners">Partners</a>
      <a href="/resources">Useful resources</a>
      <a href="/resources?sort=popular">Resources again</a>
      <a href="/resources">Duplicate</a>
    </body></html>"""
    page = Page.from_fetch(
        FetchResult("https://crawlsite.com", "https://crawlsite.com", "ok", text=html)
    )
    candidates = crawl_candidates(page, "https://crawlsite.com", "crawlsite.com", ["yoga retreat"])
    assert [item["normalized_url"] for item in candidates] == [
        "https://crawlsite.com/resources",
        "https://crawlsite.com/partners",
    ]


def test_topic_link_can_be_selected_without_route_words():
    page = Page.from_fetch(
        FetchResult(
            "https://crawlsite.com",
            "https://crawlsite.com",
            "ok",
            text='<html><body><a href="/yoga-retreat">Yoga retreat guide</a></body></html>',
        )
    )
    assert (
        crawl_candidates(page, "https://crawlsite.com", "crawlsite.com", ["yoga retreat"])[0][
            "normalized_url"
        ]
        == "https://crawlsite.com/yoga-retreat"
    )
