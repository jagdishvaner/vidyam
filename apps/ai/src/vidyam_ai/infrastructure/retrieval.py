"""Retrieval wired to Qdrant, the Qwen3 model servers and the Valkey caches (plan v3 §7, step 20)."""

import httpx
from qdrant_client import AsyncQdrantClient
from redis.asyncio import Redis

from vidyam_ai.application.retrieval import Retrieve
from vidyam_ai.config import Settings
from vidyam_ai.domain.retrieval import Tuning
from vidyam_ai.infrastructure.cache import CachedEmbedder, CachedReranker, ValkeyCache
from vidyam_ai.infrastructure.models import create_embedder, create_reranker
from vidyam_ai.infrastructure.qdrant.search import QdrantPassageIndex


def create_retrieve(
    settings: Settings,
    qdrant: AsyncQdrantClient,
    http: httpx.AsyncClient,
    cache_redis: Redis,
    *,
    cache_prefix: str = "vidyam:ai:",  # tests and the eval use their own, to time the models for real
) -> Retrieve:
    cache = ValkeyCache(cache_redis, prefix=cache_prefix)
    return Retrieve(
        QdrantPassageIndex(qdrant),
        CachedEmbedder(create_embedder(settings, http), cache),
        CachedReranker(create_reranker(settings, http), cache, settings.rerank_model),
        Tuning(rerank=settings.rerank_candidates, rerank_tokens=settings.rerank_tokens),
    )
