import asyncio

import pytest

from worker.checks.catalog import PAGE_LOAD_REASONS
from worker.checks.framework import (
    CheckContext,
    CheckDefinition,
    CheckRegistry,
    CheckResult,
    Reason,
)
from worker.fetch.types import FetchResult

pytestmark = pytest.mark.unit


class StaticCheck:
    def __init__(self, result, calls=None, name="check"):
        self.result = result
        self.calls = calls
        self.name = name

    async def run(self, context):
        if self.calls is not None:
            self.calls.append(self.name)
        return self.result


def context():
    return CheckContext(FetchResult("https://example.com", "https://example.com", "ok"), 1)


def entry(key, status="pass", order=10, calls=None, stop_on=frozenset(), priority=0):
    return CheckDefinition(
        key,
        StaticCheck(CheckResult(status, key), calls, key),
        order,
        {key: Reason(status, f"Reason {key}", priority)},
        stop_on,
    )


async def test_order_and_stable_ties():
    calls = []
    registry = CheckRegistry(
        [entry("z", calls=calls), entry("a", calls=calls), entry("first", order=0, calls=calls)]
    )
    run = await registry.run(context())
    assert calls == ["first", "a", "z"]
    assert [r.check_key for r in run.records] == calls
    assert run.config_version == 1
    assert run.stopped_after is None


async def test_dead_page_stops_without_fabricating_later_results():
    calls = []
    registry = CheckRegistry(
        [
            CheckDefinition(
                "page_loads",
                StaticCheck(CheckResult("fail", "page_gone")),
                0,
                PAGE_LOAD_REASONS,
                frozenset({"fail", "could_not_check"}),
            ),
            entry("language", calls=calls),
        ]
    )
    run = await registry.run(context())
    assert run.stopped_after == "page_loads"
    assert len(run.records) == 1
    assert calls == []
    assert registry.top_reasons(run) == ["Page has been removed (HTTP 410)."]


async def test_unknown_is_preserved_and_continues_unless_declared_terminal():
    registry = CheckRegistry([entry("unknown", "could_not_check", order=0), entry("next")])
    run = await registry.run(context())
    assert len(run.records) == 2
    assert run.records[0].result.status == "could_not_check"


async def test_one_class_and_catalog_entry_adds_a_check():
    class CustomCheck:
        async def run(self, context):
            return CheckResult("pass", "matched", "Compact detail", {"count": 3})

    registry = CheckRegistry(
        [
            CheckDefinition(
                "custom", CustomCheck(), 1, {"matched": Reason("pass", "Matched {count} terms.")}
            )
        ]
    )
    run = await registry.run(context())
    assert registry.top_reasons(run) == ["Matched 3 terms."]
    assert run.records[0].result.detail == "Compact detail"


async def test_top_three_priority_then_execution_order():
    registry = CheckRegistry(
        [entry("a"), entry("b", priority=50), entry("c", priority=100), entry("d", priority=50)]
    )
    run = await registry.run(context())
    assert registry.top_reasons(run) == ["Reason c", "Reason b", "Reason d"]
    assert registry.top_reasons(run, 0) == []


@pytest.mark.parametrize("definitions", [[], [entry("same"), entry("same")]])
def test_invalid_registry(definitions):
    with pytest.raises(ValueError):
        CheckRegistry(definitions)


@pytest.mark.parametrize("result", [CheckResult("fail", "undeclared"), CheckResult("fail", "ok")])
async def test_invalid_check_contract(result):
    registry = CheckRegistry(
        [CheckDefinition("test", StaticCheck(result), 0, {"ok": Reason("pass", "OK")})]
    )
    with pytest.raises(ValueError):
        await registry.run(context())


@pytest.mark.parametrize(
    "evidence",
    [
        {"x": float("nan")},
        {"x": float("inf")},
        {1: "x"},
        {"x": "\x00"},
        {"x": object()},
        {"x": "a" * 16384},
        [],
    ],
)
def test_invalid_evidence(evidence):
    with pytest.raises(ValueError):
        CheckResult("pass", "ok", evidence=evidence)


@pytest.mark.parametrize(
    "template", ["{value.__class__}", "{value[0]}", "{value!r}", "{value:100}"]
)
def test_templates_forbid_traversal_and_format_instructions(template):
    with pytest.raises(ValueError):
        Reason("pass", template)


async def test_missing_template_value_fails_before_publication():
    registry = CheckRegistry(
        [
            CheckDefinition(
                "test",
                StaticCheck(CheckResult("pass", "ok")),
                0,
                {"ok": Reason("pass", "Matched {count}")},
            )
        ]
    )
    with pytest.raises(KeyError):
        await registry.run(context())


@pytest.mark.parametrize("error", [RuntimeError("bug"), asyncio.CancelledError()])
async def test_errors_and_cancellation_propagate(error):
    class Broken:
        async def run(self, context):
            raise error

    registry = CheckRegistry([CheckDefinition("broken", Broken(), 0, {"ok": Reason("pass", "OK")})])
    with pytest.raises(type(error)):
        await registry.run(context())
