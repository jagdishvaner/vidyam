"""Reads a chat for the AI engine (ADR 0015). Read-only: the API is the only writer of chats."""

from typing import Any, cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine

from vidyam_ai.application.chat import Transcript
from vidyam_ai.domain.chat import StoredMessage
from vidyam_ai.infrastructure.db.engine import org_transaction
from vidyam_ai.infrastructure.db.generated.tables import t_chat_messages, t_chat_sessions


class SqlChatTranscripts:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def load(self, org_id: UUID, session_id: UUID, up_to_message: UUID) -> Transcript | None:
        s, m = t_chat_sessions, t_chat_messages
        async with org_transaction(self._engine, org_id) as conn:
            session = (
                await conn.execute(select(s.c.title, s.c.model_override).where(s.c.id == session_id))
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
        return Transcript(session.title, session.model_override, messages)
