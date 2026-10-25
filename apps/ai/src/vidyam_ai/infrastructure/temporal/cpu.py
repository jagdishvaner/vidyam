import asyncio
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor
from typing import Any


class CpuPool:
    """Runs CPU-heavy functions (PDF parsing, RDKit, sympy) in separate processes, so the worker's event loop
    keeps heartbeating and polling while they run. Functions must be picklable."""

    def __init__(self, processes: int) -> None:
        self._executor = ProcessPoolExecutor(max_workers=processes)

    async def run[T](self, fn: Callable[..., T], *args: Any) -> T:
        return await asyncio.get_running_loop().run_in_executor(self._executor, fn, *args)

    def close(self) -> None:
        self._executor.shutdown(wait=True, cancel_futures=True)
