"""What a chunk carries into the search index (plan v3 §5), and applying the outbox (ADR 0018)."""

from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID, uuid4

from vidyam_ai.application.indexing import ApplyOutbox, OutboxItem, Point
from vidyam_ai.domain.indexing import ChunkFacts, IndexTag, SourceFacts, chunk_payload, node_ids

SUBJECT, UNIT, CHAPTER, TOPIC, OTHER = (uuid4() for _ in range(5))
ANCESTORS = {CHAPTER: [UNIT, SUBJECT], TOPIC: [CHAPTER, UNIT, SUBJECT], OTHER: [UNIT, SUBJECT]}


def test_filters_see_trusted_tags_and_everything_above_them() -> None:
    tags = [
        IndexTag(CHAPTER, "manifest", 1.0, False),
        IndexTag(TOPIC, "llm", 0.9, True),
        IndexTag(OTHER, "llm", 0.4, False),  # waiting for review: not searched on
    ]
    assert node_ids(tags, ANCESTORS) == [CHAPTER, UNIT, SUBJECT, TOPIC]


def test_a_chunk_carries_what_search_filters_and_cites_by() -> None:
    org, source = uuid4(), uuid4()
    facts = SourceFacts(
        source, org, "notes", "own", "hi", None, SUBJECT, ("rpsc_2g_p2_science",), 2025, "गति"
    )
    chunk = ChunkFacts(
        uuid4(), 3, "definition", "त्वरण वेग में परिवर्तन की दर है।", "गति › त्वरण", "अध्याय 8: गति › त्वरण",
        2, 2, "42", "hi", "abc", (IndexTag(CHAPTER, "manifest", 1.0, True),),
    )  # fmt: skip
    payload = chunk_payload(facts, chunk, ANCESTORS, "qwen3-embedding-4b@2560")
    assert payload["org_id"] == str(org) and payload["source_id"] == str(source)
    assert payload["taxonomy_node_ids"] == [str(CHAPTER), str(UNIT), str(SUBJECT)]
    assert payload["primary_node_id"] == str(CHAPTER)
    assert (payload["chunk_kind"], payload["page_label"], payload["exam_codes"]) == (
        "definition",
        "42",
        ["rpsc_2g_p2_science"],
    )
    assert "त्वरण" in payload["lex"].split() and "tvaran" in payload["lex_roman"].split()
    assert payload["embedding_version"] == "qwen3-embedding-4b@2560"


class FakeIndex:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def upsert(self, collection: str, points: Sequence[Point]) -> None: ...
    async def delete_source(self, org_id: UUID, source_id: UUID, *, keep: Sequence[UUID] = ()) -> None:
        self.calls.append(("delete_source", source_id))

    async def delete(self, collection: str, ids: Sequence[UUID]) -> None:
        if ids[0] == OTHER:
            raise RuntimeError("qdrant down")
        self.calls.append((f"delete:{collection}", ids[0]))

    async def set_payload(self, collection: str, ids: Sequence[UUID], payload: Mapping[str, Any]) -> None:
        self.calls.append((f"set:{collection}", dict(payload)))


class FakeOutbox:
    def __init__(self, items: list[OutboxItem]) -> None:
        self.items = items
        self.applied: list[int] = []
        self.failures: list[int] = []

    async def next(self, limit: int) -> list[OutboxItem]:
        return self.items[:limit]

    async def done(self, item_id: int) -> None:
        self.applied.append(item_id)

    async def failed(self, item_id: int, error: str) -> None:
        self.failures.append(item_id)


async def test_the_outbox_is_applied_in_order_and_a_failure_waits_for_the_next_pass() -> None:
    org, source, chunk, question = uuid4(), uuid4(), uuid4(), uuid4()
    items = [
        OutboxItem(1, org, "source", source, "delete", {}),
        OutboxItem(2, org, "chunk", chunk, "update_payload", {"taxonomy_node_ids": []}),
        OutboxItem(3, org, "question", question, "delete", {}),
        OutboxItem(4, org, "chunk", OTHER, "delete", {}),
    ]
    index, outbox = FakeIndex(), FakeOutbox(items)
    assert await ApplyOutbox(outbox, index).execute() == 4  # type: ignore[arg-type]
    assert index.calls == [
        ("delete_source", source),
        ("set:chunks", {"taxonomy_node_ids": []}),
        ("delete:questions", question),
    ]
    assert (outbox.applied, outbox.failures) == ([1, 2, 3], [4])
