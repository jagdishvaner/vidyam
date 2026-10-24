import asyncio

import pytest
from vidyam_ai.application import health
from vidyam_ai.application.health import CheckHealth


class Probe:
    def __init__(self, name: str, behaviour: str) -> None:
        self.name = name
        self._behaviour = behaviour

    async def check(self) -> str | None:
        if self._behaviour == "fail":
            raise RuntimeError("bucket missing")
        if self._behaviour == "hang":
            await asyncio.sleep(10)
        return "fine"


async def test_ok_only_when_every_dependency_is_ok() -> None:
    result = await CheckHealth([Probe("postgres", "ok"), Probe("qdrant", "ok")]).execute()
    assert result.ok
    assert [d.name for d in result.dependencies] == ["postgres", "qdrant"]


async def test_failures_are_reported_not_raised() -> None:
    result = await CheckHealth([Probe("postgres", "ok"), Probe("s3", "fail")]).execute()
    assert not result.ok
    s3 = next(d for d in result.dependencies if d.name == "s3")
    assert (s3.ok, s3.detail) == (False, "bucket missing")


async def test_a_hanging_dependency_times_out(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(health, "TIMEOUT_SECONDS", 0.05)
    result = await CheckHealth([Probe("qdrant", "hang")]).execute()
    assert not result.ok
    assert result.dependencies[0].detail == "TimeoutError"


async def test_serializes_with_the_contract_field_names() -> None:
    result = await CheckHealth([Probe("postgres", "ok")]).execute()
    wire = result.model_dump(by_alias=True, mode="json")
    assert set(wire["dependencies"][0]) == {"name", "ok", "latencyMs", "detail"}
