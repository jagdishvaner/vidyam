import asyncio
import time
from collections.abc import Sequence
from typing import Protocol

from vidyam_ai.generated.contracts import DependencyStatus, Service, ServiceHealth

VERSION = "0.1.0"
TIMEOUT_SECONDS = 2.0


class DependencyProbe(Protocol):
    """Port: one dependency of the AI engine. `check` returns an optional detail or raises."""

    name: str

    async def check(self) -> str | None: ...


class CheckHealth:
    def __init__(self, probes: Sequence[DependencyProbe]) -> None:
        self._probes = probes

    async def execute(self) -> ServiceHealth:
        dependencies = await asyncio.gather(*(self._run(p) for p in self._probes))
        return ServiceHealth(
            service=Service.ai,
            version=VERSION,
            ok=all(d.ok for d in dependencies),
            dependencies=list(dependencies),
        )

    @staticmethod
    async def _run(probe: DependencyProbe) -> DependencyStatus:
        started = time.perf_counter()
        try:
            detail = await asyncio.wait_for(probe.check(), TIMEOUT_SECONDS)
            ok = True
        except Exception as error:  # a failing dependency is reported, never raised
            detail = str(error) or type(error).__name__
            ok = False
        latency = round((time.perf_counter() - started) * 1000)
        # Generated models take wire (camelCase) names in __init__; read back as snake_case attributes.
        return DependencyStatus(name=probe.name, ok=ok, latencyMs=latency, detail=detail)
