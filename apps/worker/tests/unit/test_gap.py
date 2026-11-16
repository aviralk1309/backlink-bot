import pytest

from worker.engine.gap import calculate_domain_gap


@pytest.mark.unit
def test_overlap_counts() -> None:
    # Competitor 1 and Competitor 2 both link to techcrunch.com
    # Competitor 1 also links to mashable.com
    competitor_links = [
        ("https://techcrunch.com/article1", "rival1.com"),
        ("https://techcrunch.com/article2", "rival1.com"),  # duplicate from rival1
        ("https://techcrunch.com/article3", "rival2.com"),  # from rival2
        ("https://mashable.com/post", "rival1.com"),
    ]
    results = calculate_domain_gap(
        competitor_links=competitor_links,
        client_links=[],
        client_domain="myclient.com",
        competitor_domains=["rival1.com", "rival2.com"],
        reference_sites=[],
        has_client_file=False,
    )

    domain_map = {r.domain: r for r in results}
    assert len(domain_map) == 2
    assert domain_map["techcrunch.com"].overlap_count == 2
    assert domain_map["techcrunch.com"].competitor_labels == ("rival1.com", "rival2.com")
    assert domain_map["mashable.com"].overlap_count == 1
    assert domain_map["mashable.com"].competitor_labels == ("rival1.com",)


@pytest.mark.unit
def test_subdomains_grouped_to_registered_domain() -> None:
    # Subdomains of same domain grouped together
    competitor_links = [
        ("https://blog.example.co.uk/page1", "rival1.com"),
        ("https://news.example.co.uk/page2", "rival2.com"),
    ]
    results = calculate_domain_gap(
        competitor_links=competitor_links,
        client_links=[],
        client_domain="myclient.com",
        competitor_domains=[],
        reference_sites=[],
        has_client_file=False,
    )
    assert len(results) == 1
    assert results[0].domain == "example.co.uk"
    assert results[0].overlap_count == 2


@pytest.mark.unit
def test_client_file_present_and_absent_status() -> None:
    competitor_links = [("https://example.com/p", "rival1.com")]

    # When no client file
    results_no_client = calculate_domain_gap(
        competitor_links=competitor_links,
        client_links=[],
        client_domain="myclient.com",
        competitor_domains=[],
        reference_sites=[],
        has_client_file=False,
    )
    assert results_no_client[0].client_link_status == "unknown"

    # When client file exists
    results_with_client = calculate_domain_gap(
        competitor_links=competitor_links,
        client_links=["https://other.com/p"],
        client_domain="myclient.com",
        competitor_domains=[],
        reference_sites=[],
        has_client_file=True,
    )
    assert results_with_client[0].client_link_status == "known_partial"


@pytest.mark.unit
def test_own_domain_exclusion() -> None:
    competitor_links = [
        ("https://myclient.com/page", "rival1.com"),
        ("https://subdomain.myclient.com/page", "rival1.com"),
        ("https://real-gap.com/page", "rival1.com"),
    ]
    results = calculate_domain_gap(
        competitor_links=competitor_links,
        client_links=[],
        client_domain="https://www.myclient.com",
        competitor_domains=[],
        reference_sites=[],
        has_client_file=False,
    )
    domains = [r.domain for r in results]
    assert "myclient.com" not in domains
    assert domains == ["real-gap.com"]


@pytest.mark.unit
def test_competitor_and_reference_domain_exclusions() -> None:
    competitor_links = [
        ("https://rival1.com/about", "rival2.com"),  # competitor linking to competitor
        ("https://wikipedia.org/wiki/Topic", "rival1.com"),  # reference site
        ("https://fresh-gap.com/article", "rival1.com"),
    ]
    results = calculate_domain_gap(
        competitor_links=competitor_links,
        client_links=[],
        client_domain="myclient.com",
        competitor_domains=["rival1.com", "rival2.com"],
        reference_sites=["https://en.wikipedia.org"],
        has_client_file=False,
    )
    domains = [r.domain for r in results]
    assert "rival1.com" not in domains
    assert "rival2.com" not in domains
    assert "wikipedia.org" not in domains
    assert domains == ["fresh-gap.com"]


@pytest.mark.unit
def test_client_links_exclusion_handles_subdomains() -> None:
    # Client has backlink from sub.already-linked.com
    # Competitor has backlink from blog.already-linked.com
    # Since both are on already-linked.com, it must be excluded from gap!
    competitor_links = [
        ("https://blog.already-linked.com/p", "rival1.com"),
        ("https://unlinked-gap.com/p", "rival1.com"),
    ]
    client_links = [
        "https://sub.already-linked.com/client-page",
    ]
    results = calculate_domain_gap(
        competitor_links=competitor_links,
        client_links=client_links,
        client_domain="myclient.com",
        competitor_domains=[],
        reference_sites=[],
        has_client_file=True,
    )
    domains = [r.domain for r in results]
    assert "already-linked.com" not in domains
    assert domains == ["unlinked-gap.com"]


@pytest.mark.unit
def test_idempotency() -> None:
    competitor_links = [
        ("https://site-a.com/1", "rival1.com"),
        ("https://site-b.com/2", "rival2.com"),
    ]
    res1 = calculate_domain_gap(
        competitor_links=competitor_links,
        client_links=[],
        client_domain="myclient.com",
        competitor_domains=[],
        reference_sites=[],
        has_client_file=False,
    )
    res2 = calculate_domain_gap(
        competitor_links=competitor_links,
        client_links=[],
        client_domain="myclient.com",
        competitor_domains=[],
        reference_sites=[],
        has_client_file=False,
    )
    assert res1 == res2
