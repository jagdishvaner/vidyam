"""Job handlers: validate the payload against the shared contract, then call the use case."""

from bullmq import Job, UnrecoverableError
from pydantic import ValidationError

from vidyam_ai.application.ping import handle_ping
from vidyam_ai.generated.contracts import PingJob
from vidyam_ai.infrastructure.queue.runner import JobContext, JobHandler


async def ping(job: Job, _ctx: JobContext) -> dict[str, str]:
    try:
        payload = PingJob.model_validate(job.data)
    except ValidationError as error:
        # A malformed payload will never succeed: fail it without retries.
        raise UnrecoverableError(f"invalid ping payload: {error}") from error
    return handle_ping(payload)


HANDLERS: dict[str, JobHandler] = {"ping": ping}
