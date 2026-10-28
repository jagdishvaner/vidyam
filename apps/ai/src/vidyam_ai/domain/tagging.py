"""Tagging chunks with the syllabus by rules, before any model is asked (plan v3 §5, step 8). Pure; no I/O.

The manifest's chapter applies to the whole file; otherwise a chunk takes its section's chapter. A chapter
tag from the manifest is certain; one from a matched heading carries the match's confidence, and below
MIN_CONFIDENCE it is kept for review but not used as the chunk's primary topic. A file known only by its
subject is tagged with the subject. Topics and subtopics inside a chapter are picked later by a model, among
that chapter's children.
"""

from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from vidyam_ai.domain.sections import PlannedSection

TagMethod = Literal["manifest", "section", "llm", "human"]

RULES_TAGGER = "rules-1"
MIN_CONFIDENCE = 0.6  # tags below this go to the review queue and are not searched on


@dataclass(frozen=True)
class Tag:
    node_id: UUID
    method: TagMethod
    confidence: float | None
    is_primary: bool


def rule_tags(chapter: UUID | None, section: PlannedSection | None, subject: UUID | None) -> list[Tag]:
    if chapter:
        return [Tag(chapter, "manifest", 1.0, True)]
    if section and section.node_id:
        confidence = section.confidence if section.confidence is not None else 1.0
        method: TagMethod = "manifest" if section.origin == "manifest" else "section"
        tags = [Tag(section.node_id, method, confidence, confidence >= MIN_CONFIDENCE)]
        if subject and confidence < MIN_CONFIDENCE:
            tags.append(Tag(subject, "manifest", 1.0, True))
        return tags
    return [Tag(subject, "manifest", 1.0, True)] if subject else []
