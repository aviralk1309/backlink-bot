import pytest

from worker.engine.queries import QueryPlanError, plan_queries

pytestmark = pytest.mark.unit


def job(**overrides: object) -> dict[str, object]:
    return {
        "activity_keys": ["guest_post", "resource_page"],
        "budget_credits": 20,
        "pages_per_query": 2,
        "seed_keywords": ["  Yoga   retreat ", "Travel"],
        "business_type": "Travel",
        "sub_niche": "Wellness",
        "client": "Acme",
        "brand_variants": ["Acme Co"],
        "country": "US",
        "language": "en",
        "regions": ["Boston", "Austin"],
    } | overrides


def profiles() -> list[dict[str, object]]:
    return [
        {
            "key": "guest_post",
            "version": 3,
            "footprint_templates": [
                {
                    "id": "gp",
                    "template": "{keyword} {city}",
                    "language": "*",
                    "priority": 1,
                    "enabled": True,
                },
            ],
        },
        {
            "key": "resource_page",
            "version": 2,
            "footprint_templates": [
                {
                    "id": "rp",
                    "template": "{brand} resources",
                    "language": "en",
                    "priority": 1,
                    "enabled": True,
                },
                {
                    "id": "off",
                    "template": "{keyword} off",
                    "language": "fr",
                    "priority": 1,
                    "enabled": True,
                },
            ],
        },
    ]


def test_interleaves_activities_and_first_pages_before_depth() -> None:
    plan = plan_queries(job(), profiles())
    assert len(plan.rows) == 8
    assert [(q.activity_key, q.query_text, q.page) for q in plan.rows[:4]] == [
        ("guest_post", "Yoga retreat Boston", 1),
        ("resource_page", "Acme resources", 1),
        ("guest_post", "Travel Austin", 1),
        ("guest_post", "Yoga retreat Austin", 1),
    ]
    assert all(q.page == 1 for q in plan.rows)
    assert [q.priority for q in plan.rows] == list(range(1, 9))
    assert {(q.gl, q.hl) for q in plan.rows} == {("us", "en")}
    assert plan.rows[0].location == "Boston"
    assert plan.rows[1].location == "Austin"
    assert plan.rows[0].template_version == 3


def test_budget_caps_cartesian_product_without_deep_paging() -> None:
    plan = plan_queries(job(budget_credits=3, pages_per_query=10), profiles())
    assert plan.capped
    assert plan.potential_calls > 3
    assert len(plan.rows) == 3
    assert all(row.page == 1 for row in plan.rows)


def test_small_pilot_budget_reaches_each_keyword_and_activity() -> None:
    selected = [
        {
            "key": key,
            "version": 1,
            "footprint_templates": [
                {
                    "id": f"t{i}",
                    "template": f'"{key} footprint {i}" {{keyword}}',
                    "language": "*",
                    "priority": i,
                    "enabled": True,
                }
                for i in range(1, 4)
            ],
        }
        for key in ("guest_post", "resource_page")
    ]
    plan = plan_queries(
        job(
            budget_credits=10,
            pages_per_query=3,
            regions=[],
            seed_keywords=[
                "yoga retreat nepal",
                "yoga retreat pokhara",
                "wellness retreat pokhara",
            ],
        ),
        selected,
    )
    assert len(plan.rows) == 10
    assert all(row.page == 1 for row in plan.rows)
    assert {row.activity_key for row in plan.rows} == {"guest_post", "resource_page"}
    assert all(
        any(keyword in row.query_text for row in plan.rows)
        for keyword in ("yoga retreat nepal", "yoga retreat pokhara", "wellness retreat pokhara")
    )


def test_small_budget_rotates_regions_across_activities() -> None:
    selected = [
        {
            "key": key,
            "version": 1,
            "footprint_templates": [
                {
                    "id": key,
                    "template": f"{{keyword}} {{city}} {key}",
                    "language": "*",
                    "priority": 1,
                    "enabled": True,
                }
            ],
        }
        for key in ("guest_post", "resource_page")
    ]
    plan = plan_queries(job(budget_credits=2, seed_keywords=["Yoga"]), selected)
    assert {row.location for row in plan.rows} == {"Boston", "Austin"}
    assert {row.activity_key for row in plan.rows} == {"guest_post", "resource_page"}


def test_deduplicates_text_and_location_across_templates() -> None:
    templates = [
        {"id": "one", "template": "{keyword}", "language": "*", "priority": 1, "enabled": True},
        {"id": "two", "template": "{keyword}", "language": "*", "priority": 2, "enabled": True},
    ]
    plan = plan_queries(
        job(activity_keys=["guest_post"], regions=[], pages_per_query=1),
        [{"key": "guest_post", "version": 1, "footprint_templates": templates}],
    )
    assert [row.query_text for row in plan.rows] == ["Yoga retreat", "Travel"]


def test_brand_niche_country_and_missing_city() -> None:
    templates = [
        {
            "id": "b",
            "template": "{brand} {niche} {country}",
            "language": "*",
            "priority": 1,
            "enabled": True,
        },
        {
            "id": "c",
            "template": "{city} {keyword}",
            "language": "*",
            "priority": 2,
            "enabled": True,
        },
    ]
    plan = plan_queries(
        job(activity_keys=["guest_post"], regions=[], pages_per_query=1),
        [{"key": "guest_post", "version": 1, "footprint_templates": templates}],
    )
    assert len(plan.rows) == 4
    assert plan.rows[0].query_text == "Acme Wellness US"
    assert all(row.location is None for row in plan.rows)


def test_empty_or_invalid_template_fails_instead_of_silently_completing() -> None:
    with pytest.raises(QueryPlanError, match="invalid_locale"):
        plan_queries(job(country="United States"), profiles())
    with pytest.raises(QueryPlanError, match="no_search_queries"):
        plan_queries(job(activity_keys=["guest_post"], regions=[]), profiles()[:1])
    with pytest.raises(QueryPlanError, match="invalid_templates"):
        plan_queries(
            job(activity_keys=["guest_post"]),
            [
                {
                    "key": "guest_post",
                    "version": 1,
                    "footprint_templates": [
                        {
                            "id": "bad",
                            "template": "{unknown}",
                            "language": "*",
                            "priority": 1,
                            "enabled": True,
                        }
                    ],
                }
            ],
        )
