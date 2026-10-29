"""The chat agent against the real database, search and model servers (plan v3 step 23), on the stub LLM: a
doubt is answered from the demo pack with a citation to the file and page, and a question the material doesn't
cover gets "not found" instead of a guess. Skipped without the model servers (`pnpm models:up`)."""

from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
import pytest
from redis.asyncio import Redis
from sqlalchemy import text
from vidyam_ai.application.chat import ChatAgent, TurnRef
from vidyam_ai.config import get_settings
from vidyam_ai.infrastructure.db.chat import SqlChatContext
from vidyam_ai.infrastructure.db.engine import create_engine
from vidyam_ai.infrastructure.llm import create_llm_gateway
from vidyam_ai.infrastructure.resources import create_qdrant
from vidyam_ai.infrastructure.retrieval import create_retrieve

from tests.integration.demo import demo_org
from tests.integration.test_manifest_ingestion import embedder_ready


async def test_doubts_are_answered_from_the_material_with_citations(tmp_path: Path) -> None:
    settings = get_settings()
    if not await embedder_ready(settings):
        pytest.skip("the model servers aren't running (pnpm models:up)")
    qdrant = create_qdrant(settings)
    redis = Redis.from_url(settings.cache_redis_url)
    engine = create_engine(settings.async_database_url)
    cache_prefix = f"test:{uuid4().hex}:"
    try:
        async with httpx.AsyncClient() as http, demo_org(tmp_path, "chat-agent-test") as demo:
            async with demo.owner.begin() as conn:
                user_id = (
                    await conn.execute(text("select id from users order by created_at limit 1"))
                ).scalar_one()
            agent = ChatAgent(
                SqlChatContext(engine),
                create_llm_gateway(settings, engine),
                create_retrieve(settings, qdrant, http, redis, cache_prefix=cache_prefix),
            )

            async def ask(question: str) -> dict[str, Any]:
                session, message = uuid4(), uuid4()
                async with demo.owner.begin() as conn:
                    await conn.execute(
                        text("insert into chat_sessions (id, org_id, user_id) values (:s, :o, :u)"),
                        {"s": session, "o": demo.org_id, "u": user_id},
                    )
                    await conn.execute(
                        text(
                            "insert into chat_messages (id, org_id, session_id, seq, role, content) "
                            "values (:m, :o, :s, 1, 'user', cast(:c as jsonb))"
                        ),
                        {
                            "m": message,
                            "o": demo.org_id,
                            "s": session,
                            "c": f'[{{"type":"text","text":"{question}"}}]',
                        },
                    )
                ref = TurnRef(demo.org_id, user_id, session, uuid4(), message, None)
                events = [event async for event in agent.execute(ref)]
                assert events[-1]["event"] == "done", events[-1]
                return events[-1]

            answered = await ask("त्वरण का SI मात्रक क्या है?")
            text_block, citations = answered["blocks"]
            assert "[1]" in text_block["text"] and "त्वरण" in text_block["text"]  # the passage on acceleration
            [source] = citations["items"]
            assert source["filename"] == "physics-motion-force-hi.pdf" and source["pageStart"] is not None
            assert answered["title"]  # a new chat gets a name

            unknown = await ask("मुगल साम्राज्य की स्थापना किसने की?")
            assert unknown["blocks"] == [
                {"type": "text", "text": unknown["blocks"][0]["text"]},
            ] and unknown["blocks"][0]["text"].startswith("यह आपके संस्थान की सामग्री में नहीं मिला")
    finally:
        await qdrant.close()
        async for key in redis.scan_iter(f"{cache_prefix}*"):
            await redis.delete(key)
        await redis.aclose()
        await engine.dispose()
