"""Tracing (plan v3 step 31): OpenTelemetry spans for the AI engine's HTTP endpoints, its calls to the model
servers and providers, Postgres and Valkey, and its Temporal workflows and activities, exported over OTLP/HTTP
to `otel_endpoint` (Jaeger locally, the AWS collector on AWS). A trace started in the browser's request to the
API continues here through the trace headers HTTP and Temporal carry. Without an endpoint, nothing is set up
and the spans the code opens cost nothing."""

import logging
from typing import Any

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from sqlalchemy.ext.asyncio import AsyncEngine
from temporalio.client import Interceptor
from temporalio.contrib.opentelemetry import TracingInterceptor

from vidyam_ai.config import Settings

log = logging.getLogger(__name__)
_provider: TracerProvider | None = None


def start_tracing(settings: Settings, service: str) -> bool:
    """Spans go to the configured endpoint from now on; false (and nothing done) when none is configured."""
    global _provider
    if _provider is not None:
        return True
    if not settings.otel_endpoint:
        return False
    _provider = TracerProvider(
        resource=Resource.create(
            {
                "service.name": service,
                "service.namespace": "vidyam",
                "deployment.environment": settings.environment,
            }
        )
    )
    endpoint = settings.otel_endpoint.rstrip("/") + "/v1/traces"
    _provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
    trace.set_tracer_provider(_provider)
    HTTPXClientInstrumentor().instrument()
    RedisInstrumentor().instrument()
    log.info("tracing to %s as %s", endpoint, service)
    return True


def stop_tracing() -> None:
    """Sends the spans still waiting, before the process exits."""
    if _provider is not None:
        _provider.shutdown()


def instrument_app(app: Any) -> None:
    if _provider is not None:
        FastAPIInstrumentor.instrument_app(app, excluded_urls="livez,health")


def instrument_engine(engine: AsyncEngine) -> None:
    if _provider is not None:
        # Its version check stops at SQLAlchemy 2.0; the engine events it uses are unchanged in 2.1.
        SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine, skip_dep_check=True)


def temporal_interceptors() -> list[Interceptor]:
    """Carries the trace through workflows into their activities (here, the API's and the render worker's)."""
    return [TracingInterceptor()] if _provider is not None else []
