"""Valkey caches for search (plan v3 §7, "Saving money"): query vectors, and the reranker's scores.

Both are fixed functions of their input for a given model, so an entry never goes stale: its key names the
model and hashes exactly what the model read. Search results themselves aren't cached; the index is asked
every time, so a file indexed or removed a moment ago already counts. A repeated query skips the models, the
slow part (reranking 10 passages takes about 12 s on the Mac).

Valkey evicts the least recently used entries when full. If it is down, search goes straight to the models.
"""

import hashlib
import logging
from array import array
from collections.abc import Mapping, Sequence
from typing import Protocol

from redis.asyncio import Redis
from redis.exceptions import RedisError

from vidyam_ai.application.embedding import Embedder, Reranker
from vidyam_ai.domain.embeddings import EmbeddingVersion

log = logging.getLogger(__name__)

TTL_S = 30 * 24 * 3600


class Cache(Protocol):
    async def get_many(self, keys: Sequence[str]) -> list[bytes | None]: ...
    async def set_many(self, items: Mapping[str, bytes], ttl_s: int) -> None: ...


class ValkeyCache:
    """A cache that never fails a request: when Valkey is unreachable, reads miss and writes are dropped."""

    def __init__(self, redis: Redis, prefix: str = "vidyam:ai:") -> None:
        self._redis = redis
        self._prefix = prefix

    async def get_many(self, keys: Sequence[str]) -> list[bytes | None]:
        if not keys:
            return []
        try:
            values = await self._redis.mget([self._prefix + key for key in keys])
        except (RedisError, OSError) as error:
            log.warning("search cache unavailable: %s", error)
            return [None] * len(keys)
        return [value.encode() if isinstance(value, str) else value for value in values]

    async def set_many(self, items: Mapping[str, bytes], ttl_s: int) -> None:
        if not items:
            return
        try:
            async with self._redis.pipeline(transaction=False) as pipe:
                for key, value in items.items():
                    pipe.set(self._prefix + key, value, ex=ttl_s)
                await pipe.execute()
        except (RedisError, OSError) as error:
            log.warning("search cache unavailable: %s", error)


def _digest(*parts: str) -> str:
    return hashlib.sha256("\x00".join(parts).encode()).hexdigest()


class CachedEmbedder:
    """An embedder that remembers query vectors (float32, as the model returns them)."""

    def __init__(self, inner: Embedder, cache: Cache) -> None:
        self._inner = inner
        self._cache = cache

    @property
    def version(self) -> EmbeddingVersion:
        return self._inner.version

    async def ready(self) -> bool:
        return await self._inner.ready()

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        keys = [f"qvec:{self.version.id}:{_digest(text)}" for text in texts]
        vectors: list[list[float] | None] = [
            array("f", value).tolist() if value is not None else None
            for value in await self._cache.get_many(keys)
        ]
        missing = [i for i, vector in enumerate(vectors) if vector is None]
        if missing:
            fresh = await self._inner.embed([texts[i] for i in missing])
            for i, vector in zip(missing, fresh, strict=True):
                vectors[i] = vector
            await self._cache.set_many(
                {keys[i]: array("f", vector).tobytes() for i, vector in zip(missing, fresh, strict=True)},
                TTL_S,
            )
        return [vector for vector in vectors if vector is not None]


class CachedReranker:
    """A reranker that remembers each (query, passage) score."""

    def __init__(self, inner: Reranker, cache: Cache, model: str) -> None:
        self._inner = inner
        self._cache = cache
        self._model = model

    async def ready(self) -> bool:
        return await self._inner.ready()

    async def rerank(self, query: str, documents: Sequence[str]) -> list[float]:
        keys = [f"rerank:{self._model}:{_digest(query, document)}" for document in documents]
        scores: list[float | None] = [
            float(value) if value is not None else None for value in await self._cache.get_many(keys)
        ]
        missing = [i for i, score in enumerate(scores) if score is None]
        if missing:
            fresh = await self._inner.rerank(query, [documents[i] for i in missing])
            for i, score in zip(missing, fresh, strict=True):
                scores[i] = score
            await self._cache.set_many(
                {keys[i]: repr(score).encode() for i, score in zip(missing, fresh, strict=True)}, TTL_S
            )
        return [score for score in scores if score is not None]
