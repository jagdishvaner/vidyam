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
            case "card_response" | "action" | "edit_summary":
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


# What the chat says in its own words: written here, not by a model, so it is free, instant and the same every
# time. Keyed by what happened; Hindi for teachers who write or work in Hindi.
REPLIES = {
    "need_details": (
        "A few details first, then I'll show you the plan before anything is made.",
        "पहले कुछ जानकारी दे दीजिए, फिर बनाने से पहले पूरी योजना दिखाऊँगा।",
    ),
    "review": (
        "Here is what I'll make. Check it, and press Confirm when it's right. Nothing is spent before that.",
        "यह बनेगा। जाँच लीजिए और सही हो तो Confirm दबाइए। उससे पहले कोई खर्च नहीं होगा।",
    ),
    "not_found": (
        "I couldn't find this in your center's material, so I won't guess. Try other words, or add notes on "
        "this topic to the library.",
        "यह आपके संस्थान की सामग्री में नहीं मिला, इसलिए अनुमान से उत्तर नहीं दूँगा। दूसरे शब्दों में पूछिए, या "
        "इस विषय के नोट्स लाइब्रेरी में जोड़िए।",
    ),
    "cancelled": (
        "Cancelled. Tell me what you'd like to make instead.",
        "रद्द कर दिया। बताइए, इसके बदले क्या बनाना है।",
    ),
    "nothing_to_confirm": (
        "There's nothing to confirm yet. Tell me what you'd like to make.",
        "अभी पुष्टि के लिए कुछ नहीं है। बताइए, क्या बनाना है।",
    ),
    "generation_off": (
        "Your spec is saved. Making papers and notes isn't switched on yet; it comes in the next update.",
        "आपकी योजना सहेज ली गई है। प्रश्न-पत्र और नोट्स बनाना अभी शुरू नहीं हुआ है; यह अगले अपडेट में आएगा।",
    ),
    "edit_later": (
        "Editing a document by chat isn't switched on yet. You can still change the spec here.",
        "चैट से दस्तावेज़ बदलना अभी शुरू नहीं हुआ है। योजना यहीं बदली जा सकती है।",
    ),
    "nothing_to_undo": ("There's nothing to undo yet.", "अभी पूर्ववत करने के लिए कुछ नहीं है।"),
}


def reply(key: str, language: str) -> str:
    english, hindi = REPLIES[key]
    return hindi if language == "hi" else english
