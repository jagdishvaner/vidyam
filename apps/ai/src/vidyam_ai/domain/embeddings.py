"""What the search models are given (plan v3 §5, step 9). Pure; no I/O.

Qwen3-Embedding is asymmetric: a document is embedded as it is, while a query carries a one-line instruction
saying what it is looking for (Qwen measures 1–5% better retrieval with one; instructions are written in
English even for Hindi queries). A chunk is embedded with its context header, so a passage under "Motion ›
Acceleration" is found for acceleration even when its own text never says the word.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass

# Instructions per kind of search. Changing one changes every query vector, so keep them stable.
RETRIEVE_PASSAGES = (
    "Given a teacher's question or topic, retrieve passages from study material that answer or teach it"
)
RETRIEVE_QUESTIONS = "Given a topic or a question, retrieve exam questions that test the same concept"


@dataclass(frozen=True)
class EmbeddingVersion:
    """One embedding model at one size: vectors from different versions are never compared."""

    model: str  # e.g. qwen3-embedding-4b
    dims: int
    provider: str = "llama.cpp"

    @property
    def id(self) -> str:
        return f"{self.model}@{self.dims}"


def query_text(instruction: str, query: str) -> str:
    """Qwen3-Embedding's query format, exactly as its model card writes it (no space after "Query:")."""
    return f"Instruct: {instruction}\nQuery:{query}"


def document_text(context_header: str | None, text: str) -> str:
    return f"{context_header}\n\n{text}" if context_header else text


def is_unit(vector: Sequence[float], tolerance: float = 1e-3) -> bool:
    """Vectors are L2-normalized, so cosine similarity is a dot product."""
    return abs(math.sqrt(sum(x * x for x in vector)) - 1) <= tolerance
