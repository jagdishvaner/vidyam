"""Dependency probes for the AI engine's health check (implement application.health.DependencyProbe)."""

import asyncio
from typing import TYPE_CHECKING

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
