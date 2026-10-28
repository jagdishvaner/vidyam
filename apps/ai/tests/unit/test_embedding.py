"""The Qwen3 model-server clients and the embedding stage (plan v3 §5 step 9, §8), without a server."""

import json
import math
from collections.abc import Sequence
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from vidyam_ai.application.embedding import (
    ChunkToEmbed,
    EmbedSource,
    ModelServerError,
    StoredVector,
)
from vidyam_ai.application.ingestion import SourceFile
from vidyam_ai.domain.embeddings import EmbeddingVersion, document_text, query_text
from vidyam_ai.infrastructure.models.qwen import HttpEmbedder, HttpReranker

VERSION = EmbeddingVersion("qwen3-embedding-4b", 4)


def unit(*values: float) -> list[float]:
    norm = math.sqrt(sum(v * v for v in values))
    return [v / norm for v in values]


def server(handler: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_queries_carry_qwens_instruction_and_documents_their_headings() -> None:
    assert query_text("Find passages", "त्वरण क्या है?") == "Instruct: Find passages\nQuery:त्वरण क्या है?"
    assert document_text("Motion › Acceleration", "a = (v - u)/t") == "Motion › Acceleration\n\na = (v - u)/t"
    assert document_text(None, "text") == "text"
    assert VERSION.id == "qwen3-embedding-4b@4"


async def test_the_embedder_sends_texts_in_order_and_checks_what_comes_back() -> None:
    sent: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        sent.append(body)
        data = [{"index": i, "embedding": unit(i + 1, 1, 0, 0)} for i in range(len(body["input"]))]
        return httpx.Response(200, json={"data": list(reversed(data))})  # order comes from "index"

    embedder = HttpEmbedder(server(handler), "http://models:38180/", VERSION)
    vectors = await embedder.embed(["a", "b"])
    assert sent == [{"model": "qwen3-embedding-4b", "input": ["a", "b"], "encoding_format": "float"}]
    assert vectors == [unit(1, 1, 0, 0), unit(2, 1, 0, 0)]

    wrong = HttpEmbedder(
        server(lambda _: httpx.Response(200, json={"data": [{"index": 0, "embedding": [1.0, 0.0]}]})),
        "http://models",
        VERSION,
    )
    with pytest.raises(ModelServerError, match="4 dimensions") as error:
        await wrong.embed(["a"])
    assert not error.value.retryable

    down = HttpEmbedder(server(lambda _: httpx.Response(503, text="loading model")), "http://models", VERSION)
    with pytest.raises(ModelServerError) as busy:
        await down.embed(["a"])
    assert busy.value.retryable


async def test_the_reranker_returns_probabilities_in_document_order() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["top_n"] == 3
        results = [
            {"index": 2, "relevance_score": -4.0},  # a server reporting raw logits
            {"index": 0, "relevance_score": 3.0},
            {"index": 1, "relevance_score": 0.0},
        ]
        return httpx.Response(200, json={"results": results})

    reranker = HttpReranker(server(handler), "http://models:38181", "qwen3-reranker-4b", "logit")
    scores = await reranker.rerank("q", ["a", "b", "c"])
    assert [round(s, 3) for s in scores] == [0.953, 0.5, 0.018]

    vllm = HttpReranker(
        server(lambda _: httpx.Response(200, json={"results": [{"index": 0, "relevance_score": 0.25}]})),
        "http://gpu:8001",
        "qwen3-reranker-4b",
        "probability",
    )
    assert await vllm.rerank("q", ["a"]) == [0.25]


class FakeSources:
    def __init__(self) -> None:
        self.stages: list[tuple[str, str, bool]] = []

    async def get(self, org_id: UUID, source_id: UUID) -> SourceFile:
        return SourceFile(source_id, org_id, "k", "application/pdf")

    async def record_stage(self, org_id: UUID, source_id: UUID, **kwargs: Any) -> None:
        self.stages.append((kwargs["stage"], kwargs["status"], kwargs.get("advance", True)))


class FakeEmbedder:
    def __init__(self, ready: bool = True) -> None:
        self.calls: list[list[str]] = []
        self._ready = ready

    @property
    def version(self) -> EmbeddingVersion:
        return VERSION

    async def ready(self) -> bool:
        return self._ready

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        self.calls.append(list(texts))
        return [unit(len(text), 1, 0, 0) for text in texts]


class Memory:
    def __init__(self, chunks: list[ChunkToEmbed]) -> None:
        self._chunks = chunks
        self.files: dict[UUID, list[StoredVector]] = {}
        self.marked: list[UUID] = []

    async def chunks(self, org_id: UUID, source_id: UUID) -> list[ChunkToEmbed]:
        return self._chunks

    async def mark_embedded(self, org_id: UUID, chunk_ids: Sequence[UUID], version: EmbeddingVersion) -> None:
        self.marked = list(chunk_ids)

    async def read(self, org_id: UUID, source_id: UUID, version: EmbeddingVersion) -> list[StoredVector]:
        return self.files.get(source_id, [])

    async def write(
        self, org_id: UUID, source_id: UUID, version: EmbeddingVersion, vectors: Sequence[StoredVector]
    ) -> None:
        self.files[source_id] = list(vectors)


async def test_embedding_reuses_unchanged_text_and_waits_for_a_stopped_server() -> None:
    org, source = uuid4(), uuid4()
    first = [ChunkToEmbed(uuid4(), "text one", "Motion", "h1"), ChunkToEmbed(uuid4(), "text two", None, "h2")]
    memory, sources, embedder = Memory(first), FakeSources(), FakeEmbedder()
    use_case = EmbedSource(sources, memory, memory, embedder)  # type: ignore[arg-type]

    summary = await use_case.execute(org, source, run_id="r")
    assert (summary.embedded, summary.reused) == (2, 0)
    assert embedder.calls == [["Motion\n\ntext one", "text two"]]
    assert sources.stages[-1] == ("embedded", "done", True)

    # Re-chunked: new rows, one with unchanged text. Only the new text goes to the model.
    again = [ChunkToEmbed(uuid4(), "text two", None, "h2"), ChunkToEmbed(uuid4(), "text three", None, "h3")]
    memory._chunks = again
    summary = await use_case.execute(org, source, run_id="r")
    assert (summary.embedded, summary.reused) == (1, 1)
    assert embedder.calls[-1] == ["text three"]
    assert [v.chunk_id for v in memory.files[source]] == [c.id for c in again] == memory.marked

    stopped = EmbedSource(sources, memory, memory, FakeEmbedder(ready=False))  # type: ignore[arg-type]
    assert (await stopped.execute(org, source, run_id="r")).waiting
    assert sources.stages[-1] == ("embedded", "pending", False)  # the file stays "tagged" meanwhile
