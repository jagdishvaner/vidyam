"""Making what a teacher confirmed (plan v3 §7, step 26), end to end on the stub LLM: the demo pack read into
a throwaway center by real workers, then GeneratePaper and GenerateNotes run on Temporal with the API's own
worker committing the document, the run and the chat's message. Skipped without the model servers
(`pnpm models:up`); needs the API built for its worker."""

import json
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from vidyam_ai.config import get_settings
from vidyam_ai.domain.generation import message_id
from vidyam_ai.generated.contracts import NotesDocument, PaperDocument, WorkflowType

from tests.integration.api_worker import api_worker
from tests.integration.demo import DemoOrg, demo_org
from tests.integration.test_manifest_ingestion import embedder_ready

BANKED = {
    "hi": {"stem": "बल का SI मात्रक क्या है?", "options": [{"key": k, "text": t} for k, t in
           zip("ABCD", ["न्यूटन", "जूल", "वाट", "पास्कल"], strict=True)], "solution": None},
    "en": {"stem": "What is the SI unit of force?", "options": [{"key": k, "text": t} for k, t in
           zip("ABCD", ["newton", "joule", "watt", "pascal"], strict=True)], "solution": None},
}  # fmt: skip


async def _one(demo: DemoOrg, sql: str, **values: Any) -> Any:
    async with demo.owner.connect() as conn:
        return (await conn.execute(text(sql), values)).scalar_one()


async def _confirmed(demo: DemoOrg, user: UUID, kind: str, spec: dict[str, Any]) -> dict[str, Any]:
    """What Confirm on a review card makes (the API's confirmSpec): a chat, a document at version 0 and its
    generation run; returns the workflow's input."""
    session, document, run = uuid4(), uuid4(), uuid4()
    workflow = (
        WorkflowType.generate_paper
        if kind in ("question_paper", "worksheet")
        else WorkflowType.generate_notes
    )
    async with demo.owner.begin() as conn:
        await conn.execute(
            text("insert into chat_sessions (id, org_id, user_id, status) values (:s, :o, :u, 'generating')"),
            {"s": session, "o": demo.org_id, "u": user},
        )
        await conn.execute(
            text(
                "insert into documents (id, org_id, kind, title, spec, owner_id, exam_id)"
                " values (:d, :o, :k, :t, cast(:spec as jsonb), :u,"
                " (select id from exams where org_id = :o and code = :exam))"
            ),
            {"d": document, "o": demo.org_id, "k": kind, "t": spec["title"], "spec": json.dumps(spec),
             "u": user, "exam": spec["examCode"]},
        )  # fmt: skip
        await conn.execute(
            text(
                "insert into generation_runs (id, org_id, document_id, session_id, workflow_id, spec)"
                " values (:r, :o, :d, :s, :w, cast(:spec as jsonb))"
            ),
            {"r": run, "o": demo.org_id, "d": document, "s": session, "w": f"{workflow.value}:{run}",
             "spec": json.dumps(spec)},
        )  # fmt: skip
    return {"v": 1, "orgId": str(demo.org_id), "requestedBy": str(user), "documentId": str(document),
            "runId": str(run), "sessionId": str(session), "modelId": None}  # fmt: skip


async def test_a_confirmed_paper_and_notes_are_made_from_the_material(tmp_path: Path) -> None:
    settings = get_settings()
    if not await embedder_ready(settings):
        pytest.skip("the model servers aren't running (pnpm models:up)")
    async with demo_org(tmp_path, "generation-test") as demo:
        api_queue = demo.task_queue.removesuffix("ai") + "api"
        user = await _one(demo, "select id from users order by created_at limit 1")
        force = await _one(demo, "select id from taxonomy_nodes where org_id = :o and code = :c",
                           o=demo.org_id, c="force_and_laws_of_motion")  # fmt: skip
        light = await _one(demo, "select id from taxonomy_nodes where org_id = :o and code = :c",
                           o=demo.org_id, c="light_reflection_refraction")  # fmt: skip
        # One approved question in the bank for Force: the paper takes it before writing any.
        banked = uuid4()
        async with demo.owner.begin() as conn:
            await conn.execute(
                text(
                    "insert into questions (id, org_id, qtype, origin, status, content,"
                    " authoritative_language, answer, difficulty, licence)"
                    " values (:q, :o, 'mcq_single', 'imported', 'approved',"
                    " cast(:c as jsonb), 'hi', cast(:a as jsonb), 2, 'own')"
                ),
                {"q": banked, "o": demo.org_id, "c": json.dumps(BANKED, ensure_ascii=False),
                 "a": json.dumps({"kind": "options", "keys": ["A"]})},
            )  # fmt: skip
            await conn.execute(
                text(
                    "insert into question_tags (org_id, question_id, node_id, method)"
                    " values (:o, :q, :n, 'human')"
                ),
                {"o": demo.org_id, "q": banked, "n": force},
            )

        paper = {
            "kind": "question_paper", "title": "Force and light test", "examCode": "rpsc_2g_p2_science",
            "blueprintId": None, "taxonomyNodeIds": [str(force), str(light)],
            "sections": [{"name": {"en": "Multiple choice", "hi": "बहुविकल्पीय"}, "qtype": "mcq_single",
                          "count": 8, "marksEach": 2, "negativeMarks": 0.66, "attemptAny": None,
                          "difficultyMix": {"easy": 0.3, "medium": 0.5, "hard": 0.2}, "scope": []}],
            "languages": ["hi", "en"], "layout": "hindi_then_english", "durationMinutes": 20,
            "sourcing": "bank_first", "studentBatchId": None, "setCodes": ["A", "B"],
        }  # fmt: skip
        notes = {
            "kind": "notes", "title": "Force notes", "examCode": "rpsc_2g_p2_science",
            "taxonomyNodeIds": [str(force)], "languages": ["hi"], "depth": "brief", "includeExamples": False,
            "includePractice": False,
        }  # fmt: skip
        async with api_worker(api_queue):
            paper_input = await _confirmed(demo, user, "question_paper", paper)
            made = await demo.client.execute_workflow(
                WorkflowType.generate_paper.value,
                paper_input,
                id=f"{WorkflowType.generate_paper.value}:{paper_input['runId']}",
                task_queue=demo.task_queue,
            )
            notes_input = await _confirmed(demo, user, "notes", notes)
            written = await demo.client.execute_workflow(
                WorkflowType.generate_notes.value,
                notes_input,
                id=f"{WorkflowType.generate_notes.value}:{notes_input['runId']}",
                task_queue=demo.task_queue,
            )

        # The paper: the bank's question first, the rest written from the material and checked.
        assert made["version"] == 1 and sum(made["outcome"].values()) == 8
        assert made["outcome"].get("bank") == 1 and made["outcome"].get("verified", 0) >= 4
        assert "pending" not in made["outcome"]
        async with demo.owner.connect() as conn:
            doc = (
                await conn.execute(
                    text("select current_version, content from documents where id = :d"),
                    {"d": paper_input["documentId"]},
                )
            ).one()
            run = (
                await conn.execute(
                    text("select status, actual_cost_usd, slot_states from generation_runs where id = :r"),
                    {"r": paper_input["runId"]},
                )
            ).one()
            message = (
                await conn.execute(
                    text("select content from chat_messages where id = :m"),
                    {"m": message_id(paper_input["runId"], "ready")},
                )
            ).scalar_one()
            status = await conn.scalar(
                text("select status from chat_sessions where id = :s"), {"s": paper_input["sessionId"]}
            )
            tags = (
                await conn.execute(
                    text(
                        "select q.status, q.verification, t.method from questions q join question_tags t"
                        " on t.question_id = q.id where q.provenance->>'runId' = :r and q.status <> 'retired'"
                    ),
                    {"r": paper_input["runId"]},
                )
            ).all()
        document = PaperDocument.model_validate(doc.content)
        assert doc.current_version == 1 and [s.code for s in document.sets] == ["A", "B"]
        assert next(s for s in document.slots if s.state.value == "bank").question_id == banked
        assert run.status == "done" and run.actual_cost_usd == 0  # the stub is free; the ledger says so
        assert {state["state"] for state in run.slot_states.values()} == set(made["outcome"])
        assert [block["type"] for block in message] == ["document_ref", "notice"]
        assert message[0]["version"] == 1 and "ready" in message[1]["text"]
        assert status == "idle"  # the chat is free again
        assert tags and {row.method for row in tags} == {"generation"}
        assert any(row.status == "verified" and row.verification["solve"] == "agreed" for row in tags)

        # The notes: one section for the chapter, with its sources.
        assert written["version"] == 1 and written["outcome"] == {"verified": 1}
        async with demo.owner.connect() as conn:
            content = await conn.scalar(
                text("select content from documents where id = :d"), {"d": notes_input["documentId"]}
            )
        section = NotesDocument.model_validate(content).sections[0]
        assert section.node_id == force and section.body.hi and "[1]" in section.body.hi
        assert section.citations[0].filename.endswith(".pdf")
