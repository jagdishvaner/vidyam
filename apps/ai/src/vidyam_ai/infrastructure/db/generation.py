"""What generation reads and writes in Postgres (plan v3 §7): the run being made, the syllabus, and the
question bank. The AI engine writes the bank (questions and their tags); documents, runs and chats are the
API's to write (ADR 0017). Every query runs under the center's row-level security."""

from collections.abc import Mapping, Sequence
from decimal import Decimal
from typing import Any, cast
from uuid import UUID

from sqlalchemy import and_, exists, func, not_, or_, select, update
from sqlalchemy import cast as sql_cast
from sqlalchemy.dialects.postgresql import JSONB, insert
from sqlalchemy.ext.asyncio import AsyncEngine

from vidyam_ai.application.generation import GENERATION_TAGGER, BankQuestion, NewQuestion, Node, Run
from vidyam_ai.infrastructure.db.engine import org_transaction
from vidyam_ai.infrastructure.db.generated.tables import (
    t_chunks,
    t_documents,
    t_exam_syllabus,
    t_generation_runs,
    t_glossary_terms,
    t_item_exposure,
    t_llm_calls,
    t_member_settings,
    t_question_tags,
    t_questions,
    t_sources,
)
from vidyam_ai.infrastructure.db.syllabus import SqlSyllabus

GLOSSARY_TERMS = 80  # per call; the subject's most relevant come first once tuning ranks them (phase D)


class SqlGenerationStore:
    def __init__(self, engine: AsyncEngine, syllabus: SqlSyllabus) -> None:
        self._engine = engine
        self._syllabus = syllabus

    async def run(self, org_id: UUID, run_id: UUID) -> Run | None:
        r, d, m = t_generation_runs, t_documents, t_member_settings
        query = (
            select(
                r.c.id,
                r.c.document_id,
                r.c.session_id,
                r.c.workflow_id,
                r.c.spec,
                d.c.kind,
                d.c.title,
                d.c.exam_id,
                d.c.owner_id,
                m.c.ui_locale,
            )
            .join(d, d.c.id == r.c.document_id)
            .outerjoin(m, and_(m.c.user_id == d.c.owner_id, m.c.org_id == d.c.org_id))
            .where(r.c.id == run_id)
        )
        async with org_transaction(self._engine, org_id) as conn:
            row = (await conn.execute(query)).first()
        if row is None:
            return None
        return Run(
            id=row.id,
            document_id=row.document_id,
            session_id=row.session_id,
            workflow_id=row.workflow_id,
            kind=row.kind,
            title=row.title,
            spec=cast(dict[str, Any], row.spec),
            exam_id=row.exam_id,
            owner_id=row.owner_id,
            locale=row.ui_locale or "en",
        )

    async def weights(self, org_id: UUID, exam_id: UUID | None, node_ids: Sequence[str]) -> dict[str, float]:
        if exam_id is None:
            return {}
        s = t_exam_syllabus
        query = select(s.c.node_id, s.c.weightage).where(
            s.c.exam_id == exam_id, s.c.node_id.in_([UUID(i) for i in node_ids]), s.c.weightage.is_not(None)
        )
        async with org_transaction(self._engine, org_id) as conn:
            return {str(row.node_id): float(row.weightage) for row in await conn.execute(query)}

    async def nodes(self, org_id: UUID, ids: Sequence[str]) -> dict[str, Node]:
        wanted = set(ids)
        return {
            str(n.id): Node(str(n.id), n.name_en, n.name_hi, n.path)
            for n in await self._syllabus.nodes(org_id)
            if str(n.id) in wanted
        }

    async def children(self, org_id: UUID, node_id: str) -> list[Node]:
        return [
            Node(str(n.id), n.name_en, n.name_hi, n.path)
            for n in await self._syllabus.nodes(org_id)
            if n.parent_id == UUID(node_id)
        ]

    async def bank(
        self,
        org_id: UUID,
        node_id: str,
        qtype: str,
        languages: Sequence[str],
        *,
        exclude: Sequence[UUID],
        student_batch_id: UUID | None,
        limit: int,
    ) -> list[BankQuestion]:
        q, tags, seen = t_questions, t_question_tags, t_item_exposure
        under = [n.id for n in await self._syllabus.subtree(org_id, UUID(node_id))]
        if not under:
            return []
        tagged = exists().where(
            tags.c.question_id == q.c.id,
            tags.c.node_id.in_(under),
            or_(tags.c.method != "llm", tags.c.confidence >= 0.6),
        )
        conditions = [
            q.c.status.in_(("approved", "verified")),
            q.c.qtype == qtype,
            tagged,
            *(func.jsonb_typeof(q.c.content[lang]) == "object" for lang in languages),
        ]
        if exclude:
            conditions.append(q.c.id.not_in(list(exclude)))
        if student_batch_id is not None:
            conditions.append(
                not_(
                    exists().where(seen.c.question_id == q.c.id, seen.c.student_batch_id == student_batch_id)
                )
            )
        query = (
            select(q.c.id, q.c.difficulty)
            .where(*conditions)
            .order_by((q.c.status == "approved").desc(), q.c.usage_count, q.c.created_at)
            .limit(limit)
        )
        async with org_transaction(self._engine, org_id) as conn:
            return [BankQuestion(row.id, row.difficulty) for row in await conn.execute(query)]

    async def glossary(self, org_id: UUID, node_ids: Sequence[str]) -> list[tuple[str, str]]:
        nodes = await self._syllabus.nodes(org_id)
        by_id = {str(n.id): n for n in nodes}
        subjects = {
            n.id for n in nodes if any(by_id[i].path.split("/")[0] == n.path for i in node_ids if i in by_id)
        }
        g = t_glossary_terms
        query = (
            select(g.c.term_en, g.c.term_hi)
            .where(g.c.approved, or_(g.c.subject_node_id.in_(subjects), g.c.subject_node_id.is_(None)))
            .order_by(g.c.term_en)
            .limit(GLOSSARY_TERMS)
        )
        async with org_transaction(self._engine, org_id) as conn:
            return [(row.term_en, row.term_hi) for row in await conn.execute(query)]

    async def save_question(self, org_id: UUID, question: NewQuestion) -> UUID:
        q = t_questions
        run_id, slot_id = question.provenance["runId"], question.provenance["slotId"]
        async with org_transaction(self._engine, org_id) as conn:
            # Earlier questions for this slot of this run (a flagged one being replaced, or one a retried step
            # wrote before it failed) leave the bank.
            await conn.execute(
                update(q)
                .where(
                    q.c.origin == "generated",
                    q.c.provenance["runId"].astext == run_id,
                    q.c.provenance["slotId"].astext == slot_id,
                    q.c.status != "retired",
                )
                .values(status="retired", updated_at=func.now())
            )
            question_id: UUID = (
                await conn.execute(
                    insert(q)
                    .values(
                        org_id=org_id,
                        qtype=question.qtype,
                        origin="generated",
                        status=question.status,
                        content=question.content,
                        authoritative_language=question.language,
                        answer=question.answer,
                        marks=question.marks,
                        negative_marks=question.negative_marks,
                        difficulty=question.difficulty,
                        exam_id=question.exam_id,
                        licence="own",
                        provenance=question.provenance,
                        verification=question.verification,
                        created_by=question.created_by,
                    )
                    .returning(q.c.id)
                )
            ).scalar_one()
            await conn.execute(
                insert(t_question_tags).values(
                    org_id=org_id,
                    question_id=question_id,
                    node_id=UUID(question.node_id),
                    confidence=1.0,
                    method="generation",
                    tagger_version=GENERATION_TAGGER,
                    is_primary=True,
                )
            )
        return question_id

    async def questions(self, org_id: UUID, ids: Sequence[UUID]) -> dict[str, dict[str, Any]]:
        if not ids:
            return {}
        q = t_questions
        query = select(q.c.id, q.c.qtype, q.c.content, q.c.answer, q.c.provenance).where(
            q.c.id.in_(list(ids))
        )
        async with org_transaction(self._engine, org_id) as conn:
            return {
                str(row.id): {
                    "qtype": row.qtype,
                    "content": row.content,
                    "answer": row.answer,
                    "provenance": row.provenance,
                }
                for row in await conn.execute(query)
            }

    async def checked(
        self, org_id: UUID, question_id: UUID, status: str, verification: Mapping[str, Any]
    ) -> None:
        q = t_questions
        async with org_transaction(self._engine, org_id) as conn:
            await conn.execute(
                update(q)
                .where(q.c.id == question_id)
                .values(
                    status=status,
                    verification=q.c.verification.op("||")(sql_cast(dict(verification), JSONB)),
                    updated_at=func.now(),
                )
            )

    async def file_names(self, org_id: UUID, source_ids: Sequence[UUID]) -> dict[UUID, str]:
        s = t_sources
        async with org_transaction(self._engine, org_id) as conn:
            rows = await conn.execute(select(s.c.id, s.c.filename).where(s.c.id.in_(list(source_ids))))
            return {row.id: row.filename for row in rows}

    async def current(self, org_id: UUID, document_id: UUID) -> tuple[int, dict[str, Any]] | None:
        d = t_documents
        async with org_transaction(self._engine, org_id) as conn:
            row = (
                await conn.execute(select(d.c.current_version, d.c.content).where(d.c.id == document_id))
            ).first()
        return (row.current_version, cast(dict[str, Any], row.content)) if row else None

    async def passages(self, org_id: UUID, chunk_ids: Sequence[str]) -> list[str]:
        if not chunk_ids:
            return []
        c = t_chunks
        query = select(c.c.id, c.c.heading_path, c.c.text).where(c.c.id.in_([UUID(i) for i in chunk_ids]))
        async with org_transaction(self._engine, org_id) as conn:
            rows = {str(row.id): row for row in await conn.execute(query)}
        return [
            f"{rows[i].heading_path}\n{rows[i].text}" if rows[i].heading_path else rows[i].text
            for i in chunk_ids
            if i in rows
        ]

    async def cost(self, org_id: UUID, workflow_id: str) -> Decimal:
        c = t_llm_calls
        query = select(func.coalesce(func.sum(c.c.cost_usd), 0)).where(c.c.workflow_id == workflow_id)
        async with org_transaction(self._engine, org_id) as conn:
            return Decimal((await conn.execute(query)).scalar_one())
