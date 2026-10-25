"""Activities: the steps workflows run, where all I/O and real work happens. Each validates its input against
the shared contract, then calls a use case. Inputs and results stay contract-shaped JSON (camelCase), so the
TypeScript starters and the Temporal UI see the same documents."""

from typing import Any

from pydantic import BaseModel, ValidationError
from temporalio import activity
from temporalio.exceptions import ApplicationError

from vidyam_ai.application.ping import handle_ping
from vidyam_ai.generated.contracts import PingInput
from vidyam_ai.infrastructure.temporal.cpu import CpuPool


def parse[M: BaseModel](model: type[M], payload: Any) -> M:
    """A payload that breaks the contract will never succeed, so fail the workflow instead of retrying."""
    try:
        return model.model_validate(payload)
    except ValidationError as error:
        raise ApplicationError(
            f"invalid {model.__name__}: {error}", type="InvalidPayload", non_retryable=True
        ) from error


class Activities:
    """Shared dependencies (CPU pool, later database, S3 and LLM clients) are injected once per worker."""

    def __init__(self, cpu: CpuPool) -> None:
        self._cpu = cpu

    @activity.defn(name="ping")
    async def ping(self, payload: dict[str, Any]) -> dict[str, Any]:
        return handle_ping(parse(PingInput, payload)).model_dump(mode="json", by_alias=True)
