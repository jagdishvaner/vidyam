"""Choosing the passages that answer a query (plan v3 §7 step 3, step 20). Pure; no I/O.

Search runs in stages, each cheaper to skip than the next:

1. **Hybrid search** (Qdrant): meaning (Qwen3 vectors) and keywords (BM25 over `lex` and `lex_roman`) each
   bring their best matches, fused by weighted reciprocal rank (RRF). Meaning finds the Hindi answer to an
   English question; keywords find exact terms, formulas and Hinglish spellings.
2. **One copy of each passage.** The Hindi and English editions of one book say the same thing twice, and the
   same notes may sit in two files. The copy in the teacher's language is kept, at the better rank.
3. **Rerank** (Qwen3-Reranker): the best candidates are read whole against the query, and each is given the
   probability that it answers it.
4. **Picks** balance relevance against saying the same thing twice (MMR), with only a few passages from one
   file while others are still relevant.

Each pick then brings its neighbours from the same section, so an answer that runs over a chunk boundary is
read whole.
"""

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

import numpy as np
from numpy.typing import NDArray

from vidyam_ai.domain.chunking import HEADING_SEPARATOR, estimate_tokens
from vidyam_ai.domain.devanagari import script_mix

# The same passage in the Hindi and English editions of one book: 0.80–0.92 on the demo pack, while different
# sections of one chapter reach 0.78. Within a parallel pair only; across files a copy must be nearly exact.
PARALLEL_SIMILARITY = 0.80
COPY_SIMILARITY = 0.95
# Below this reranker probability a passage doesn't answer the query; with nothing above it, the material
# doesn't cover the question and the chat says so (step 23). On the demo pack every answer scored 0.07 or more
# (an English question on a Hindi passage scores lowest), and questions the material can't answer 0.005 or
# less. Checked again by the retrieval eval (step 21).
MIN_RELEVANCE = 0.05
MAX_PER_SOURCE = 3


@dataclass(frozen=True)
class Scope:
    """Which passages may be found. Each field narrows the search; an empty one doesn't."""

    node_ids: tuple[UUID, ...] = ()  # syllabus nodes; a chapter also finds its topics' text
    languages: tuple[str, ...] = ()  # hi, en, mixed
    licences: tuple[str, ...] = ()
    source_kinds: tuple[str, ...] = ()
    chunk_kinds: tuple[str, ...] = ()
    source_ids: tuple[UUID, ...] = ()
    exclude_chunk_ids: tuple[UUID, ...] = ()  # e.g. evidence a paper has already used


@dataclass(frozen=True)
class Fusion:
    """How the three searches are weighed against each other: each passage scores weight / (k + rank) in
    each list it is in.

    A small k lets a list's first few count for much more than the rest. RRF's textbook k = 60 flattens
    them, so a passage halfway down all three lists beat the best match by meaning; on the demo pack's 45
    findable queries k = 2 (Qdrant's default) put every answer in the top 20, 44 in the top 5. Keyword lists
    are short because a long Hindi query also matches on common words (क्यों, होता). Tuned further by the
    retrieval eval (step 21)."""

    dense: float = 1.0
    lex: float = 0.5
    lex_roman: float = 0.5
    k: int = 2
    dense_depth: int = 50  # how far down each list is read before fusing
    keyword_depth: int = 20


@dataclass(frozen=True)
class Tuning:
    """How much each stage reads. The reranker reads whole passages: cut to 300 tokens (about 45 Hindi words,
    as Qwen's tokenizer spends 1.3 tokens per Devanagari letter), only 26 of the demo pack's 45 findable
    answers survived; whole, all 45 did, 42 of them first. Fusion puts every one in its top 10, so reading 10
    whole passages costs what 20 cut ones did."""

    candidates: int = 40  # fused candidates read back from the index
    rerank: int = 10  # of those, how many the reranker reads (0: none)
    rerank_tokens: int = 1100  # the most it reads of each: a whole chunk (at most 1024) and its headings
    fusion: Fusion = Fusion()
    max_per_source: int = MAX_PER_SOURCE


@dataclass(frozen=True)
class Passage:
    """A chunk as the search index holds it."""

    chunk_id: UUID
    source_id: UUID
    position: int
    text: str
    heading_path: str | None
    title: str | None
    page_start: int | None
    page_end: int | None
    page_label: str | None
    language: str
    chunk_kind: str
    source_kind: str
    licence: str
    parallel_group_id: UUID | None
    primary_node_id: UUID | None


@dataclass(frozen=True)
class Candidate:
    passage: Passage
    fused: float  # RRF score: only the order means anything
    vector: Sequence[float]


def query_language(query: str) -> str | None:
    """The edition a query asks for when the teacher hasn't said: Hindi if it is written in Devanagari.
    Latin script may be English or Hinglish, so it says nothing."""
    hindi, latin = script_mix(query)
    return "hi" if hindi > latin else None


def similarities(candidates: Sequence[Candidate]) -> NDArray[np.float32]:
    """Cosine similarity of every pair (vectors are unit length, so a dot product)."""
    if not candidates:
        return np.zeros((0, 0), dtype=np.float32)
    vectors = np.asarray([candidate.vector for candidate in candidates], dtype=np.float32)
    return vectors @ vectors.T


def _same_passage(a: Passage, b: Passage, similarity: float) -> bool:
    if a.source_id == b.source_id:
        return False  # neighbours in one file overlap in topic, not in text; picking spreads them out
    if similarity >= COPY_SIMILARITY:
        return True
    parallel = a.parallel_group_id is not None and a.parallel_group_id == b.parallel_group_id
    return parallel and similarity >= PARALLEL_SIMILARITY


def drop_duplicates(candidates: Sequence[Candidate], language: str | None) -> list[Candidate]:
    """One copy of each passage, in rank order. Of two copies the one in `language` is kept, at the better
    rank of the two; otherwise the better-ranked one."""
    similarity = similarities(candidates)
    kept: list[int] = []
    for i, candidate in enumerate(candidates):
        twin = next(
            (
                slot
                for slot, j in enumerate(kept)
                if _same_passage(candidates[j].passage, candidate.passage, float(similarity[i, j]))
            ),
            None,
        )
        if twin is None:
            kept.append(i)
            continue
        wanted = language is not None and candidate.passage.language == language
        if wanted and candidates[kept[twin]].passage.language != language:
            kept[twin] = i
    return [candidates[i] for i in kept]


def shorten(text: str, max_tokens: int) -> str:
    """The start of a text, cut at a word boundary, within about `max_tokens`."""
    if estimate_tokens(text) <= max_tokens:
        return text
    low, high = 0, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        if estimate_tokens(text[:middle]) <= max_tokens:
            low = middle
        else:
            high = middle - 1
    words = text[:low].rsplit(None, 1)
    return f"{words[0] if len(words) > 1 else text[:low]} …"


def rerank_text(passage: Passage, max_tokens: int) -> str:
    """What the reranker reads: where the passage sits (its headings), then its start."""
    text = f"{passage.heading_path}\n{passage.text}" if passage.heading_path else passage.text
    return shorten(text, max_tokens)


def normalized(scores: Sequence[float]) -> list[float]:
    """Scores spread over 0–1 (for fused scores, which have no scale of their own)."""
    if not scores:
        return []
    low, high = min(scores), max(scores)
    return [1.0 if high == low else (score - low) / (high - low) for score in scores]


def pick(
    candidates: Sequence[Candidate],
    relevance: Sequence[float],
    limit: int,
    *,
    diversity: float,
    max_per_source: int,
) -> list[int]:
    """Indices of the passages to return, best first: maximal marginal relevance, where `diversity` (0–1) is
    how much saying something new counts against relevance. A file past `max_per_source` is drawn on again
    only when no other file has anything left."""
    similarity = similarities(candidates)
    chosen: list[int] = []
    per_source: Counter[UUID] = Counter()

    def value(i: int) -> float:
        repeats = max((float(similarity[i, j]) for j in chosen), default=0.0)
        return (1 - diversity) * relevance[i] - diversity * repeats

    for capped in (True, False):
        rest = [i for i in range(len(candidates)) if i not in chosen]
        while rest and len(chosen) < limit:
            best = max(rest, key=value)
            rest.remove(best)
            source = candidates[best].passage.source_id
            if capped and per_source[source] >= max_per_source:
                continue
            chosen.append(best)
            per_source[source] += 1
    return chosen


def _same_section(a: Passage, b: Passage) -> bool:
    """One heading path is the other's, or sits under it ("11.1 Work" and "11.1 Work › Positive work")."""
    first, second = (a.heading_path or "", b.heading_path or "")
    shorter, longer = sorted((first, second), key=len)
    return longer == shorter or longer.startswith(f"{shorter}{HEADING_SEPARATOR}")


def neighbours(
    hits: Sequence[Passage], nearby: Sequence[Passage], window: int
) -> list[tuple[tuple[Passage, ...], tuple[Passage, ...]]]:
    """For each hit, the passages just before and after it in its file and section, up to `window` each
    way. A passage is shown once: never beside a hit when it is a hit itself, nor beside two hits."""
    by_place = {(passage.source_id, passage.position): passage for passage in nearby}
    shown = {hit.chunk_id for hit in hits}
    result: list[tuple[tuple[Passage, ...], tuple[Passage, ...]]] = []
    for hit in hits:
        sides: list[list[Passage]] = []
        for step in (-1, 1):
            side: list[Passage] = []
            for offset in range(1, window + 1):
                passage = by_place.get((hit.source_id, hit.position + step * offset))
                if passage is None or passage.chunk_id in shown or not _same_section(passage, hit):
                    break
                side.append(passage)
                shown.add(passage.chunk_id)
            sides.append(side[::-1] if step < 0 else side)
        result.append((tuple(sides[0]), tuple(sides[1])))
    return result
