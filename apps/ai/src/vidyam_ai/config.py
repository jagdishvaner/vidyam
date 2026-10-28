"""Settings for the AI engine. Validated at startup; the process refuses to start if one is missing."""

import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import AliasChoices, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    # Real environment variables win over the repo-root .env (used for local runs only).
    model_config = SettingsConfigDict(env_prefix="VIDYAM_", env_file=REPO_ROOT / ".env", extra="ignore")

    # "production" turns a missing provider key into an error instead of falling back to the stub model.
    environment: Literal["development", "test", "production"] = "development"

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
    # llama-server reports Qwen3-Reranker's probability (checked by infra/models/verify_reranker.py); "logit"
    # is for servers that return raw scores.
    rerank_scores: Literal["logit", "probability"] = "probability"
    # How many search candidates the reranker reads, and the most tokens it reads of each. Whole passages
    # (1100 covers a 1024-token chunk and its headings): cut short, a Hindi passage loses its answer. The M5
    # reads about 700 tokens/s, so 10 take about 12 s; an L4 GPU on AWS is 10-20 times faster (use 30-50).
    rerank_candidates: int = Field(default=10, ge=0)
    rerank_tokens: int = Field(default=1100, ge=64)

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
    claude_aws_region: str | None = Field(
        default=None, validation_alias=AliasChoices("VIDYAM_CLAUDE_AWS_REGION", "AWS_REGION")
    )
    openai_api_key: SecretStr | None = Field(default=None, validation_alias=AliasChoices("OPENAI_API_KEY"))
    ai_stub: bool = False
    # Where the stub model keeps its finished batches until they are collected.
    ai_stub_dir: Path = Path(tempfile.gettempdir()) / "vidyam-stub-batches"

    @model_validator(mode="after")
    def _no_stub_in_production(self) -> Self:
        if self.environment == "production" and self.ai_stub:
            raise ValueError("VIDYAM_AI_STUB can't be on in production")
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def async_database_url(self) -> str:
        return self.database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    def bucket(self, kind: str) -> str:
        return f"{self.s3_bucket_prefix}-{kind}"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # pyright: ignore[reportCallIssue]  # values come from the environment
