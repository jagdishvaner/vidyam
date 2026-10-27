"""Internal HTTP API of the AI engine. Only the NestJS API calls it (service token); never the browser."""

import hmac
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status

from vidyam_ai.application.health import CheckHealth
from vidyam_ai.application.providers import provider_status
from vidyam_ai.config import Settings, get_settings
from vidyam_ai.generated.contracts import AiEngineStatus, Liveness, ServiceHealth
from vidyam_ai.infrastructure.resources import Resources


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    token = settings.ai_internal_token.get_secret_value()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        resources = await Resources.open(settings)
        app.state.check_health = CheckHealth(resources.probes())
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

    return app
