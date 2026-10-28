"""Postgres adapter for the backlogs (plan v3 §5): pages waiting for OCR, question papers waiting to be split,
chunks and questions waiting for their topics; and where each result goes. Every statement runs inside the
organization (row-level security). Storing a result again replaces it, so a re-run never duplicates."""

from collections.abc import Mapping, Sequence
from typing import Any, Literal, cast
from uuid import UUID

from sqlalchemy import Table, delete, exists, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from vidyam_ai.application.backlogs import OcrJob, PaperJob, Provenance, TagJob, TopicResult
from vidyam_ai.domain.chunking import estimate_tokens
from vidyam_ai.domain.papers import PaperPage
from vidyam_ai.domain.sections import PlannedSection
from vidyam_ai.domain.tagging import MIN_CONFIDENCE, RULES_TAGGER, rule_tags
from vidyam_ai.generated.contracts import OcrPage, QuestionText, SegmentedQuestion
from vidyam_ai.infrastructure.db.engine import org_transaction
from vidyam_ai.infrastructure.db.generated.tables import (
    t_chunk_tags,
    t_chunks,
    t_exams,
    t_pages,
    t_pipeline_runs,
    t_pyq_refs,
    t_question_tags,
    t_questions,
    t_source_sections,
    t_sources,
    t_taxonomy_nodes,
)
from vidyam_ai.infrastructure.db.sources import SqlSources, structure_from_meta
from vidyam_ai.infrastructure.db.syllabus import SqlSyllabus

_READ_STAGES = ("chunked", "tagged", "embedded", "indexed")
_PAPER_KINDS = ("question_paper", "booklet")
_RULE_METHODS = ("manifest", "section")
REVIEW_BELOW = 0.5  # OCR legibility below this asks a person to check the page


def _provenance(made_by: Provenance) -> dict[str, Any]:
    return {
        "provider": made_by.provider,
        "model": made_by.model_id,
        "promptVersion": made_by.prompt_version,
        "batchId": str(made_by.batch_id) if made_by.batch_id else None,
    }


def _text(version: QuestionText | None) -> dict[str, Any] | None:
    return version.model_dump(mode="json", by_alias=True) if version else None


def _question_text(content: Mapping[str, Any]) -> str:
    """A question as the tag task reads it: stem and options, in each language it has."""
    parts: list[str] = []
    for lang in ("en", "hi"):
        version = content.get(lang)
        if isinstance(version, dict):
            text = QuestionText.model_validate(version)
            options = " ".join(f"({option.key}) {option.text}" for option in text.options)
            parts.append(f"{text.stem} {options}".strip())
    return "\n".join(parts)


class SqlBacklogStore:
    def __init__(self, engine: AsyncEngine, sources: SqlSources, syllabus: SqlSyllabus) -> None:
        self._engine = engine
        self._sources = sources
        self._syllabus = syllabus

    # --- OCR -----------------------------------------------------------------------------------------

    async def ocr_jobs(self, org_id: UUID, limit: int | None) -> list[OcrJob]:
        """Pages waiting for OCR that have an image to read (Word files have none)."""
        p, s = t_pages, t_sources
        query = (
            select(
                p.c.id,
                p.c.source_id,
                p.c.page_no,
                p.c.page_label,
                p.c.image_s_3_key,
                func.coalesce(s.c.title, s.c.filename).label("title"),
                s.c.language,
            )
            .join_from(p, s, s.c.id == p.c.source_id)
            .where(p.c.meta.has_key("awaitingOcr"), p.c.image_s_3_key.is_not(None), s.c.status != "failed")
            .order_by(s.c.created_at, s.c.id, p.c.page_no)
            .limit(limit)
        )
        async with org_transaction(self._engine, org_id) as conn:
            rows = (await conn.execute(query)).all()
        return [
            OcrJob(
                row.id, row.source_id, row.page_no, row.page_label, row.image_s_3_key, row.title, row.language
            )
            for row in rows
        ]

    async def save_ocr(self, org_id: UUID, page_id: UUID, page: OcrPage, made_by: Provenance) -> UUID | None:
        record = {**_provenance(made_by), "hasFigures": page.has_figures, "legibility": page.legibility}
        async with org_transaction(self._engine, org_id) as conn:
            row = (
                await conn.execute(select(t_pages.c.source_id, t_pages.c.meta).where(t_pages.c.id == page_id))
            ).first()
            if row is None:
                return None
            meta = dict(row.meta)
            if made_by.provider == "stub":
                # The stub can't see images: the attempt is noted; the page keeps waiting for a real model.
                meta["lastOcr"] = record
                await conn.execute(update(t_pages).where(t_pages.c.id == page_id).values(meta=meta))
                return None
            for key in ("awaitingOcr", "note", "lastOcr"):
                meta.pop(key, None)
            meta["ocr"] = record
            await conn.execute(
                update(t_pages)
                .where(t_pages.c.id == page_id)
                .values(
                    content_md=page.markdown,
                    method="vision_ocr",
                    confidence=page.legibility,
                    extractor_version=f"ocr:{made_by.prompt_version}",
                    review_status="pending" if page.legibility < REVIEW_BELOW else "not_needed",
                    meta=meta,
                    updated_at=func.now(),
                )
            )
            return row.source_id

    # --- Question papers -----------------------------------------------------------------------------

    async def paper_jobs(self, org_id: UUID, limit: int | None) -> list[PaperJob]:
        """Question papers that are read (no page waiting for OCR) but not yet split into questions."""
        s, r, p = t_sources, t_pipeline_runs, t_pages
        split = exists().where(r.c.source_id == s.c.id, r.c.stage == "segmented", r.c.status == "done")
        waiting = exists().where(p.c.source_id == s.c.id, p.c.meta.has_key("awaitingOcr"))
        query = (
            select(s.c.id, func.coalesce(s.c.title, s.c.filename).label("title"), s.c.set_code)
            .where(
                s.c.kind.in_(_PAPER_KINDS),
                s.c.status != "failed",
                s.c.stage.in_(_READ_STAGES),
                ~split,
                ~waiting,
            )
            .order_by(s.c.created_at, s.c.id)
            .limit(limit)
        )
        async with org_transaction(self._engine, org_id) as conn:
            papers = (await conn.execute(query)).all()
            pages = (
                await conn.execute(
                    select(p.c.source_id, p.c.page_no, p.c.content_md)
                    .where(p.c.source_id.in_([paper.id for paper in papers]))
                    .order_by(p.c.source_id, p.c.page_no)
                )
            ).all()
        by_paper: dict[UUID, list[PaperPage]] = {}
        for page in pages:
            by_paper.setdefault(page.source_id, []).append(PaperPage(page.page_no, page.content_md))
        return [
            PaperJob(paper.id, paper.title, paper.set_code, by_paper[paper.id])
            for paper in papers
            if by_paper.get(paper.id)
        ]

    async def save_questions(
        self, org_id: UUID, source_id: UUID, questions: Sequence[SegmentedQuestion], made_by: Provenance
    ) -> int:
        """Questions of a paper into the bank, each with where it appeared (pyq_refs). The other-language
        edition of the same paper (a parallel file) fills in the same questions; known answer keys apply."""
        async with org_transaction(self._engine, org_id) as conn:
            source = (await conn.execute(select(t_sources).where(t_sources.c.id == source_id))).first()
            if source is None:
                return 0
            set_code = source.set_code or ""
            exam = (
                (
                    await conn.execute(
                        select(t_exams.c.id, t_exams.c.authoritative_language).where(
                            t_exams.c.code == source.exam_codes[0]
                        )
                    )
                ).first()
                if source.exam_codes
                else None
            )
            sections = [
                PlannedSection(r.title, r.page_start, r.page_end, r.node_id, r.origin, r.confidence)
                for r in await conn.execute(
                    select(t_source_sections).where(t_source_sections.c.source_id == source_id)
                )
            ]
            chapter = structure_from_meta(source.meta).chapter
            own = await self._refs(conn, [source_id], set_code)
            siblings = await self._siblings(conn, source.id, source.parallel_group_id)
            parallel = await self._refs(conn, siblings, set_code) if siblings else {}

            saved: set[int] = set()
            for question in questions:
                content = {"hi": _text(question.hi), "en": _text(question.en)}
                if question.number in saved or not (content["hi"] or content["en"]):
                    continue
                saved.add(question.number)
                provenance = {
                    **_provenance(made_by),
                    "sourceId": str(source_id),
                    "page": question.page,
                    "setCode": set_code,
                    "number": question.number,
                    "hasFigure": question.has_figure,
                }
                question_id = own.get(question.number) or parallel.get(question.number)
                if question_id:
                    current = (
                        await conn.execute(
                            select(t_questions.c.content).where(t_questions.c.id == question_id)
                        )
                    ).scalar_one()
                    merged = {lang: content[lang] or current.get(lang) for lang in ("hi", "en")}
                    await conn.execute(
                        update(t_questions)
                        .where(t_questions.c.id == question_id)
                        .values(qtype=question.qtype.value, content=merged, updated_at=func.now())
                    )
                else:
                    both = content["hi"] and content["en"]
                    language = (
                        (exam.authoritative_language if exam else "hi")
                        if both
                        else ("hi" if content["hi"] else "en")
                    )
                    question_id = (
                        await conn.execute(
                            insert(t_questions)
                            .values(
                                org_id=org_id,
                                qtype=question.qtype.value,
                                origin="imported",
                                status="draft",
                                content=content,
                                authoritative_language=language,
                                answer={"kind": "unknown"},
                                exam_id=exam.id if exam else None,
                                year=source.year,
                                licence=source.licence,
                                provenance=provenance,
                            )
                            .returning(t_questions.c.id)
                        )
                    ).scalar_one()
                if question.number not in own:
                    await conn.execute(
                        insert(t_pyq_refs).values(
                            org_id=org_id,
                            question_id=question_id,
                            source_id=source_id,
                            set_code=set_code,
                            question_no=question.number,
                        )
                    )
                section = next(
                    (
                        s
                        for s in sections
                        if s.page_start is not None
                        and s.page_end is not None
                        and s.page_start <= question.page <= s.page_end
                    ),
                    None,
                )
                await self._rule_tag_question(
                    conn, org_id, question_id, rule_tags(chapter, section, source.subject_node_id)
                )
            await self._apply_keys(conn, source_id)
        await self._sources.record_stage(
            org_id,
            source_id,
            stage="segmented",
            status="done",
            run_id=str(made_by.batch_id),
            detail={"questions": len(saved)},
            advance=False,
        )
        return len(saved)

    @staticmethod
    async def _refs(conn: AsyncConnection, source_ids: Sequence[UUID], set_code: str) -> dict[int, UUID]:
        rows = await conn.execute(
            select(t_pyq_refs.c.question_no, t_pyq_refs.c.question_id).where(
                t_pyq_refs.c.source_id.in_(source_ids), t_pyq_refs.c.set_code == set_code
            )
        )
        return {row.question_no: row.question_id for row in rows}

    @staticmethod
    async def _siblings(conn: AsyncConnection, source_id: UUID, group: UUID | None) -> list[UUID]:
        if group is None:
            return []
        rows = await conn.execute(
            select(t_sources.c.id).where(
                t_sources.c.parallel_group_id == group,
                t_sources.c.id != source_id,
                t_sources.c.kind.in_(_PAPER_KINDS),
            )
        )
        return [row.id for row in rows]

    @staticmethod
    async def _rule_tag_question(
        conn: AsyncConnection, org_id: UUID, question_id: UUID, tags: Sequence[Any]
    ) -> None:
        t = t_question_tags
        topic_primary = (
            await conn.execute(
                select(exists().where(t.c.question_id == question_id, t.c.method == "llm", t.c.is_primary))
            )
        ).scalar_one()
        await conn.execute(delete(t).where(t.c.question_id == question_id, t.c.method.in_(_RULE_METHODS)))
        rows = [
            {
                "org_id": org_id,
                "question_id": question_id,
                "node_id": tag.node_id,
                "confidence": tag.confidence,
                "method": tag.method,
                "tagger_version": RULES_TAGGER,
                "is_primary": tag.is_primary and not topic_primary,
            }
            for tag in tags
        ]
        if rows:
            await conn.execute(pg_insert(t).on_conflict_do_nothing(), rows)

    # --- Answer keys ---------------------------------------------------------------------------------

    async def save_key(self, org_id: UUID, source_id: UUID, key: Mapping[int, str]) -> int:
        async with org_transaction(self._engine, org_id) as conn:
            row = (
                await conn.execute(
                    select(t_sources.c.meta, t_sources.c.answer_key_for_source_id).where(
                        t_sources.c.id == source_id
                    )
                )
            ).first()
            if row is None:
                return 0
            meta = {**row.meta, "answerKey": {str(number): answer for number, answer in key.items()}}
            await conn.execute(update(t_sources).where(t_sources.c.id == source_id).values(meta=meta))
            if row.answer_key_for_source_id is None:
                return 0
            return await self._apply_keys(conn, row.answer_key_for_source_id)

    @staticmethod
    async def _apply_keys(conn: AsyncConnection, paper_id: UUID) -> int:
        """Gives a paper's questions the answers from its keys, matched by booklet set and question number.
        Provisional keys go first, so a final key's answer is the one that stays."""
        keys = (
            await conn.execute(
                select(t_sources.c.id, t_sources.c.set_code, t_sources.c.meta).where(
                    t_sources.c.answer_key_for_source_id == paper_id
                )
            )
        ).all()

        def status(meta: Mapping[str, Any]) -> str:
            structure = meta.get("structure")
            final = (
                isinstance(structure, dict)
                and cast(dict[str, Any], structure).get("answerKeyStatus") == "final"
            )
            return "final" if final else "provisional"

        applied = 0
        for key in sorted(keys, key=lambda k: status(k.meta) == "final"):
            raw = key.meta.get("answerKey")
            if not isinstance(raw, dict):
                continue
            answers = cast(dict[str, str], raw)
            key_status = status(key.meta)
            refs = await conn.execute(
                select(
                    t_pyq_refs.c.id,
                    t_pyq_refs.c.question_id,
                    t_pyq_refs.c.question_no,
                    t_pyq_refs.c.key_status,
                ).where(t_pyq_refs.c.source_id == paper_id, t_pyq_refs.c.set_code == (key.set_code or ""))
            )
            for ref in refs.all():
                answer = answers.get(str(ref.question_no))
                if not answer or (ref.key_status == "final" and key_status != "final"):
                    continue
                value = {"kind": "options", "keys": [answer]}
                await conn.execute(
                    update(t_pyq_refs)
                    .where(t_pyq_refs.c.id == ref.id)
                    .values(key_answer=value, key_status=key_status, key_source_id=key.id)
                )
                await conn.execute(
                    update(t_questions)
                    .where(t_questions.c.id == ref.question_id)
                    .values(answer=value, updated_at=func.now())
                )
                applied += 1
        return applied

    # --- Topics --------------------------------------------------------------------------------------

    async def tag_jobs(self, org_id: UUID, limit: int | None, *, with_text: bool) -> list[TagJob]:
        """Chunks and questions not yet checked for topics, whose chapter (or subject) has topics to pick."""
        jobs: list[TagJob] = []
        async with org_transaction(self._engine, org_id) as conn:
            for item in ("chunk", "question"):
                remaining = None if limit is None else limit - len(jobs)
                if remaining == 0:
                    break
                jobs.extend(await self._tag_jobs(conn, item, remaining, with_text))
        return jobs

    @staticmethod
    async def _tag_jobs(
        conn: AsyncConnection, item: Literal["chunk", "question"], limit: int | None, with_text: bool
    ) -> list[TagJob]:
        n = t_taxonomy_nodes
        if item == "chunk":
            items, tags, tag_item = t_chunks, t_chunk_tags, t_chunk_tags.c.chunk_id
            columns = [t_chunks.c.token_count, t_chunks.c.text, t_chunks.c.heading_path, t_chunks.c.source_id]
            order = [t_chunks.c.source_id, t_chunks.c.position]
        else:
            items, tags, tag_item = t_questions, t_question_tags, t_question_tags.c.question_id
            columns = [t_questions.c.content]
            order = [t_questions.c.created_at, t_questions.c.id]
        scope = (
            select(tags.c.node_id)
            .where(tag_item == items.c.id, tags.c.method.in_(_RULE_METHODS))
            .order_by(tags.c.is_primary.desc(), tags.c.confidence.desc().nulls_last())
            .limit(1)
            .scalar_subquery()
        )
        has_topics = exists().where(n.c.parent_id == scope, n.c.is_active)
        query = (
            select(items.c.id, scope.label("scope"), *columns)
            .where(items.c.topics_checked_at.is_(None), has_topics)
            .order_by(*order)
            .limit(limit)
        )
        rows = (await conn.execute(query)).all()
        if item == "chunk":
            return [
                TagJob(
                    "chunk",
                    row.id,
                    row.token_count,
                    row.scope,
                    row.text if with_text else "",
                    row.heading_path,
                    row.source_id,
                )
                for row in rows
            ]
        result: list[TagJob] = []
        for row in rows:
            text = _question_text(row.content)
            result.append(
                TagJob("question", row.id, estimate_tokens(text), row.scope, text if with_text else "")
            )
        return result

    async def save_topic_tags(self, org_id: UUID, results: Sequence[TopicResult], tagger: str) -> int:
        nodes = await self._syllabus.nodes(org_id)
        by_path = {node.path: node for node in nodes}
        by_id = {node.id: node for node in nodes}
        stored = 0
        async with org_transaction(self._engine, org_id) as conn:
            for kind in ("chunk", "question"):
                items = [result for result in results if result.item == kind]
                if not items:
                    continue
                table, owner, tags = _tag_tables(kind)
                ids = [result.id for result in items]
                scopes: dict[UUID, UUID] = {}
                for row in await conn.execute(
                    select(owner.label("item"), tags.c.node_id)
                    .where(owner.in_(ids), tags.c.method.in_(_RULE_METHODS))
                    .order_by(tags.c.is_primary, tags.c.confidence.nulls_first())
                ):
                    scopes[row.item] = row.node_id  # the last row per item is its best rule tag
                await conn.execute(delete(tags).where(owner.in_(ids), tags.c.method == "llm"))
                for result in items:
                    scope_id = scopes.get(result.id)
                    scope = by_id.get(scope_id) if scope_id else None
                    if scope is None:
                        continue
                    picked: dict[UUID, float] = {}
                    for path, confidence in result.tags:
                        node = by_path.get(path)
                        if node and node.path.startswith(f"{scope.path}/"):
                            picked[node.id] = max(confidence, picked.get(node.id, 0.0))
                    if not picked:
                        continue
                    best_id, best = max(picked.items(), key=lambda pair: pair[1])
                    primary = best_id if best >= MIN_CONFIDENCE else None
                    await conn.execute(
                        pg_insert(tags).on_conflict_do_nothing(),
                        [
                            {
                                "org_id": org_id,
                                owner.name: result.id,
                                "node_id": node_id,
                                "confidence": confidence,
                                "method": "llm",
                                "tagger_version": tagger,
                                "is_primary": node_id == primary,
                            }
                            for node_id, confidence in picked.items()
                        ],
                    )
                    if primary:  # the topic is now the item's main tag; the chapter stays as a tag
                        await conn.execute(
                            update(tags)
                            .where(owner == result.id, tags.c.method.in_(_RULE_METHODS))
                            .values(is_primary=False)
                        )
                    stored += len(picked)
                await conn.execute(
                    update(table).where(table.c.id.in_(ids)).values(topics_checked_at=func.now())
                )
        return stored


def _tag_tables(kind: str) -> tuple[Table, Any, Table]:
    if kind == "chunk":
        return t_chunks, t_chunk_tags.c.chunk_id, t_chunk_tags
    return t_questions, t_question_tags.c.question_id, t_question_tags
