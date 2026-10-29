"""A chat as the models read it (plan v3 §6, ADR 0015). Pure; no I/O.

Messages are stored as provider-neutral blocks (`ChatBlock`). A model reads each message as plain text: what
was written, an answered card as its sentence, sources and documents as short notes. Blocks only the screen
needs (cards being asked, progress, errors) are left out. Any model can read the result, so a teacher can
switch between Claude and GPT mid-chat.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from vidyam_ai.domain.devanagari import script_mix
from vidyam_ai.domain.llm import Role, Turn


@dataclass(frozen=True)
class StoredMessage:
    role: Role
    blocks: Sequence[Mapping[str, Any]]


def _source(item: Mapping[str, Any]) -> str:
    page = item.get("pageLabel") or item.get("pageStart")
    return f"{item.get('filename', '?')}, p. {page}" if page else str(item.get("filename", "?"))


def message_text(blocks: Sequence[Mapping[str, Any]]) -> str:
    parts: list[str] = []
    for block in blocks:
        match block.get("type"):
            case "text":
                parts.append(str(block["text"]))
            case "card_response" | "edit_summary":
                parts.append(str(block["summary"]))
            case "citations":
                parts.append("Sources: " + "; ".join(_source(item) for item in block["items"]))
            case "document_ref":
                parts.append(f"[Document: {block['title']}, version {block['version']}]")
            case "notice":
                parts.append(str(block["text"]))
            case _:
                pass  # clarification cards, spec reviews, progress and errors are for the screen
    return "\n\n".join(part for part in parts if part.strip())


def conversation(messages: Sequence[StoredMessage]) -> list[Turn]:
    """The model's turns, in order: empty messages are left out and neighbours from the same side joined, so
    turns alternate as providers require."""
    turns: list[Turn] = []
    for message in messages:
        text = message_text(message.blocks)
        if not text:
            continue
        if turns and turns[-1].role == message.role:
            turns[-1] = Turn(message.role, f"{turns[-1].text}\n\n{text}")
        else:
            turns.append(Turn(message.role, text))
    return turns


def first_question(messages: Sequence[StoredMessage]) -> str:
    """The teacher's first words, which name the chat."""
    return next((t for m in messages if m.role == "user" and (t := message_text(m.blocks))), "")


def language_of(text: str) -> str:
    """The language to answer and title in: Hindi when written mostly in Devanagari."""
    hindi, latin = script_mix(text)
    return "Hindi" if hindi > latin else "English"
