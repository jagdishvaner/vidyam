"""Dependency probes for the AI engine's health check (implement application.health.DependencyProbe)."""

import asyncio
from typing import TYPE_CHECKING

import httpx
from qdrant_client import AsyncQdrantClient
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from temporalio.client import Client

from vidyam_ai.infrastructure.qdrant.collections import COLLECTIONS
from vidyam_ai.infrastructure.temporal.client import describe_namespace

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client


class PostgresProbe:
    name = "postgres"

    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def check(self) -> str | None:
        async with self._engine.connect() as conn:
            role = (await conn.execute(text("select current_user"))).scalar_one()
        return f"connected as {role}"


class QdrantProbe:
    name = "qdrant"

    def __init__(self, client: AsyncQdrantClient) -> None:
        self._client = client

    async def check(self) -> str | None:
        aliases = {a.alias_name for a in (await self._client.get_aliases()).aliases}
        missing = [c for c in COLLECTIONS if c not in aliases]
        if missing:
            raise RuntimeError(f"collections not bootstrapped: {', '.join(missing)} (run `pnpm bootstrap`)")
        return f"collections ready: {', '.join(COLLECTIONS)}"


class ValkeyProbe:
    def __init__(self, name: str, client: Redis) -> None:
        self.name = name
        self._client = client

    async def check(self) -> str | None:
        await self._client.ping()
        policy = await self._client.config_get("maxmemory-policy")
        return f"maxmemory-policy={policy.get('maxmemory-policy')}"


class TemporalProbe:
    name = "temporal"

    def __init__(self, client: Client) -> None:
        self._client = client

    async def check(self) -> str | None:
        await describe_namespace(self._client)
        return f"namespace {self._client.namespace} ready"


class S3Probe:
    name = "s3"

    def __init__(self, client: "S3Client", bucket: str) -> None:
        self._client = client
        self._bucket = bucket

    async def check(self) -> str | None:
        await asyncio.to_thread(self._client.head_bucket, Bucket=self._bucket)
        return f"bucket {self._bucket} reachable"


class ModelServerProbe:
    """A Qwen3 model server (llama-server locally, vLLM on AWS): up, and serving the expected model."""

    def __init__(self, name: str, client: httpx.AsyncClient, url: str, model: str) -> None:
        self.name = name
        self._client = client
        self._url = url.rstrip("/")
        self._model = model

    async def check(self) -> str | None:
        try:
            response = await self._client.get(f"{self._url}/v1/models", timeout=2)
            response.raise_for_status()
        except httpx.HTTPError as error:
            raise RuntimeError(f"not running at {self._url} (pnpm models:up)") from error
        served = [str(model.get("id")) for model in response.json().get("data", [])]
        if self._model not in served:
            raise RuntimeError(f"serving {', '.join(served) or 'nothing'}, not {self._model}")
        return f"serving {self._model}"
