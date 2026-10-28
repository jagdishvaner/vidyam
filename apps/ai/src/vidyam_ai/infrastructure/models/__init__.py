"""Clients for the self-hosted Qwen3 search models (plan v3 §8)."""

import httpx

from vidyam_ai.config import Settings
from vidyam_ai.domain.embeddings import EmbeddingVersion
from vidyam_ai.infrastructure.models.qwen import HttpEmbedder, HttpReranker


def embedding_version(settings: Settings) -> EmbeddingVersion:
    return EmbeddingVersion(settings.embedding_model, settings.embedding_dims)


def create_embedder(settings: Settings, client: httpx.AsyncClient) -> HttpEmbedder:
    return HttpEmbedder(client, settings.embedding_url, embedding_version(settings))


def create_reranker(settings: Settings, client: httpx.AsyncClient) -> HttpReranker:
    return HttpReranker(client, settings.rerank_url, settings.rerank_model, settings.rerank_scores)
