"""Which LLM providers the engine can use. Reports only whether credentials are set, never the credentials."""

from vidyam_ai.config import Settings
from vidyam_ai.generated.contracts import AiEngineStatus, Provider, ProviderStatus


def _has(secret: object | None) -> bool:
    value = getattr(secret, "get_secret_value", lambda: secret)()
    return bool(value and str(value).strip())


def provider_status(settings: Settings) -> AiEngineStatus:
    if settings.claude_endpoint == "aws":
        # Claude Platform on AWS signs with the task's AWS credentials; the workspace id is the setting.
        claude = bool(settings.anthropic_aws_workspace_id and settings.anthropic_aws_workspace_id.strip())
    else:
        claude = _has(settings.anthropic_api_key)
    openai = _has(settings.openai_api_key)
    return AiEngineStatus(
        providers=[
            ProviderStatus(provider=Provider.anthropic, configured=claude, endpoint=settings.claude_endpoint),
            ProviderStatus(provider=Provider.openai, configured=openai, endpoint=None),
        ],
        stubActive=settings.ai_stub or not (claude or openai),
    )
