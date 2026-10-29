"""Internal HTTP API of the AI engine. Only the NestJS API calls it (service token); never the browser."""

import hmac
import json
import logging
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, get_args
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from vidyam_ai.application.backlogs import BacklogKind, Backlogs
from vidyam_ai.application.chat import ChatAgent, TurnRef, error
from vidyam_ai.application.health import CheckHealth
from vidyam_ai.application.providers import provider_status
from vidyam_ai.config import Settings, get_settings
from vidyam_ai.generated.contracts import (
    AiEngineStatus,
    BacklogEstimate,
    BacklogEstimates,
    ChatEngineEvent,
    ChatEngineTurn,
    Liveness,
    LlmProvider,
    ServiceHealth,
)
from vidyam_ai.generated.contracts import BacklogKind as BacklogKindContract
from vidyam_ai.infrastructure.db.backlogs import SqlBacklogStore
from vidyam_ai.infrastructure.db.chat import SqlChatContext
from vidyam_ai.infrastructure.db.sources import SqlSources
from vidyam_ai.infrastructure.db.syllabus import SqlSyllabus
from vidyam_ai.infrastructure.llm import create_llm_gateway
from vidyam_ai.infrastructure.resources import Resources
from vidyam_ai.infrastructure.retrieval import create_retrieve
from vidyam_ai.infrastructure.s3.page_images import S3PageImages


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    token = settings.ai_internal_token.get_secret_value()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        resources = await Resources.open(settings)
        app.state.check_health = CheckHealth(resources.probes())
        syllabus = SqlSyllabus(resources.engine)
        gateway = create_llm_gateway(settings, resources.engine)
        app.state.backlogs = Backlogs(
            gateway,
            SqlBacklogStore(resources.engine, SqlSources(resources.engine), syllabus),
            syllabus,
            S3PageImages(resources.s3, settings.bucket("derived")),
        )
        search = create_retrieve(settings, resources.qdrant, resources.http, resources.cache_redis)
        app.state.chat_agent = ChatAgent(SqlChatContext(resources.engine), gateway, search)
        try:
            yield
        finally:
            await resources.close()

    def require_service_token(
        x_vidyam_service_token: Annotated[str | None, Header()] = None,
    ) -> None:
        if not x_vidyam_service_token or not hmac.compare_digest(x_vidyam_service_token, token):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing or invalid service token")

    app = FastAPI(title="Vidyam AI engine (internal)", version="0.1.0", lifespan=lifespan)

    @app.get("/livez")
    async def livez() -> Liveness:
        return Liveness(ok=True)

    @app.get("/health", dependencies=[Depends(require_service_token)])
    async def health(request: Request) -> ServiceHealth:
        check: CheckHealth = request.app.state.check_health
        return await check.execute()

    @app.get("/providers", dependencies=[Depends(require_service_token)])
    async def providers() -> AiEngineStatus:
        return provider_status(settings)

    @app.get("/backlogs", dependencies=[Depends(require_service_token)])
    async def backlogs(request: Request, org_id: Annotated[UUID, Query(alias="orgId")]) -> BacklogEstimates:
        """What each of a center's backlogs holds and would cost; nothing is sent to a model."""
        backlogs: Backlogs = request.app.state.backlogs
        estimates: list[BacklogEstimate] = []
        for kind in get_args(BacklogKind):
            estimate = await backlogs.estimate(org_id, kind)
            estimates.append(
                BacklogEstimate(
                    kind=BacklogKindContract(estimate.kind),
                    items=estimate.items,
                    requests=estimate.requests,
                    modelId=estimate.model_id,
                    provider=LlmProvider(estimate.provider) if estimate.provider else None,
                    costUsd=float(estimate.cost_usd),
                    blocked=estimate.blocked,
                )
            )
        return BacklogEstimates(backlogs=estimates)

    @app.post("/chat/turns", dependencies=[Depends(require_service_token)])
    async def chat_turn(request: Request, turn: ChatEngineTurn) -> StreamingResponse:
        """Answers a chat turn the API has recorded, as ChatEngineEvent lines (NDJSON) ending with `done` or
        `error`. Reads the chat; the API stores the answer."""
        agent: ChatAgent = request.app.state.chat_agent
        ref = TurnRef(
            turn.org_id, turn.user_id, turn.session_id, turn.turn_id, turn.user_message_id, turn.model_id
        )
        return StreamingResponse(_ndjson(agent.execute(ref)), media_type="application/x-ndjson")

    return app


log = logging.getLogger(__name__)


async def _ndjson(events: AsyncIterator[dict[str, object]]) -> AsyncIterator[str]:
    """Each event checked against the contract, one per line; a failure ends the stream with an error."""
    try:
        async for event in events:
            yield _line(event)
    except Exception:
        log.exception("chat turn failed")
        yield _line(error("internal", "Something went wrong while answering. Try again."))


def _line(event: dict[str, object]) -> str:
    # Only the fields the event has: a field left out stays absent, not null, as the API's contract reads it.
    checked = ChatEngineEvent.model_validate(event)
    return json.dumps(checked.model_dump(by_alias=True, mode="json", exclude_unset=True)) + "\n"
