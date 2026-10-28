"""Wires the LLM gateway to Postgres and the configured providers (plan v3 §8). Keys are read only here."""

from anthropic import AsyncAnthropic, AsyncAnthropicAWS
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncEngine

from vidyam_ai.application.llm_gateway import LlmGateway, LlmProvider
from vidyam_ai.config import Settings
from vidyam_ai.domain.llm import Provider
from vidyam_ai.infrastructure.db.llm import SqlBatchLog, SqlLlmCatalog, SqlUsageLedger
from vidyam_ai.infrastructure.llm.claude import AnthropicProvider
from vidyam_ai.infrastructure.llm.gpt import OpenAiProvider
from vidyam_ai.infrastructure.llm.stub import StubProvider


def create_providers(settings: Settings) -> dict[Provider, LlmProvider]:
    """The providers that have credentials. Claude Platform on AWS signs with the task's AWS credentials."""
    providers: dict[Provider, LlmProvider] = {}
    workspace = (settings.anthropic_aws_workspace_id or "").strip()
    if settings.claude_endpoint == "aws" and workspace:
        client = AsyncAnthropicAWS(workspace_id=workspace, aws_region=settings.claude_aws_region)
        providers["anthropic"] = AnthropicProvider(client)
    elif settings.claude_endpoint == "anthropic" and settings.anthropic_api_key:
        key = settings.anthropic_api_key.get_secret_value().strip()
        if key:
            providers["anthropic"] = AnthropicProvider(AsyncAnthropic(api_key=key))
    if settings.openai_api_key and settings.openai_api_key.get_secret_value().strip():
        providers["openai"] = OpenAiProvider(
            AsyncOpenAI(api_key=settings.openai_api_key.get_secret_value().strip())
        )
    return providers


def create_llm_gateway(settings: Settings, engine: AsyncEngine) -> LlmGateway:
    """In production there is no stub: a call to a provider without a key fails with a clear error."""
    stub = None if settings.is_production else StubProvider(settings.ai_stub_dir)
    return LlmGateway(
        SqlLlmCatalog(engine),
        SqlUsageLedger(engine),
        SqlBatchLog(engine),
        create_providers(settings),
        stub=stub,
        force_stub=settings.ai_stub,
    )
