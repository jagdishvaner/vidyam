"""Settings for the AI engine. Validated at startup; the process refuses to start if one is missing."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    # Real environment variables win over the repo-root .env (used for local runs only).
    model_config = SettingsConfigDict(env_prefix="VIDYAM_", env_file=REPO_ROOT / ".env", extra="ignore")

    ai_host: str = "127.0.0.1"
    ai_port: int = 38120
    ai_internal_token: SecretStr = Field(min_length=16)

    # Runtime role (row-level security applies); migrations are owned by packages/db.
    database_url: str
    qdrant_url: str
    qdrant_api_key: SecretStr
    cache_redis_url: str
    # Durable workflows (ADR 0013): host:port of the Temporal frontend, and Vidyam's namespace on it.
    temporal_address: str
    temporal_namespace: str = "vidyam"

    s3_endpoint: str | None = None  # unset on AWS: real S3 with the task's IAM role
    s3_region: str
    s3_access_key_id: str | None = None
    s3_secret_access_key: SecretStr | None = None
    s3_bucket_prefix: str

    # Self-hosted Qwen3 model server (plan v3 §8): OpenAI-compatible /v1/embeddings, Cohere/Jina-style
    # /v1/rerank. llama.cpp on the Mac's GPU locally, vLLM on an L4 GPU on AWS, the 0.6B models in CI.
    embedding_url: str = "http://127.0.0.1:38180"
    embedding_model: str = "qwen3-embedding-4b"
    embedding_dims: int = Field(default=2560, ge=32)
    rerank_url: str = "http://127.0.0.1:38181"
    rerank_model: str = "qwen3-reranker-4b"

    worker_cpu_processes: int = Field(default=2, ge=1)

    # LLM providers (plan v3 §8). Keys are read only here, never by the API or the browser. Without a key, or
    # with VIDYAM_AI_STUB=1, calls go to the built-in stub model.
    claude_endpoint: Literal["anthropic", "aws"] = "anthropic"
    anthropic_api_key: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("ANTHROPIC_API_KEY")
    )
    anthropic_aws_workspace_id: str | None = Field(
        default=None, validation_alias=AliasChoices("ANTHROPIC_AWS_WORKSPACE_ID")
    )
    openai_api_key: SecretStr | None = Field(default=None, validation_alias=AliasChoices("OPENAI_API_KEY"))
    ai_stub: bool = False

    @property
    def async_database_url(self) -> str:
        return self.database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    def bucket(self, kind: str) -> str:
        return f"{self.s3_bucket_prefix}-{kind}"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # pyright: ignore[reportCallIssue]  # values come from the environment
