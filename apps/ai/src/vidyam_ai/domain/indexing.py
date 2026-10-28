"""What a chunk or question looks like in the search index (plan v3 §5, "Qdrant point payload"). Pure; no I/O.

Search filters on these fields and never joins back to Postgres before ranking, so a point carries
everything retrieval needs: who may see it (org), what it is (kind, licence, language), where it sits
(syllabus nodes with all their ancestors, so a chapter filter also finds topic-level text), and its keyword
forms for BM25.

A tag counts for filtering only when it is trusted: set by a rule or a person, or picked by a model with
enough confidence. Low-confidence model tags wait for review and stay out of the index.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from vidyam_ai.domain.lexical import lexical
from vidyam_ai.domain.tagging import MIN_CONFIDENCE

INDEXER_VERSION = "index-1"  # bump when the payload changes: every point is rewritten on the next run


@dataclass(frozen=True)
class IndexTag:
    node_id: UUID
    method: str  # manifest, section, llm, human
    confidence: float | None
    is_primary: bool

    @property
    def trusted(self) -> bool:
        return self.method != "llm" or (self.confidence or 0) >= MIN_CONFIDENCE


@dataclass(frozen=True)
class SourceFacts:
    """What every chunk of a file shares."""

    id: UUID
    org_id: UUID
    kind: str
    licence: str
    language: str | None
    parallel_group_id: UUID | None
    subject_id: UUID | None
    exam_codes: tuple[str, ...]
    year: int | None
    title: str | None


@dataclass(frozen=True)
class ChunkFacts:
    id: UUID
    position: int
    kind: str
    text: str
    context_header: str | None
    heading_path: str | None
    page_start: int | None
    page_end: int | None
    page_label: str | None  # printed number of its first page
    language: str
    content_hash: str
    tags: Sequence[IndexTag] = field(default_factory=tuple[IndexTag, ...])


def node_ids(tags: Sequence[IndexTag], ancestors: Mapping[UUID, Sequence[UUID]]) -> list[UUID]:
    """Trusted tags and every node above them, without repeats, in a stable order."""
    seen: dict[UUID, None] = {}
    for tag in tags:
        if tag.trusted:
            for node in (tag.node_id, *ancestors.get(tag.node_id, ())):
                seen.setdefault(node)
    return list(seen)


def primary_node(tags: Sequence[IndexTag]) -> UUID | None:
    return next((tag.node_id for tag in tags if tag.is_primary and tag.trusted), None)


def chunk_payload(
    source: SourceFacts, chunk: ChunkFacts, ancestors: Mapping[UUID, Sequence[UUID]], embedding_version: str
) -> dict[str, Any]:
    lex, lex_roman = lexical(f"{chunk.heading_path or ''}\n{chunk.text}")
    return {
        "org_id": str(source.org_id),
        "source_id": str(source.id),
        "source_kind": source.kind,
        "licence": source.licence,
        "language": chunk.language,
        "parallel_group_id": str(source.parallel_group_id) if source.parallel_group_id else None,
        "subject_id": str(source.subject_id) if source.subject_id else None,
        "exam_codes": list(source.exam_codes),
        "year": source.year,
        "taxonomy_node_ids": [str(node) for node in node_ids(chunk.tags, ancestors)],
        "primary_node_id": str(primary) if (primary := primary_node(chunk.tags)) else None,
        "chunk_kind": chunk.kind,
        "page_start": chunk.page_start,
        "page_end": chunk.page_end,
        "page_label": chunk.page_label,
        "position": chunk.position,
        "heading_path": chunk.heading_path,
        "title": source.title,
        "text": chunk.text,
        "lex": lex,
        "lex_roman": lex_roman,
        "content_hash": chunk.content_hash,
        "embedding_version": embedding_version,
        "indexer_version": INDEXER_VERSION,
    }
