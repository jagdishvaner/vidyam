"""Long-lived clients shared by the HTTP app and the workers. Opened once, closed on shutdown."""

import warnings
from dataclasses import dataclass
from typing import TYPE_CHECKING
from urllib.parse import urlparse

import boto3
from botocore.config import Config
from qdrant_client import AsyncQdrantClient
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine
from temporalio.client import Client

from vidyam_ai.application.health import DependencyProbe
from vidyam_ai.config import Settings
from vidyam_ai.infrastructure.db.engine import create_engine
from vidyam_ai.infrastructure.probes import PostgresProbe, QdrantProbe, S3Probe, TemporalProbe, ValkeyProbe
from vidyam_ai.infrastructure.temporal.client import connect

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client


def create_qdrant(settings: Settings) -> AsyncQdrantClient:
    with warnings.catch_warnings():
        if urlparse(settings.qdrant_url).hostname in ("localhost", "127.0.0.1"):
            # Local Qdrant has no TLS; on AWS the URL is https and the warning stays on.
            warnings.filterwarnings("ignore", message="Api key is used with an insecure connection")
        return AsyncQdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key.get_secret_value())


def create_s3(settings: Settings) -> "S3Client":
    secret = settings.s3_secret_access_key.get_secret_value() if settings.s3_secret_access_key else None
    return boto3.client(
        "s3",
        region_name=settings.s3_region,
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=secret,
        config=Config(s3={"addressing_style": "path"} if settings.s3_endpoint else {}),
    )


@dataclass
class Resources:
    engine: AsyncEngine
    qdrant: AsyncQdrantClient
    temporal: Client
    cache_redis: Redis
    s3: "S3Client"
    settings: Settings

    @classmethod
    async def open(cls, settings: Settings) -> "Resources":
        return cls(
            engine=create_engine(settings.async_database_url),
            qdrant=create_qdrant(settings),
            temporal=await connect(settings, lazy=True),
            cache_redis=Redis.from_url(settings.cache_redis_url),
            s3=create_s3(settings),
            settings=settings,
        )

    def probes(self) -> list[DependencyProbe]:
        return [
            PostgresProbe(self.engine),
            QdrantProbe(self.qdrant),
            TemporalProbe(self.temporal),
            ValkeyProbe("valkey-cache", self.cache_redis),
            S3Probe(self.s3, self.settings.bucket("raw")),
        ]

    async def close(self) -> None:
        await self.engine.dispose()
        await self.qdrant.close()
        await self.cache_redis.aclose()
