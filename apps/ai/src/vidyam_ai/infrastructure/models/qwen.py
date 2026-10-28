"""HTTP clients for the Qwen3 model servers: llama.cpp's llama-server locally, vLLM on AWS. Both speak the
same APIs, OpenAI-style /v1/embeddings and Cohere/Jina-style /v1/rerank, so only the URLs differ."""

import math
from collections.abc import Sequence
from typing import Literal

import httpx

from vidyam_ai.application.embedding import ModelServerError
from vidyam_ai.domain.embeddings import EmbeddingVersion, is_unit

TIMEOUT = httpx.Timeout(120, connect=3)  # a first request waits while the server loads the model onto the GPU


def _failure(service: str, error: Exception) -> ModelServerError:
    if isinstance(error, httpx.HTTPStatusError):
        status = error.response.status_code
        detail = error.response.text[:300]
        return ModelServerError(
            f"{service}: HTTP {status}: {detail}", retryable=status >= 500 or status == 429
        )
    return ModelServerError(f"{service}: {error}", retryable=True)


async def _ready(client: httpx.AsyncClient, url: str) -> bool:
    try:
        response = await client.get(f"{url}/health", timeout=3)
    except httpx.HTTPError:
        return False
    return response.status_code == 200


class HttpEmbedder:
    def __init__(self, client: httpx.AsyncClient, url: str, version: EmbeddingVersion) -> None:
        self._client = client
        self._url = url.rstrip("/")
        self._version = version

    @property
    def version(self) -> EmbeddingVersion:
        return self._version

    async def ready(self) -> bool:
        return await _ready(self._client, self._url)

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        try:
            response = await self._client.post(
                f"{self._url}/v1/embeddings",
                json={"model": self._version.model, "input": list(texts), "encoding_format": "float"},
                timeout=TIMEOUT,
            )
            response.raise_for_status()
        except httpx.HTTPError as error:
            raise _failure("embedding server", error) from error
        data = sorted(response.json()["data"], key=lambda item: item["index"])
        vectors = [[float(x) for x in item["embedding"]] for item in data]
        if len(vectors) != len(texts) or any(len(v) != self._version.dims for v in vectors):
            raise ModelServerError(
                f"embedding server: expected {len(texts)} vectors of {self._version.dims} dimensions; is it "
                f"serving {self._version.model}?",
                retryable=False,
            )
        if not all(is_unit(v) for v in vectors):
            raise ModelServerError("embedding server: vectors are not normalized", retryable=False)
        return vectors


class HttpReranker:
    def __init__(
        self, client: httpx.AsyncClient, url: str, model: str, scores: Literal["logit", "probability"]
    ) -> None:
        """`scores`: how the server reports relevance. llama-server gives Qwen3-Reranker's probability of
        "yes" (checked against Qwen's reference by infra/models/verify_reranker.py); "logit" is for raw
        scores."""
        self._client = client
        self._url = url.rstrip("/")
        self._model = model
        self._logits = scores == "logit"

    async def ready(self) -> bool:
        return await _ready(self._client, self._url)

    async def rerank(self, query: str, documents: Sequence[str]) -> list[float]:
        if not documents:
            return []
        try:
            response = await self._client.post(
                f"{self._url}/v1/rerank",
                json={
                    "model": self._model,
                    "query": query,
                    "documents": list(documents),
                    "top_n": len(documents),
                },
                timeout=TIMEOUT,
            )
            response.raise_for_status()
        except httpx.HTTPError as error:
            raise _failure("rerank server", error) from error
        scores = [0.0] * len(documents)
        for item in response.json()["results"]:
            score = float(item["relevance_score"])
            scores[int(item["index"])] = 1 / (1 + math.exp(-score)) if self._logits else score
        return scores
