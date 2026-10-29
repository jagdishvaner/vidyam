"""Which syllabus nodes a teacher means (plan v3 §6, ADR 0015). Pure; no I/O.

The model only lifts chapter and topic names out of the message, as the teacher typed them ("gati ke niyam",
"Newton's laws", "प्रकाश का अपवर्तन"). Matching them is code: every name and alias of a node, and the mention,
are reduced to the same Hinglish sound key as keyword search (`lexical.romanized`), so Hindi, English and
Hinglish spellings meet, and compared word by word.

A mention resolves when one node clearly fits best. Otherwise its closest nodes go to the scope card, for the
teacher to pick from.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from vidyam_ai.domain.lexical import romanized

RESOLVED = 0.75  # this close, and clearly ahead of the next (or a chapter level with its topic), is meant
MARGIN = 0.15
CANDIDATE = 0.4  # this close is worth offering on the card
CANDIDATES = 6

# Words that say where something is, or what is wanted, rather than what it is about.
_FILLER_WORDS = (
    "chapter", "topic", "unit", "lesson", "part", "the", "of", "and", "in", "on", "a", "an", "to", "for",
    "अध्याय", "पाठ", "इकाई", "भाग", "का", "की", "के", "में", "पर", "और", "एवं", "तथा", "से",
    "adhyay", "ka", "ki", "ke", "me", "mein", "par", "pe", "aur", "evam", "tatha", "se",
    "questions", "question", "paper", "test", "notes", "प्रश्न", "नोट्स", "prashn",
)  # fmt: skip
_FILLER = frozenset(key for word in _FILLER_WORDS for key in romanized(word).split())


@dataclass(frozen=True)
class NodeName:
    id: UUID
    path: str
    level: str  # subject, unit, chapter, topic, subtopic
    names: tuple[str, ...]  # English and Hindi names, then aliases


@dataclass(frozen=True)
class Resolution:
    mention: str
    node: UUID | None  # the node meant, when it is clear
    candidates: tuple[UUID, ...]  # the closest nodes, best first, when it isn't


def _words(text: str) -> frozenset[str]:
    return frozenset(word for word in romanized(text).split() if word not in _FILLER)


_LEVEL = {"chapter": 4, "topic": 3, "subtopic": 2, "unit": 1, "subject": 0}


def similarity(mention: str, name: str) -> float:
    """Dice overlap of the two word sets, 0–1; 1 when they say the same thing in any script."""
    a, b = _words(mention), _words(name)
    return 2 * len(a & b) / (len(a) + len(b)) if a and b else 0.0


def resolve(mention: str, nodes: Sequence[NodeName]) -> Resolution:
    scored = sorted(
        (
            (max(similarity(mention, name) for name in node.names), _LEVEL.get(node.level, 0), node.id)
            for node in nodes
            if node.names
        ),
        key=lambda item: (item[0], item[1]),
        reverse=True,
    )
    scored = [item for item in scored if item[0] >= CANDIDATE]
    if not scored:
        return Resolution(mention, None, ())
    best, *rest = scored
    # A chapter and its own topic of the same name: the chapter, which covers the topic.
    ahead = not rest or best[0] - rest[0][0] >= MARGIN or (best[0] == rest[0][0] and best[1] > rest[0][1])
    clear = best[0] >= RESOLVED and ahead
    if clear:
        return Resolution(mention, best[2], ())
    return Resolution(mention, None, tuple(node for _, _, node in scored[:CANDIDATES]))
