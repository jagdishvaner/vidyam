"""The Qwen3 model servers as the AI engine uses them (plan v3 §8, step 17): `pnpm models:up` must be running;
without it these tests are skipped. Checks that the right models answer, and that their answers make sense
for Hindi, English and Hinglish: the passage that answers a query is the closest one and ranks first."""

import time

import httpx
import pytest
from vidyam_ai.config import get_settings
from vidyam_ai.domain.embeddings import RETRIEVE_PASSAGES, query_text
from vidyam_ai.infrastructure.models import create_embedder, create_reranker

PASSAGES = [
    "त्वरण (Acceleration) वेग में परिवर्तन की दर है। इसका SI मात्रक m/s² है।",
    "Ohm's law: the current through a conductor is proportional to the potential difference, V = IR.",
    "अम्ल नीले लिटमस को लाल कर देते हैं, जबकि क्षारक लाल लिटमस को नीला कर देते हैं।",
    "न्यूटन का तृतीय नियम: प्रत्येक क्रिया के बराबर और विपरीत प्रतिक्रिया होती है।",
]
QUERIES = [
    ("what is the unit of acceleration", 0),  # English query, Hindi passage
    ("ओम का नियम क्या है", 1),  # Hindi query, English passage
    ("litmus se acid aur base ki pehchan", 2),  # Hinglish
    ("Newton ka teesra niyam", 3),
]


@pytest.fixture
async def http() -> httpx.AsyncClient:
    client = httpx.AsyncClient()
    settings = get_settings()
    embedder, reranker = create_embedder(settings, client), create_reranker(settings, client)
    if not (await embedder.ready() and await reranker.ready()):
        await client.aclose()
        pytest.skip("the model servers aren't running (pnpm models:up)")
    return client


async def test_embeddings_put_the_answering_passage_closest(http: httpx.AsyncClient) -> None:
    embedder = create_embedder(get_settings(), http)
    passages = await embedder.embed(PASSAGES)
    queries = await embedder.embed([query_text(RETRIEVE_PASSAGES, q) for q, _ in QUERIES])
    assert all(len(v) == embedder.version.dims for v in passages)
    for (query, expected), vector in zip(QUERIES, queries, strict=True):
        similarity = [sum(a * b for a, b in zip(vector, p, strict=True)) for p in passages]
        assert max(range(len(PASSAGES)), key=lambda i: similarity[i]) == expected, (query, similarity)
    await http.aclose()


async def test_the_reranker_ranks_the_answer_first(http: httpx.AsyncClient) -> None:
    reranker = create_reranker(get_settings(), http)
    for query, expected in QUERIES:
        scores = await reranker.rerank(query, PASSAGES)
        assert all(0 <= s <= 1 for s in scores)
        assert max(range(len(PASSAGES)), key=lambda i: scores[i]) == expected, (query, scores)
        assert scores[expected] > 0.5
    # Latency is recorded, not gated: the M5 manages ~700 tokens/s with the 4B model, so 20 candidates of
    # ~300 tokens take ~10 s locally (an L4 on AWS is 10-20x faster). Two minutes means the server is unwell.
    candidates = [f"{PASSAGES[i % 4]} " * 3 for i in range(20)]
    started = time.perf_counter()
    await reranker.rerank("त्वरण का मात्रक", candidates)
    elapsed = time.perf_counter() - started
    print(f"rerank of 20 candidates: {elapsed:.2f}s")
    assert elapsed < 120
    await http.aclose()
