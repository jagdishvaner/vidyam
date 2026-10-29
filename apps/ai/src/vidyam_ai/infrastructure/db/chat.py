"""What the chat agent reads (ADR 0015): the chat, the teacher's defaults, the center's exams, patterns and
syllabus, and how much the bank holds. Read-only: the API is the only writer of chats. Every query runs under
the center's row-level security."""

from collections.abc import Sequence
from typing import Any, cast
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine

from vidyam_ai.application.chat import DocumentView, Exam, Teacher, Transcript
from vidyam_ai.domain.chat import StoredMessage
from vidyam_ai.domain.mentions import NodeName
from vidyam_ai.domain.specs import Pattern
from vidyam_ai.infrastructure.db.engine import org_transaction
from vidyam_ai.infrastructure.db.generated.tables import (
    t_chat_messages,
    t_chat_sessions,
    t_coverage_stats,
    t_documents,
    t_exam_blueprints,
    t_exam_syllabus,
    t_exams,
    t_member_settings,
    t_member_subjects,
    t_questions,
    t_sources,
    t_taxonomy_nodes,
)

BANKED = ("approved", "verified")  # bank questions a paper may use as they are


def _pattern(row: Any) -> Pattern:
    spec = cast(dict[str, Any], row.spec)
    return Pattern(
        id=row.id,
        sections=tuple(spec["sections"]),
        duration_minutes=int(spec["durationMinutes"]),
        default_mix=spec.get("defaultDifficultyMix") or {},
        name=row.name,
    )


class SqlChatContext:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def transcript(self, org_id: UUID, session_id: UUID, up_to_message: UUID) -> Transcript | None:
        s, m = t_chat_sessions, t_chat_messages
        async with org_transaction(self._engine, org_id) as conn:
            session = (
                await conn.execute(
                    select(s.c.title, s.c.model_override, s.c.draft_spec, s.c.document_id).where(
                        s.c.id == session_id
                    )
                )
            ).first()
            last = (
                await conn.execute(
                    select(m.c.seq).where(m.c.id == up_to_message, m.c.session_id == session_id)
                )
            ).scalar_one_or_none()
            if session is None or last is None:
                return None
            rows = await conn.execute(
                select(m.c.role, m.c.content)
                .where(m.c.session_id == session_id, m.c.seq <= last, m.c.role.in_(("user", "assistant")))
                .order_by(m.c.seq)
            )
            messages = [StoredMessage(row.role, cast(list[dict[str, Any]], row.content)) for row in rows]
        return Transcript(
            title=session.title,
            model_override=session.model_override,
            draft_spec=cast(dict[str, Any] | None, session.draft_spec),
            document_id=session.document_id,
            messages=messages,
        )

    async def teacher(self, org_id: UUID, user_id: UUID) -> Teacher:
        ms, sub, e = t_member_settings, t_member_subjects, t_exams
        async with org_transaction(self._engine, org_id) as conn:
            settings = (
                await conn.execute(
                    select(ms.c.ui_locale, ms.c.content_language, e.c.code)
                    .select_from(ms.outerjoin(e, e.c.id == ms.c.default_exam_id))
                    .where(ms.c.user_id == user_id)
                )
            ).first()
            subjects = (
                await conn.execute(select(sub.c.subject_node_id).where(sub.c.user_id == user_id))
            ).scalars()
            return Teacher(
                ui_locale=settings.ui_locale if settings else None,
                content_language=settings.content_language if settings else None,
                default_exam=settings.code if settings else None,
                subjects=tuple(subjects),
            )

    async def exams(self, org_id: UUID) -> list[Exam]:
        e = t_exams
        async with org_transaction(self._engine, org_id) as conn:
            rows = await conn.execute(
                select(e.c.code, e.c.name_en, e.c.name_hi).order_by(e.c.family, e.c.code)
            )
            return [Exam(row.code, row.name_en, row.name_hi) for row in rows]

    async def patterns(self, org_id: UUID, exam_code: str) -> list[Pattern]:
        b, e = t_exam_blueprints, t_exams
        async with org_transaction(self._engine, org_id) as conn:
            rows = await conn.execute(
                select(b.c.id, b.c.spec, b.c.name)
                .join(e, e.c.id == b.c.exam_id)
                .where(e.c.code == exam_code, b.c.is_active)
                .order_by(b.c.name, b.c.version.desc())
            )
            latest: dict[str, Pattern] = {}
            for row in rows:
                latest.setdefault(row.name, _pattern(row))  # one version of each pattern: the newest
            return list(latest.values())

    async def pattern_by_id(self, org_id: UUID, pattern_id: UUID) -> Pattern | None:
        b = t_exam_blueprints
        async with org_transaction(self._engine, org_id) as conn:
            row = (await conn.execute(select(b.c.id, b.c.spec, b.c.name).where(b.c.id == pattern_id))).first()
        return _pattern(row) if row else None

    async def nodes(self, org_id: UUID, *, exam_code: str | None, subjects: Sequence[UUID]) -> list[NodeName]:
        n, es, e = t_taxonomy_nodes, t_exam_syllabus, t_exams
        async with org_transaction(self._engine, org_id) as conn:
            rows = (
                await conn.execute(
                    select(
                        n.c.id, n.c.parent_id, n.c.level, n.c.code, n.c.name_en, n.c.name_hi, n.c.aliases
                    ).where(n.c.is_active)
                )
            ).all()
            roots: set[UUID] = set()
            if exam_code:
                roots = set(
                    (
                        await conn.execute(
                            select(es.c.node_id).join(e, e.c.id == es.c.exam_id).where(e.c.code == exam_code)
                        )
                    ).scalars()
                )
        roots = roots or set(subjects)
        parent = {row.id: row.parent_id for row in rows}

        def in_scope(node: UUID | None) -> bool:
            while node is not None:
                if node in roots:
                    return True
                node = parent.get(node)
            return False

        return [
            NodeName(
                row.id,
                row.code,
                row.level,
                (row.name_en, *([row.name_hi] if row.name_hi else []), *row.aliases),
            )
            for row in rows
            if not roots or in_scope(row.id)
        ]

    async def node_names(self, org_id: UUID, ids: Sequence[str], language: str) -> dict[str, str]:
        n = t_taxonomy_nodes
        async with org_transaction(self._engine, org_id) as conn:
            rows = await conn.execute(
                select(n.c.id, n.c.name_en, n.c.name_hi).where(n.c.id.in_([UUID(i) for i in ids]))
            )
            return {
                str(row.id): (row.name_hi if language == "hi" and row.name_hi else row.name_en)
                for row in rows
            }

    async def bank_counts(
        self, org_id: UUID, node_ids: Sequence[str], qtypes: Sequence[str]
    ) -> dict[str, int]:
        c = t_coverage_stats
        async with org_transaction(self._engine, org_id) as conn:
            rows = await conn.execute(
                select(c.c.node_id, func.sum(c.c["items"]).label("items"))
                .where(
                    c.c.item == "question",
                    c.c.node_id.in_([UUID(i) for i in node_ids]),
                    c.c.kind.in_(qtypes),
                    c.c.status.in_(BANKED),
                )
                .group_by(c.c.node_id)
            )
            return {str(row.node_id): int(row.items) for row in rows}

    async def file_names(self, org_id: UUID, source_ids: Sequence[UUID]) -> dict[UUID, str]:
        s = t_sources
        async with org_transaction(self._engine, org_id) as conn:
            rows = await conn.execute(select(s.c.id, s.c.filename).where(s.c.id.in_(list(source_ids))))
            return {row.id: row.filename for row in rows}

    async def document(self, org_id: UUID, document_id: UUID) -> DocumentView | None:
        d, q, n = t_documents, t_questions, t_taxonomy_nodes
        async with org_transaction(self._engine, org_id) as conn:
            row = (
                await conn.execute(
                    select(d.c.id, d.c.kind, d.c.current_version, d.c.content).where(d.c.id == document_id)
                )
            ).first()
            if row is None:
                return None
            content = cast(dict[str, Any], row.content)
            slots: list[dict[str, Any]] = content.get("slots", [])
            ids = [UUID(slot["questionId"]) for slot in slots if slot.get("questionId")]
            questions = (
                {
                    str(r.id): {"qtype": r.qtype, "content": r.content, "status": r.status}
                    for r in await conn.execute(
                        select(q.c.id, q.c.qtype, q.c.content, q.c.status).where(q.c.id.in_(ids))
                    )
                }
                if ids
                else {}
            )
            nodes = {slot["taxonomyNodeId"] for slot in slots} | {
                section["nodeId"] for section in content.get("sections", []) if "nodeId" in section
            }
            names = (
                {
                    str(r.id): r.name_en
                    for r in await conn.execute(
                        select(n.c.id, n.c.name_en).where(n.c.id.in_([UUID(i) for i in nodes]))
                    )
                }
                if nodes
                else {}
            )
        return DocumentView(row.id, row.kind, row.current_version, content, questions, names)
