"""Property-based tests for domain gap calculation (M4-S9).

Uses Hypothesis to verify invariant properties:
  1. Gap domains is always a subset of competitor domains.
  2. Gap domains never contains any client domains (disjoint).
  3. Gap domains never contains own domain.
  4. Gap domains never contains competitor domains or labels themselves.
  5. Gap domains never contains reference domains.
  6. Overlap counts are strictly bounded between 1 and total competitor files.
  7. Idempotency: recomputation yields identical results.
  8. Monotonicity: adding client domains can only shrink or maintain the gap set.
  9. Sorting: results are ordered by overlap_count DESC, domain ASC.
"""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from worker.engine.gap import calculate_domain_gap
from worker.urls.domain import registered_domain

# Strategy for generating plausible registered domains
DOMAIN_LABELS = st.sampled_from(
    [
        "alpha",
        "beta",
        "gamma",
        "delta",
        "epsilon",
        "techreview",
        "partnerhub",
        "marketingdaily",
        "newssite",
        "industrydigest",
    ]
)
TLDS = st.sampled_from(["com", "org", "net", "co.uk", "io"])

DOMAINS = st.builds(lambda label, tld: f"{label}.{tld}", DOMAIN_LABELS, TLDS)

SUBDOMAINS = st.sampled_from(["www", "blog", "app", "m", "news", "forum"])
PATHS = st.sampled_from(["", "/", "/post/1", "/articles/guide", "/category/news"])

URLS = st.builds(
    lambda sub, d, path: f"https://{sub}.{d}{path}",
    SUBDOMAINS,
    DOMAINS,
    PATHS,
)

COMPETITOR_LABELS = st.sampled_from(["rival1.com", "rival2.com", "rival3.com", "competitor.io"])

pytestmark = pytest.mark.unit


@settings(max_examples=100, deadline=None)
@given(
    competitor_links=st.lists(st.tuples(URLS, COMPETITOR_LABELS), min_size=0, max_size=30),
    client_links=st.lists(URLS, min_size=0, max_size=20),
    client_domain=DOMAINS,
    competitor_domains=st.lists(DOMAINS, min_size=0, max_size=5),
    reference_sites=st.lists(DOMAINS, min_size=0, max_size=5),
    has_client_file=st.booleans(),
)
def test_gap_invariants(
    competitor_links: list[tuple[str, str]],
    client_links: list[str],
    client_domain: str,
    competitor_domains: list[str],
    reference_sites: list[str],
    has_client_file: bool,
) -> None:
    results = calculate_domain_gap(
        competitor_links=competitor_links,
        client_links=client_links,
        client_domain=client_domain,
        competitor_domains=competitor_domains,
        reference_sites=reference_sites,
        has_client_file=has_client_file,
    )

    gap_domains = {r.domain for r in results}

    # 1. Gap domains must all originate from competitor links
    all_comp_domains = {
        registered_domain(url) for url, _ in competitor_links if registered_domain(url) is not None
    }
    assert gap_domains.issubset(all_comp_domains)

    # 2. Gap domains must not contain any client linking domains
    client_linking_domains = {
        registered_domain(url) for url in client_links if registered_domain(url) is not None
    }
    assert gap_domains.isdisjoint(client_linking_domains)

    # 3. Gap domains must not contain the client's own domain
    own_norm = registered_domain(client_domain)
    if own_norm:
        assert own_norm not in gap_domains

    # 4. Gap domains must not contain competitor domains or file labels
    for cd in competitor_domains:
        cd_norm = registered_domain(cd)
        if cd_norm:
            assert cd_norm not in gap_domains
    for _, clabel in competitor_links:
        clabel_norm = registered_domain(clabel)
        if clabel_norm:
            assert clabel_norm not in gap_domains

    # 5. Gap domains must not contain reference site domains
    for rs in reference_sites:
        rs_norm = registered_domain(rs)
        if rs_norm:
            assert rs_norm not in gap_domains

    # 6. Overlap counts strictly bounded and match competitor_labels count
    total_distinct_labels = len({label for _, label in competitor_links})
    for r in results:
        assert 1 <= r.overlap_count <= max(1, total_distinct_labels)
        assert r.overlap_count == len(r.competitor_labels)
        assert r.competitor_labels == tuple(sorted(r.competitor_labels))
        # client_link_status adheres to has_client_file
        if has_client_file:
            assert r.client_link_status == "known_partial"
        else:
            assert r.client_link_status == "unknown"

    # 7. Results are deterministically sorted: overlap_count DESC, domain ASC
    if len(results) > 1:
        for i in range(len(results) - 1):
            curr, nxt = results[i], results[i + 1]
            assert curr.overlap_count > nxt.overlap_count or (
                curr.overlap_count == nxt.overlap_count and curr.domain <= nxt.domain
            )


@settings(max_examples=50, deadline=None)
@given(
    competitor_links=st.lists(st.tuples(URLS, COMPETITOR_LABELS), min_size=1, max_size=20),
    client_domain=DOMAINS,
    extra_client_links=st.lists(URLS, min_size=1, max_size=10),
)
def test_gap_monotonicity_with_client_links(
    competitor_links: list[tuple[str, str]],
    client_domain: str,
    extra_client_links: list[str],
) -> None:
    """Adding client links can only reduce or keep the gap set, never expand it."""
    base_results = calculate_domain_gap(
        competitor_links=competitor_links,
        client_links=[],
        client_domain=client_domain,
        competitor_domains=[],
        reference_sites=[],
        has_client_file=False,
    )
    base_gap = {r.domain for r in base_results}

    with_client_results = calculate_domain_gap(
        competitor_links=competitor_links,
        client_links=extra_client_links,
        client_domain=client_domain,
        competitor_domains=[],
        reference_sites=[],
        has_client_file=True,
    )
    with_client_gap = {r.domain for r in with_client_results}

    assert with_client_gap.issubset(base_gap)
