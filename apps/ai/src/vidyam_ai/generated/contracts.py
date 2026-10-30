# Generated from packages/contracts by `pnpm codegen`. Do not edit by hand.

from __future__ import annotations

from datetime import date as date_aliased
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, EmailStr, Field, RootModel


class VidyamContracts(RootModel[Any]):
    root: Any = Field(
        ...,
        description="Generated from @vidyam/contracts. Do not edit; run `pnpm codegen`.",
        title="VidyamContracts",
    )


class AddedMember(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    user_id: UUID = Field(..., alias="userId")


class AiTaskQueue(StrEnum):
    ai = "ai"
    ai_cpu = "ai-cpu"
    ai_llm = "ai-llm"


class Answer1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Literal["options"]
    keys: list[str] = Field(..., min_length=1)


class Answer2(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Literal["numeric"]
    value: float
    tolerance: float = Field(..., ge=0.0)


class Answer3(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Literal["text"]
    model_answer: str = Field(..., alias="modelAnswer")


class Answer4(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Literal["unknown"]


class Answer(RootModel[Answer1 | Answer2 | Answer3 | Answer4]):
    root: Answer1 | Answer2 | Answer3 | Answer4 = Field(..., title="Answer")


class ApiActivity(StrEnum):
    save_document_version = "save_document_version"
    update_generation_run = "update_generation_run"
    append_chat_blocks = "append_chat_blocks"
    apply_document_edits = "apply_document_edits"
    finish_export = "finish_export"


class AppendChatBlocksResult(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    message_id: UUID = Field(..., alias="messageId")
    created: bool


class Version(RootModel[int]):
    root: int = Field(..., gt=0, le=9007199254740991)


class Outcome(StrEnum):
    saved = "saved"
    nothing = "nothing"
    moved_on = "moved_on"


class ApplyDocumentEditsResult(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    version: Version | None
    outcome: Outcome


class AuditAction(StrEnum):
    member_create = "member.create"
    member_password_reset = "member.password_reset"
    member_remove = "member.remove"
    staff_update = "staff.update"
    library_remove = "library.remove"
    library_backlog_run = "library.backlog_run"
    syllabus_import = "syllabus.import"
    syllabus_node_create = "syllabus.node_create"
    syllabus_node_update = "syllabus.node_update"
    exam_import = "exam.import"
    exam_delete = "exam.delete"
    pattern_create = "pattern.create"
    pattern_update = "pattern.update"
    pattern_import = "pattern.import"
    pattern_retire = "pattern.retire"
    center_branding = "center.branding"
    center_ai_policy = "center.ai_policy"
    center_logo_set = "center.logo_set"
    center_logo_remove = "center.logo_remove"
    ai_model_update = "ai.model_update"
    ai_route_set = "ai.route_set"
    ai_route_clear = "ai.route_clear"
    prompt_create = "prompt.create"
    prompt_activate = "prompt.activate"
    budget_set = "budget.set"


class Actor(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    name: str
    email: str


class AuditEntry(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    at: AwareDatetime
    actor: Actor | None
    action: str
    entity_type: str = Field(..., alias="entityType")
    entity_id: str = Field(..., alias="entityId")
    data: dict[str, Any]


class AuditPage(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    entries: list[AuditEntry]
    next_cursor: str | None = Field(..., alias="nextCursor")


class AuditQuery(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    action: str | None = Field(None, pattern="^[a-z_]+(\\.[a-z_]+)?$")
    user_id: UUID | None = Field(None, alias="userId")
    cursor: str | None = None


class BacklogKind(StrEnum):
    ocr = "ocr"
    segment = "segment"
    tag = "tag"


class Status(StrEnum):
    running = "running"
    completed = "completed"
    failed = "failed"


class BacklogRun(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: BacklogKind
    workflow_id: str = Field(..., alias="workflowId")
    status: Status
    started_at: AwareDatetime = Field(..., alias="startedAt")


class Difficulty(RootModel[int]):
    root: int = Field(..., ge=1, le=5)


class CardFieldKey(StrEnum):
    kind = "kind"
    exam = "exam"
    blueprint = "blueprint"
    taxonomy_nodes = "taxonomy_nodes"
    sections = "sections"
    difficulty_mix = "difficulty_mix"
    languages = "languages"
    layout = "layout"
    duration = "duration"
    sourcing = "sourcing"
    student_batch = "student_batch"
    set_codes = "set_codes"
    depth = "depth"
    include_examples = "include_examples"
    include_practice = "include_practice"
    title = "title"


class Organization(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    name: str
    slug: str


class ChatBlock1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["text"]
    text: str


class Purpose(StrEnum):
    scope = "scope"
    shape = "shape"


class ChatBlock4(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["card_response"]
    card_id: str = Field(..., alias="cardId")
    values: dict[str, Any]
    summary: str


class Action(StrEnum):
    confirm_spec = "confirm_spec"
    cancel = "cancel"
    undo = "undo"


class ChatBlock5(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["action"]
    action: Action
    target_id: str | None = Field(..., alias="targetId")
    summary: str


class ChatBlock7(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["progress"]
    run_id: UUID = Field(..., alias="runId")
    stage: str
    done: int = Field(..., ge=0, le=9007199254740991)
    total: int = Field(..., ge=0, le=9007199254740991)


class Level(StrEnum):
    info = "info"
    warning = "warning"


class ChatBlock10(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["notice"]
    level: Level
    text: str


class ChatBlock11(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["error"]
    code: str
    message: str


class ChatEngineEvent1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    event: Literal["text_delta"]
    text: str


class ChatEngineEvent7(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    event: Literal["error"]
    code: str
    message: str


class ChatEngineTurn(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    org_id: UUID = Field(..., alias="orgId")
    user_id: UUID = Field(..., alias="userId")
    session_id: UUID = Field(..., alias="sessionId")
    turn_id: UUID = Field(..., alias="turnId")
    user_message_id: UUID = Field(..., alias="userMessageId")
    model_id: str | None = Field(..., alias="modelId")


class Role(StrEnum):
    user = "user"
    assistant = "assistant"


class ChatScopeNode(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    parent_id: UUID | None = Field(..., alias="parentId")
    level: str
    code: str
    name_en: str = Field(..., alias="nameEn")
    name_hi: str | None = Field(..., alias="nameHi")
    passages: int = Field(..., ge=0, le=9007199254740991)
    questions: int = Field(..., ge=0, le=9007199254740991)


class ChatScopeQuery(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    exam_code: str | None = Field(None, alias="examCode", max_length=80)
    ids: str | None = Field(None, max_length=4000)


class ChatSessionCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    model_id: str | None = Field(..., alias="modelId")


class NextOffset(RootModel[int]):
    root: int = Field(..., ge=0, le=9007199254740991)


class Show(StrEnum):
    active = "active"
    archived = "archived"


class ChatSessionQuery(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    q: str | None = Field(None, max_length=200)
    show: Show
    offset: int = Field(..., ge=0, le=9007199254740991)


class ChatSessionStatus(StrEnum):
    idle = "idle"
    awaiting_input = "awaiting_input"
    generating = "generating"


class ChatSessionSummary(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    title: str
    status: ChatSessionStatus
    pinned: bool
    archived: bool
    document_id: UUID | None = Field(..., alias="documentId")
    model_id: str | None = Field(..., alias="modelId")
    updated_at: AwareDatetime = Field(..., alias="updatedAt")


class ChatSessionUpdate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    title: str | None = Field(None, max_length=120, min_length=1)
    pinned: bool | None = None
    archived: bool | None = None
    model_id: str | None = Field(None, alias="modelId")


class ChatStreamEvent1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    event: Literal["turn_started"]
    turn_id: UUID = Field(..., alias="turnId")
    message_id: UUID = Field(..., alias="messageId")


class ChatStreamEvent2(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    event: Literal["text_delta"]
    text: str


class ChatStreamEvent5(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    event: Literal["message_complete"]
    message_id: UUID = Field(..., alias="messageId")


class ChatStreamEvent6(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    event: Literal["error"]
    code: str
    message: str


class ChatTurnInput1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Literal["text"]
    text: str = Field(..., max_length=8000, min_length=1)


class ChatTurnInput2(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Literal["card_submit"]
    card_id: str = Field(..., alias="cardId")
    values: dict[str, Any]


class ChatTurnInput3(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Literal["action"]
    action: Action
    target_id: str | None = Field(None, alias="targetId")


class ChatTurnInput(RootModel[ChatTurnInput1 | ChatTurnInput2 | ChatTurnInput3]):
    root: ChatTurnInput1 | ChatTurnInput2 | ChatTurnInput3 = Field(
        ..., title="ChatTurnInput"
    )


class ChatTurnRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    client_turn_id: str = Field(..., alias="clientTurnId", max_length=64, min_length=8)
    input: ChatTurnInput
    model_id: str | None = Field(None, alias="modelId")


class ChatTurnStatus(StrEnum):
    pending = "pending"
    streaming = "streaming"
    done = "done"
    failed = "failed"
    cancelled = "cancelled"


class PageStart(RootModel[int]):
    root: int = Field(..., ge=-9007199254740991, le=9007199254740991)


class PageEnd(RootModel[int]):
    root: int = Field(..., ge=-9007199254740991, le=9007199254740991)


class CitationRef(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    chunk_id: UUID = Field(..., alias="chunkId")
    source_id: UUID = Field(..., alias="sourceId")
    filename: str
    page_start: PageStart | None = Field(..., alias="pageStart")
    page_end: PageEnd | None = Field(..., alias="pageEnd")
    page_label: str | None = Field(..., alias="pageLabel")
    quote: str


class CodePath(RootModel[str]):
    root: str = Field(..., pattern="^[a-z0-9_]+(\\/[a-z0-9_]+)*$", title="CodePath")


class ContentLanguage(StrEnum):
    hi = "hi"
    en = "en"
    bilingual = "bilingual"


class CostEstimate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    usd_low: float = Field(..., alias="usdLow", ge=0.0)
    usd_high: float = Field(..., alias="usdHigh", ge=0.0)
    minutes: float = Field(..., ge=0.0)


class NameHi(RootModel[str]):
    root: str = Field(..., max_length=200, min_length=1)


class Alias(RootModel[str]):
    root: str = Field(..., max_length=120, min_length=1)


class Objective(RootModel[str]):
    root: str = Field(..., max_length=500, min_length=1)


class PlatformRole(StrEnum):
    superadmin = "superadmin"


class DashboardSummary(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    sources: int = Field(..., ge=0, le=9007199254740991)
    questions: int = Field(..., ge=0, le=9007199254740991)
    documents: int = Field(..., ge=0, le=9007199254740991)


class DependencyStatus(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: str
    ok: bool
    latency_ms: int = Field(..., alias="latencyMs", ge=0, le=9007199254740991)
    detail: str | None


class DifficultyMix(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    easy: float = Field(..., ge=0.0, le=1.0)
    medium: float = Field(..., ge=0.0, le=1.0)
    hard: float = Field(..., ge=0.0, le=1.0)


class Status1(StrEnum):
    pending = "pending"
    done = "done"
    failed = "failed"


class DocumentListQuery(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    limit: int = Field(..., ge=1, le=100)


class DocumentRestoreRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    base_version: int = Field(..., alias="baseVersion", gt=0, le=9007199254740991)
    version: int = Field(..., gt=0, le=9007199254740991)


class AuthorKind(StrEnum):
    user = "user"
    agent = "agent"
    system = "system"


class DocumentVersionSummary(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    version: int = Field(..., gt=0, le=9007199254740991)
    author_kind: AuthorKind = Field(..., alias="authorKind")
    author_name: str | None = Field(..., alias="authorName")
    changes: list[str]
    created_at: AwareDatetime = Field(..., alias="createdAt")


class DurationMinutes(RootModel[int]):
    root: int = Field(..., gt=0, le=9007199254740991)


class Depth(StrEnum):
    brief = "brief"
    standard = "standard"
    detailed = "detailed"


class EditOp1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    op: Literal["replace_item"]
    slot_id: str = Field(..., alias="slotId")
    question_id: UUID = Field(..., alias="questionId")


class EditOp2(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    op: Literal["delete_items"]
    slot_ids: list[str] = Field(..., alias="slotIds", min_length=1)


class EditOp4(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    op: Literal["reorder"]
    slot_ids: list[str] = Field(..., alias="slotIds", min_length=1)


class EditOp5(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    op: Literal["set_marks"]
    slot_id: str = Field(..., alias="slotId")
    marks: float = Field(..., gt=0.0)


class EditOp7(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    op: Literal["set_title"]
    title: str = Field(..., min_length=1)


class EditOp10(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    op: Literal["delete_sections"]
    node_ids: list[UUID] = Field(..., alias="nodeIds", min_length=1)


class Effort(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"
    xhigh = "xhigh"
    max = "max"


class Syllabu(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    node_id: UUID = Field(..., alias="nodeId")
    path: str
    name_en: str = Field(..., alias="nameEn")
    name_hi: str | None = Field(..., alias="nameHi")
    weightage: float | None


class Syllabu1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    node: CodePath
    weightage: float | None = Field(None, ge=0.0, le=1.0)


class ExportDocumentInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    v: Literal[1]
    org_id: UUID = Field(..., alias="orgId")
    requested_by: UUID | None = Field(..., alias="requestedBy")
    export_id: UUID = Field(..., alias="exportId")


class ExportFormat(StrEnum):
    pdf = "pdf"
    docx = "docx"
    krutidev_docx = "krutidev_docx"


class SetCode(RootModel[str]):
    root: str = Field(None, pattern="^[A-Z]$")


class ExportVariant(StrEnum):
    paper = "paper"
    answer_key = "answer_key"
    solutions = "solutions"


class FinishExportInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    v: Literal[1]
    org_id: UUID = Field(..., alias="orgId")
    export_id: UUID = Field(..., alias="exportId")
    s3_key: str | None = Field(..., alias="s3Key")
    error: str | None


class GenerateDocumentInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    v: Literal[1]
    org_id: UUID = Field(..., alias="orgId")
    requested_by: UUID | None = Field(..., alias="requestedBy")
    document_id: UUID = Field(..., alias="documentId")
    run_id: UUID = Field(..., alias="runId")
    session_id: UUID | None = Field(..., alias="sessionId")
    model_id: str | None = Field(..., alias="modelId")


class Outcome1(RootModel[int]):
    root: int = Field(..., ge=0, le=9007199254740991)


class GenerateDocumentResult(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    document_id: UUID = Field(..., alias="documentId")
    version: int = Field(..., gt=0, le=9007199254740991)
    outcome: dict[str, Outcome1]
    cost_usd: float = Field(..., alias="costUsd", ge=0.0)


class Status2(StrEnum):
    planning = "planning"
    running = "running"
    done = "done"
    failed = "failed"
    cancelled = "cancelled"


class GenerationProgress(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    run_id: UUID = Field(..., alias="runId")
    document_id: UUID = Field(..., alias="documentId")
    status: Status2
    done: int = Field(..., ge=0, le=9007199254740991)
    total: int = Field(..., ge=0, le=9007199254740991)


class GenerationStatus(StrEnum):
    planning = "planning"
    running = "running"
    done = "done"
    failed = "failed"
    cancelled = "cancelled"


class GlossaryTermImport(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    en: str = Field(..., min_length=1)
    hi: str = Field(..., min_length=1)
    subject: str = Field(..., pattern="^[a-z0-9]+(_[a-z0-9]+)*$")


class ImportSummary(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    created: int = Field(..., ge=0, le=9007199254740991)
    updated: int = Field(..., ge=0, le=9007199254740991)
    unchanged: int = Field(..., ge=0, le=9007199254740991)


class IndexSourceInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    v: Literal[1]
    org_id: UUID = Field(..., alias="orgId")
    requested_by: UUID | None = Field(..., alias="requestedBy")
    source_id: UUID = Field(..., alias="sourceId")


class IndexSourceResult(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    source_id: UUID = Field(..., alias="sourceId")
    embedded_chunks: int = Field(..., alias="embeddedChunks", ge=0, le=9007199254740991)
    indexed_chunks: int = Field(..., alias="indexedChunks", ge=0, le=9007199254740991)


class Stages(StrEnum):
    all = "all"
    structure = "structure"


class IngestSourceInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    v: Literal[1]
    org_id: UUID = Field(..., alias="orgId")
    requested_by: UUID | None = Field(..., alias="requestedBy")
    source_id: UUID = Field(..., alias="sourceId")
    stages: Stages


class IngestSourceResult(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    source_id: UUID = Field(..., alias="sourceId")
    pages: int = Field(..., ge=0, le=9007199254740991)
    text_pages: int = Field(..., alias="textPages", ge=0, le=9007199254740991)
    legacy_font_pages: int = Field(
        ..., alias="legacyFontPages", ge=0, le=9007199254740991
    )
    ocr_pages: int = Field(..., alias="ocrPages", ge=0, le=9007199254740991)
    sections: int = Field(..., ge=0, le=9007199254740991)
    chunks: int = Field(..., ge=0, le=9007199254740991)
    tagged_chunks: int = Field(..., alias="taggedChunks", ge=0, le=9007199254740991)
    embedded_chunks: int = Field(..., alias="embeddedChunks", ge=0, le=9007199254740991)
    indexed_chunks: int = Field(..., alias="indexedChunks", ge=0, le=9007199254740991)


class Language(StrEnum):
    hi = "hi"
    en = "en"


class LibraryFilter(StrEnum):
    all = "all"
    ready = "ready"
    in_progress = "in_progress"
    needs_ocr = "needs_ocr"
    failed = "failed"


class LibraryQuery(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    show: LibraryFilter
    search: str | None = Field(None, max_length=200)
    page: int = Field(..., ge=1, le=9007199254740991)


class Pages(RootModel[int]):
    root: int = Field(..., ge=0, le=9007199254740991)


class PageNo(RootModel[int]):
    root: int = Field(..., gt=0, le=9007199254740991)


class Confidence(RootModel[float]):
    root: float = Field(..., ge=0.0, le=1.0)


class LibrarySummary(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    files: int = Field(..., ge=0, le=9007199254740991)
    sections: int = Field(..., ge=0, le=9007199254740991)
    ocr_pages: int = Field(..., alias="ocrPages", ge=0, le=9007199254740991)
    failed: int = Field(..., ge=0, le=9007199254740991)
    in_progress: int = Field(..., alias="inProgress", ge=0, le=9007199254740991)


class Licence(StrEnum):
    own = "own"
    third_party = "third_party"
    pyq = "pyq"


class Liveness(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    ok: bool


class LlmBatchInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    v: Literal[1]
    org_id: UUID = Field(..., alias="orgId")
    requested_by: UUID | None = Field(..., alias="requestedBy")
    batch_id: UUID = Field(..., alias="batchId")


class LlmBatchResult(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    batch_id: UUID = Field(..., alias="batchId")
    succeeded: int = Field(..., ge=0, le=9007199254740991)
    failed: int = Field(..., ge=0, le=9007199254740991)
    cost_usd: float = Field(..., alias="costUsd", ge=0.0)


class LlmProvider(StrEnum):
    anthropic = "anthropic"
    openai = "openai"
    stub = "stub"


class LlmTask(StrEnum):
    ocr_text = "ocr_text"
    ocr_math = "ocr_math"
    segment = "segment"
    tag = "tag"
    context_header = "context_header"
    query_understanding = "query_understanding"
    spec = "spec"
    chat_title = "chat_title"
    chat_qa = "chat_qa"
    generate = "generate"
    notes_write = "notes_write"
    edit_agent = "edit_agent"
    verify_grounding = "verify_grounding"
    verify_solve = "verify_solve"
    lint = "lint"
    bilingual_check = "bilingual_check"


class LocalizedText(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    en: str | None = None
    hi: str | None = None


class ManifestSection(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    pages: str = Field(..., pattern="^\\d+(-\\d+)?$")
    chapter: CodePath
    title: str | None = None


class UiLocale(StrEnum):
    en = "en"
    hi = "hi"


class MemberSettings(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    ui_locale: UiLocale = Field(..., alias="uiLocale")
    content_language: ContentLanguage = Field(..., alias="contentLanguage")
    default_model_id: str | None = Field(..., alias="defaultModelId")
    default_exam_id: UUID | None = Field(..., alias="defaultExamId")


class Exam(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    code: str
    name_en: str = Field(..., alias="nameEn")
    name_hi: str | None = Field(..., alias="nameHi")


class BudgetUsd(RootModel[float]):
    root: float = Field(..., ge=0.0)


class MyUsage(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    month: str = Field(..., pattern="^\\d{4}-(0[1-9]|1[0-2])$")
    calls: int = Field(..., ge=0, le=9007199254740991)
    cost_usd: float = Field(..., alias="costUsd", ge=0.0)
    budget_usd: BudgetUsd | None = Field(..., alias="budgetUsd")
    center_exhausted: bool = Field(..., alias="centerExhausted")


class NotesSectionState(StrEnum):
    pending = "pending"
    written = "written"
    verified = "verified"
    flagged = "flagged"
    insufficient_evidence = "insufficient_evidence"
    edited = "edited"


class Kind(StrEnum):
    notes = "notes"
    revision_sheet = "revision_sheet"


class NotesSpec(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Kind
    title: str = Field(..., min_length=1)
    exam_code: str | None = Field(..., alias="examCode")
    taxonomy_node_ids: list[UUID] = Field(..., alias="taxonomyNodeIds", min_length=1)
    languages: list[Language] = Field(..., min_length=1)
    depth: Depth
    include_examples: bool = Field(..., alias="includeExamples")
    include_practice: bool = Field(..., alias="includePractice")


class OcrPage(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    markdown: str
    has_figures: bool = Field(..., alias="hasFigures")
    legibility: float = Field(..., ge=0.0, le=1.0)


class OrgBranding(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: LocalizedText
    logo_key: str | None = Field(..., alias="logoKey")
    header_lines: LocalizedText | None = Field(..., alias="headerLines")
    footer: LocalizedText | None
    default_instructions: LocalizedText | None = Field(..., alias="defaultInstructions")


class OrgRole(StrEnum):
    admin = "admin"
    reviewer = "reviewer"
    teacher = "teacher"
    content_operator = "content_operator"


class PageReadingState(StrEnum):
    text = "text"
    converted = "converted"
    waiting_for_ocr = "waiting_for_ocr"
    blank = "blank"


class Section(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: LocalizedText
    instructions: LocalizedText | None
    slot_ids: list[str] = Field(..., alias="slotIds")


class PaperLayout(StrEnum):
    hindi_then_english = "hindi_then_english"
    side_by_side = "side_by_side"
    single_language = "single_language"


class AttemptAny(RootModel[int]):
    root: int = Field(None, gt=0, le=9007199254740991)


class ScopeItem(RootModel[str]):
    root: str = Field(..., pattern="^[a-z0-9_]+(\\/[a-z0-9_]+)*$")


class PaperSet(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    code: str = Field(..., pattern="^[A-Z]$")
    slot_order: list[str] = Field(..., alias="slotOrder")
    option_order: dict[str, list[str]] = Field(..., alias="optionOrder")


class Kind1(StrEnum):
    question_paper = "question_paper"
    worksheet = "worksheet"


class SetCode1(RootModel[str]):
    root: str = Field(..., pattern="^[A-Z]$")


class PingInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    v: Literal[1]
    org_id: UUID = Field(..., alias="orgId")
    requested_by: UUID | None = Field(..., alias="requestedBy")
    message: str


class PingResult(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    echo: str
    org_id: UUID = Field(..., alias="orgId")


class ProgressEvent1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["stage"]
    stage: str
    done: int = Field(..., ge=-9007199254740991, le=9007199254740991)
    total: int = Field(..., ge=-9007199254740991, le=9007199254740991)


class ProgressEvent2(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["item_ready"]
    item_id: str = Field(..., alias="itemId")
    question_id: UUID = Field(..., alias="questionId")


class ProgressEvent3(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["item_verified"]
    item_id: str = Field(..., alias="itemId")
    check: str
    passed: bool
    detail: str | None


class ProgressEvent4(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["error"]
    message: str
    retryable: bool


class ProgressEvent5(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["done"]


class ProgressEvent(
    RootModel[
        ProgressEvent1
        | ProgressEvent2
        | ProgressEvent3
        | ProgressEvent4
        | ProgressEvent5
    ]
):
    root: (
        ProgressEvent1
        | ProgressEvent2
        | ProgressEvent3
        | ProgressEvent4
        | ProgressEvent5
    ) = Field(..., title="ProgressEvent")


class PromptFamily(StrEnum):
    claude = "claude"
    gpt = "gpt"
    any = "any"


class Source(StrEnum):
    package = "package"
    admin = "admin"


class PromptVersion(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    name: LlmTask
    model_family: PromptFamily = Field(..., alias="modelFamily")
    version: int = Field(..., gt=0, le=9007199254740991)
    body: str
    is_active: bool = Field(..., alias="isActive")
    source: Source
    created_by_name: str | None = Field(..., alias="createdByName")
    created_at: AwareDatetime = Field(..., alias="createdAt")


class Provider(StrEnum):
    anthropic = "anthropic"
    openai = "openai"


class ProviderStatus(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    provider: Provider
    configured: bool
    endpoint: str | None


class Marks(RootModel[float]):
    root: float = Field(..., gt=0.0)


class NegativeMarks(RootModel[float]):
    root: float = Field(..., ge=0.0)


class QuestionOption(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    key: str = Field(..., max_length=4, min_length=1)
    text: str


class QuestionOrigin(StrEnum):
    imported = "imported"
    generated = "generated"
    pool = "pool"
    teacher = "teacher"


class QuestionStatus(StrEnum):
    draft = "draft"
    verified = "verified"
    flagged = "flagged"
    approved = "approved"
    published = "published"
    retired = "retired"


class QuestionText(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    stem: str = Field(..., min_length=1)
    options: list[QuestionOption]
    solution: str | None


class QuestionType(StrEnum):
    mcq_single = "mcq_single"
    mcq_multi = "mcq_multi"
    numerical = "numerical"
    integer = "integer"
    assertion_reason = "assertion_reason"
    match_columns = "match_columns"
    statement = "statement"
    passage = "passage"
    short_answer = "short_answer"
    long_answer = "long_answer"


class RenderActivity(StrEnum):
    render_export = "render_export"


class RenderExportInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    v: Literal[1]
    org_id: UUID = Field(..., alias="orgId")
    export_id: UUID = Field(..., alias="exportId")


class RenderExportResult(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    s3_key: str = Field(..., alias="s3Key")
    bytes: int = Field(..., ge=0, le=9007199254740991)


class RewriteRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    item_id: str = Field(..., alias="itemId")
    instruction: str = Field(..., max_length=500, min_length=1)
    difficulty: Difficulty | None


class Limit(RootModel[int]):
    root: int = Field(..., gt=0, le=9007199254740991)


class RunBacklogInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    v: Literal[1]
    org_id: UUID = Field(..., alias="orgId")
    requested_by: UUID | None = Field(..., alias="requestedBy")
    kind: BacklogKind
    limit: Limit | None


class Limit1(RootModel[int]):
    root: int = Field(..., gt=0, le=100000)


class RunBacklogRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    limit: Limit1 | None


class RunBacklogResult(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: BacklogKind
    items: int = Field(..., ge=0, le=9007199254740991)
    batches: list[UUID]
    succeeded: int = Field(..., ge=0, le=9007199254740991)
    failed: int = Field(..., ge=0, le=9007199254740991)
    cost_usd: float = Field(..., alias="costUsd", ge=0.0)


class SaveDocumentVersionInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    v: Literal[1]
    org_id: UUID = Field(..., alias="orgId")
    document_id: UUID = Field(..., alias="documentId")
    base_version: int = Field(..., alias="baseVersion", ge=0, le=9007199254740991)
    content: dict[str, Any]
    ops: list[Any]
    author_kind: AuthorKind = Field(..., alias="authorKind")
    author_id: UUID | None = Field(..., alias="authorId")
    chat_message_id: UUID | None = Field(..., alias="chatMessageId")


class SaveDocumentVersionResult(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    version: int = Field(..., gt=0, le=9007199254740991)
    created: bool


class SegmentedQuestion(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    number: int = Field(..., gt=0, le=9007199254740991)
    qtype: QuestionType
    hi: QuestionText | None
    en: QuestionText | None
    page: int = Field(..., gt=0, le=9007199254740991)
    has_figure: bool = Field(..., alias="hasFigure")


class Provider1(StrEnum):
    anthropic = "anthropic"
    openai = "openai"
    stub = "stub"


class SelectableModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    display_name: str = Field(..., alias="displayName")
    provider: Provider1


class Service(StrEnum):
    api = "api"
    ai = "ai"
    render = "render"


class ServiceHealth(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    service: Service
    version: str
    ok: bool
    dependencies: list[DependencyStatus]


class MonthlyLimitUsd(RootModel[float]):
    root: float = Field(..., ge=0.0, le=1000000.0)


class SetCenterBudgetRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    monthly_limit_usd: MonthlyLimitUsd | None = Field(..., alias="monthlyLimitUsd")
    soft_limit_pct: int = Field(..., alias="softLimitPct", ge=1, le=100)


class SetMemberPasswordRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    password: str = Field(..., max_length=128, min_length=10)


class FallbackModelId(RootModel[str]):
    root: str = Field(..., min_length=1)


class SetTaskRouteRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    model_id: str = Field(..., alias="modelId", min_length=1)
    effort: Effort | None
    max_tokens: int = Field(..., alias="maxTokens", ge=256, le=200000)
    fallback_model_id: FallbackModelId | None = Field(..., alias="fallbackModelId")


class SlotState(StrEnum):
    pending = "pending"
    bank = "bank"
    generated = "generated"
    verified = "verified"
    flagged = "flagged"
    insufficient_evidence = "insufficient_evidence"
    edited = "edited"


class SourceKind(StrEnum):
    book = "book"
    notes = "notes"
    question_paper = "question_paper"
    answer_key = "answer_key"
    booklet = "booklet"
    video = "video"
    image = "image"
    other = "other"


class SourceLanguage(StrEnum):
    hi = "hi"
    en = "en"
    mixed = "mixed"


class Language1(StrEnum):
    hi = "hi"
    en = "en"
    bilingual = "bilingual"


class Exam1(RootModel[str]):
    root: str = Field(..., min_length=1)


class AnswerKeyStatus(StrEnum):
    provisional = "provisional"
    final = "final"


class FontHint(StrEnum):
    unicode = "unicode"
    krutidev = "krutidev"
    chanakya = "chanakya"
    other = "other"


class SourceManifestRow(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    file: str = Field(..., min_length=1)
    kind: SourceKind
    licence: Licence
    subject: str = Field(..., min_length=1)
    language: Language1
    exams: list[Exam1] = Field(..., min_length=1)
    title: str | None = None
    class_level: str | None = Field(None, alias="classLevel")
    paper_code: str | None = Field(None, alias="paperCode")
    year: int | None = Field(None, ge=1950, le=2100)
    set_code: str | None = Field(None, alias="setCode", pattern="^[A-Z]$")
    date_shift: str | None = Field(None, alias="dateShift")
    answer_key_for: str | None = Field(None, alias="answerKeyFor")
    answer_key_status: AnswerKeyStatus | None = Field(None, alias="answerKeyStatus")
    chapter: CodePath | None = None
    sections: list[ManifestSection] | None = None
    parallel_of: str | None = Field(None, alias="parallelOf")
    page_offset: int | None = Field(
        None, alias="pageOffset", ge=-9007199254740991, le=9007199254740991
    )
    font_hint: FontHint | None = Field(None, alias="fontHint")
    author: str | None = None
    edition: str | None = None
    tags: list[str] | None = None


class SourceState(StrEnum):
    queued = "queued"
    reading = "reading"
    ready = "ready"
    waiting_for_ocr = "waiting_for_ocr"
    failed = "failed"


class Sourcing(StrEnum):
    bank_first = "bank_first"
    fresh_only = "fresh_only"
    bank_only = "bank_only"


class StaffSubject(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    node_id: UUID = Field(..., alias="nodeId")
    code: str
    name_en: str = Field(..., alias="nameEn")
    name_hi: str | None = Field(..., alias="nameHi")
    is_head: bool = Field(..., alias="isHead")


class SubjectCoverage(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    node_id: UUID = Field(..., alias="nodeId")
    name: LocalizedText
    chapters: int = Field(..., ge=0, le=9007199254740991)
    chapters_with_material: int = Field(
        ..., alias="chaptersWithMaterial", ge=0, le=9007199254740991
    )
    passages: int = Field(..., ge=0, le=9007199254740991)
    questions: int = Field(..., ge=0, le=9007199254740991)


class SubjectRef(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    node_id: UUID = Field(..., alias="nodeId")
    code: str
    name_en: str = Field(..., alias="nameEn")
    name_hi: str | None = Field(..., alias="nameHi")


class SyllabusLevel(StrEnum):
    subject = "subject"
    unit = "unit"
    chapter = "chapter"
    topic = "topic"
    subtopic = "subtopic"


class SyllabusNode(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    parent_id: UUID | None = Field(..., alias="parentId")
    code: str
    path: str
    level: SyllabusLevel
    name_en: str = Field(..., alias="nameEn")
    name_hi: str | None = Field(..., alias="nameHi")
    aliases: list[str]
    objectives: list[str]
    is_active: bool = Field(..., alias="isActive")
    sort_order: int = Field(
        ..., alias="sortOrder", ge=-9007199254740991, le=9007199254740991
    )


class NameHi1(RootModel[str]):
    root: str = Field(..., min_length=1)


class Alias1(RootModel[str]):
    root: str = Field(..., min_length=1)


class Objective1(RootModel[str]):
    root: str = Field(..., min_length=1)


class SyllabusNodeImport(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    code: str = Field(..., pattern="^[a-z0-9]+(_[a-z0-9]+)*$")
    level: SyllabusLevel
    name_en: str = Field(..., alias="nameEn", min_length=1)
    name_hi: NameHi1 | None = Field(..., alias="nameHi")
    aliases: list[Alias1]
    objectives: list[Objective1]
    children: list[SyllabusNodeImport]


class Subject(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    parent_id: UUID | None = Field(..., alias="parentId")
    code: str
    path: str
    level: SyllabusLevel
    name_en: str = Field(..., alias="nameEn")
    name_hi: str | None = Field(..., alias="nameHi")
    aliases: list[str]
    objectives: list[str]
    is_active: bool = Field(..., alias="isActive")
    sort_order: int = Field(
        ..., alias="sortOrder", ge=-9007199254740991, le=9007199254740991
    )
    descendants: int = Field(..., ge=0, le=9007199254740991)


class SyllabusOverview(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    subjects: list[Subject]


class SyllabusSubject(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    subject: SyllabusNode
    nodes: list[SyllabusNode]


class SystemStatus(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    ok: bool
    services: list[ServiceHealth]


class TaskKind(StrEnum):
    question_paper = "question_paper"
    worksheet = "worksheet"
    notes = "notes"
    revision_sheet = "revision_sheet"


class TaskQueue(StrEnum):
    ai = "ai"
    ai_cpu = "ai-cpu"
    ai_llm = "ai-llm"
    render = "render"
    api = "api"


class MaxTokens(RootModel[int]):
    root: int = Field(..., gt=0, le=9007199254740991)


class Source1(StrEnum):
    default = "default"
    center = "center"
    none = "none"


class TaskRoute(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    task: LlmTask
    model_id: str | None = Field(..., alias="modelId")
    effort: Effort | None
    max_tokens: MaxTokens | None = Field(..., alias="maxTokens")
    fallback_model_id: str | None = Field(..., alias="fallbackModelId")
    source: Source1


class TopicAvailability(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    node_id: UUID = Field(..., alias="nodeId")
    name: str
    from_bank: int = Field(..., alias="fromBank", ge=0, le=9007199254740991)
    to_generate: int = Field(..., alias="toGenerate", ge=0, le=9007199254740991)


class TopicTag(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    node: CodePath
    confidence: float = Field(..., ge=0.0, le=1.0)


class TopicTags(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    tags: list[TopicTag]


class UpdateAiModelRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    enabled: bool
    teacher_selectable: bool = Field(..., alias="teacherSelectable")


class UpdateBrandingRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: LocalizedText
    header_lines: LocalizedText | None = Field(..., alias="headerLines")
    footer: LocalizedText | None
    default_instructions: LocalizedText | None = Field(..., alias="defaultInstructions")


class UpdateGenerationRunInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    v: Literal[1]
    org_id: UUID = Field(..., alias="orgId")
    run_id: UUID = Field(..., alias="runId")
    status: GenerationStatus | None = None
    slot_plan: list[Any] | None = Field(None, alias="slotPlan")
    slot_states: dict[str, Any] | None = Field(None, alias="slotStates")
    actual_cost_usd: float | None = Field(None, alias="actualCostUsd", ge=0.0)
    error: str | None = None


class UpdateGenerationRunResult(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    status: GenerationStatus


class UpdateProfileRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: str = Field(..., max_length=120, min_length=1)


class Subject1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    node_id: UUID = Field(..., alias="nodeId")
    is_head: bool = Field(..., alias="isHead")


class MonthlyBudgetUsd(RootModel[float]):
    root: float = Field(..., ge=0.0, le=100000.0)


class UpdateStaffMemberRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    role: OrgRole
    subjects: list[Subject1] = Field(..., max_length=30)
    monthly_budget_usd: MonthlyBudgetUsd | None = Field(..., alias="monthlyBudgetUsd")


class NameHi2(RootModel[str]):
    root: str = Field(..., max_length=200, min_length=1)


class Alias2(RootModel[str]):
    root: str = Field(..., max_length=120, min_length=1)


class Objective2(RootModel[str]):
    root: str = Field(..., max_length=500, min_length=1)


class UpdateSyllabusNodeRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name_en: str = Field(..., alias="nameEn", max_length=200, min_length=1)
    name_hi: NameHi2 | None = Field(..., alias="nameHi")
    aliases: list[Alias2] = Field(..., max_length=50)
    objectives: list[Objective2] = Field(..., max_length=30)
    is_active: bool = Field(..., alias="isActive")


class UsageQuery(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    month: str | None = Field(None, pattern="^\\d{4}-(0[1-9]|1[0-2])$")


class Totals(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    calls: int = Field(..., ge=0, le=9007199254740991)
    cost_usd: float = Field(..., alias="costUsd", ge=0.0)
    input_tokens: int = Field(..., alias="inputTokens", ge=0, le=9007199254740991)
    output_tokens: int = Field(..., alias="outputTokens", ge=0, le=9007199254740991)
    cache_read_tokens: int = Field(
        ..., alias="cacheReadTokens", ge=0, le=9007199254740991
    )
    batch_calls: int = Field(..., alias="batchCalls", ge=0, le=9007199254740991)


class Budget(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    monthly_limit_usd: float | None = Field(..., alias="monthlyLimitUsd")
    soft_limit_pct: int = Field(
        ..., alias="softLimitPct", ge=-9007199254740991, le=9007199254740991
    )


class ByTeacherItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    calls: int = Field(..., ge=0, le=9007199254740991)
    cost_usd: float = Field(..., alias="costUsd", ge=0.0)
    user_id: UUID | None = Field(..., alias="userId")
    name: str | None
    monthly_budget_usd: float | None = Field(..., alias="monthlyBudgetUsd")


class ByTaskItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    calls: int = Field(..., ge=0, le=9007199254740991)
    cost_usd: float = Field(..., alias="costUsd", ge=0.0)
    task: str


class ByModelItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    calls: int = Field(..., ge=0, le=9007199254740991)
    cost_usd: float = Field(..., alias="costUsd", ge=0.0)
    model_id: str = Field(..., alias="modelId")


class ByDayItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    calls: int = Field(..., ge=0, le=9007199254740991)
    cost_usd: float = Field(..., alias="costUsd", ge=0.0)
    date: date_aliased


class UsageReport(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    month: str = Field(..., pattern="^\\d{4}-(0[1-9]|1[0-2])$")
    totals: Totals
    budget: Budget
    by_teacher: list[ByTeacherItem] = Field(..., alias="byTeacher")
    by_task: list[ByTaskItem] = Field(..., alias="byTask")
    by_model: list[ByModelItem] = Field(..., alias="byModel")
    by_day: list[ByDayItem] = Field(..., alias="byDay")


class WorkflowEnvelope(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    v: Literal[1]
    org_id: UUID = Field(..., alias="orgId")
    requested_by: UUID | None = Field(..., alias="requestedBy")


class WorkflowType(StrEnum):
    ping = "Ping"
    ingest_source = "IngestSource"
    llm_batch = "LlmBatch"
    run_backlog = "RunBacklog"
    index_source = "IndexSource"
    generate_paper = "GeneratePaper"
    generate_notes = "GenerateNotes"
    edit_document = "EditDocument"
    export_document = "ExportDocument"


class AddMemberRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: str = Field(..., max_length=120, min_length=1)
    email: EmailStr = Field(
        ...,
        pattern="^(?:[A-Za-z0-9_'+\\-]+\\.)*[A-Za-z0-9_'+\\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$",
    )
    role: OrgRole
    password: str = Field(..., max_length=128, min_length=10)


class AiEngineStatus(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    providers: list[ProviderStatus]
    stub_active: bool = Field(..., alias="stubActive")


class AiModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    provider: LlmProvider
    api_model: str = Field(..., alias="apiModel")
    display_name: str = Field(..., alias="displayName")
    context_window: int = Field(
        ..., alias="contextWindow", ge=-9007199254740991, le=9007199254740991
    )
    max_output_tokens: int = Field(
        ..., alias="maxOutputTokens", ge=-9007199254740991, le=9007199254740991
    )
    prices: dict[str, float]
    enabled: bool
    teacher_selectable: bool = Field(..., alias="teacherSelectable")


class AiOverview(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    models: list[AiModel]
    routes: list[TaskRoute]
    engine: AiEngineStatus | None
    can_edit_models: bool = Field(..., alias="canEditModels")


class AiPolicy(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    allowed_model_ids: list[str] = Field(..., alias="allowedModelIds")
    require_cross_provider_check: bool = Field(..., alias="requireCrossProviderCheck")
    default_sourcing: Sourcing = Field(..., alias="defaultSourcing")


class BacklogEstimate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: BacklogKind
    items: int = Field(..., ge=0, le=9007199254740991)
    requests: int = Field(..., ge=0, le=9007199254740991)
    model_id: str | None = Field(..., alias="modelId")
    provider: LlmProvider | None
    cost_usd: float = Field(..., alias="costUsd", ge=0.0)
    blocked: str | None


class BacklogEstimates(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    backlogs: list[BacklogEstimate]


class BacklogOverview(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    backlogs: list[BacklogEstimate]
    runs: list[BacklogRun]
    reachable: bool


class CardField(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    key: CardFieldKey
    required: bool
    suggested: Any | None = None
    options: list[str] | None = None


class CenterProfile(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    organization: Organization
    branding: OrgBranding
    logo_url: str | None = Field(..., alias="logoUrl")
    ai_policy: AiPolicy = Field(..., alias="aiPolicy")
    selectable_models: list[SelectableModel] = Field(..., alias="selectableModels")


class ChatBlock2(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["citations"]
    items: list[CitationRef]


class ChatBlock3(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["clarification"]
    card_id: str = Field(..., alias="cardId")
    purpose: Purpose
    fields: list[CardField] = Field(..., min_length=1)


class ChatBlock8(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["document_ref"]
    document_id: UUID = Field(..., alias="documentId")
    title: str
    kind: TaskKind
    version: int = Field(..., ge=0, le=9007199254740991)


class ChatEngineEvent5(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    event: Literal["document_rewrite"]
    document_id: UUID = Field(..., alias="documentId")
    requests: list[RewriteRequest] = Field(..., max_length=50, min_length=1)
    summary: str


class ChatScope(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    nodes: list[ChatScopeNode]


class ChatSessionPage(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    items: list[ChatSessionSummary]
    next_offset: NextOffset | None = Field(..., alias="nextOffset")


class ChatTurnAccepted(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    turn_id: UUID = Field(..., alias="turnId")
    user_message_id: UUID = Field(..., alias="userMessageId")
    assistant_message_id: UUID = Field(..., alias="assistantMessageId")
    status: ChatTurnStatus


class CoverageReport(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    subjects: list[SubjectCoverage]


class CreatePromptVersionRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: LlmTask
    model_family: PromptFamily = Field(..., alias="modelFamily")
    body: str = Field(..., max_length=60000, min_length=20)


class CreateSyllabusNodeRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name_en: str = Field(..., alias="nameEn", max_length=200, min_length=1)
    name_hi: NameHi | None = Field(..., alias="nameHi")
    aliases: list[Alias] = Field(..., max_length=50)
    objectives: list[Objective] = Field(..., max_length=30)
    parent_id: UUID | None = Field(..., alias="parentId")
    code: str = Field(..., pattern="^[a-z0-9]+(_[a-z0-9]+)*$")
    level: SyllabusLevel


class CurrentUser(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    name: str
    email: EmailStr = Field(
        ...,
        pattern="^(?:[A-Za-z0-9_'+\\-]+\\.)*[A-Za-z0-9_'+\\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$",
    )
    platform_role: PlatformRole | None = Field(..., alias="platformRole")
    organization: Organization | None
    org_role: OrgRole | None = Field(..., alias="orgRole")


class DocumentExport(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    version: int = Field(..., gt=0, le=9007199254740991)
    format: ExportFormat
    variant: ExportVariant
    set_code: str | None = Field(..., alias="setCode")
    status: Status1
    error: str | None
    filename: str
    created_at: AwareDatetime = Field(..., alias="createdAt")


class DocumentListItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    kind: TaskKind
    title: str
    current_version: int = Field(..., alias="currentVersion", ge=0, le=9007199254740991)
    updated_at: AwareDatetime = Field(..., alias="updatedAt")
    chat_id: UUID | None = Field(..., alias="chatId")


class DocumentSummary(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    kind: TaskKind
    title: str
    current_version: int = Field(..., alias="currentVersion", ge=0, le=9007199254740991)
    updated_at: AwareDatetime = Field(..., alias="updatedAt")


class EditDocumentInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    v: Literal[1]
    org_id: UUID = Field(..., alias="orgId")
    requested_by: UUID | None = Field(..., alias="requestedBy")
    document_id: UUID = Field(..., alias="documentId")
    run_id: UUID = Field(..., alias="runId")
    session_id: UUID | None = Field(..., alias="sessionId")
    model_id: str | None = Field(..., alias="modelId")
    base_version: int = Field(..., alias="baseVersion", gt=0, le=9007199254740991)
    requests: list[RewriteRequest] = Field(..., min_length=1)
    summary: str


class EditOp6(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    op: Literal["set_instructions"]
    section_index: int = Field(..., alias="sectionIndex", ge=0, le=9007199254740991)
    instructions: LocalizedText


class EditOp9(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    op: Literal["edit_section"]
    node_id: UUID = Field(..., alias="nodeId")
    body: LocalizedText


class ExamPaper(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    code: str = Field(..., pattern="^[a-z0-9]+(_[a-z0-9]+)*$")
    family: str = Field(..., pattern="^[a-z0-9]+(_[a-z0-9]+)*$")
    paper_code: str | None = Field(..., alias="paperCode")
    name_en: str = Field(..., alias="nameEn", min_length=1)
    name_hi: str | None = Field(..., alias="nameHi")
    authoritative_language: Language = Field(..., alias="authoritativeLanguage")
    id: UUID
    syllabus: list[Syllabu]


class ExamPaperImport(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    code: str = Field(..., pattern="^[a-z0-9]+(_[a-z0-9]+)*$")
    family: str = Field(..., pattern="^[a-z0-9]+(_[a-z0-9]+)*$")
    paper_code: str | None = Field(..., alias="paperCode")
    name_en: str = Field(..., alias="nameEn", min_length=1)
    name_hi: str | None = Field(..., alias="nameHi")
    authoritative_language: Language = Field(..., alias="authoritativeLanguage")
    syllabus: list[Syllabu1] = Field(..., min_length=1)


class ExportRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    format: ExportFormat
    variant: ExportVariant
    set_code: SetCode | None = Field(..., alias="setCode")


class ImportExamPapersRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    exams: list[ExamPaperImport] = Field(..., max_length=200, min_length=1)


class LibrarySource(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    filename: str
    kind: SourceKind
    licence: Licence
    language: SourceLanguage | None
    state: SourceState
    pages: Pages | None
    sections: int = Field(..., ge=0, le=9007199254740991)
    ocr_pages: int = Field(..., alias="ocrPages", ge=0, le=9007199254740991)
    meta: dict[str, str]
    error: str | None
    added_at: AwareDatetime = Field(..., alias="addedAt")


class PageReading(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    page_no: PageNo | None = Field(..., alias="pageNo")
    state: PageReadingState
    confidence: Confidence | None
    note: str | None


class SectionPreviewItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    text: str
    page_start: PageStart | None = Field(..., alias="pageStart")
    page_end: PageEnd | None = Field(..., alias="pageEnd")
    language: SourceLanguage


class LibrarySourceDetail(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    source: LibrarySource
    page_readings: list[PageReading] = Field(..., alias="pageReadings")
    section_preview: list[SectionPreviewItem] = Field(..., alias="sectionPreview")


class MySettings(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    settings: MemberSettings
    models: list[SelectableModel]
    exams: list[Exam]
    subjects: list[StaffSubject]


class NotesSection(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    node_id: UUID = Field(..., alias="nodeId")
    title: LocalizedText
    body: LocalizedText
    citations: list[CitationRef]
    state: NotesSectionState
    flags: list[str]


class PaperSection(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: LocalizedText
    qtype: QuestionType
    count: int = Field(..., gt=0, le=9007199254740991)
    marks_each: float = Field(..., alias="marksEach", gt=0.0)
    negative_marks: float = Field(..., alias="negativeMarks", ge=0.0)
    attempt_any: AttemptAny | None = Field(..., alias="attemptAny")
    difficulty_mix: DifficultyMix = Field(..., alias="difficultyMix")
    scope: list[ScopeItem]


class PaperSlot(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    slot_id: str = Field(..., alias="slotId")
    section_index: int = Field(..., alias="sectionIndex", ge=0, le=9007199254740991)
    qtype: QuestionType
    taxonomy_node_id: UUID = Field(..., alias="taxonomyNodeId")
    difficulty: int = Field(..., ge=1, le=5)
    marks: float = Field(..., gt=0.0)
    state: SlotState
    question_id: UUID | None = Field(..., alias="questionId")
    flags: list[str]


class PaperSpec(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Kind1
    title: str = Field(..., min_length=1)
    exam_code: str | None = Field(..., alias="examCode")
    blueprint_id: UUID | None = Field(..., alias="blueprintId")
    taxonomy_node_ids: list[UUID] = Field(..., alias="taxonomyNodeIds", min_length=1)
    sections: list[PaperSection] = Field(..., min_length=1)
    languages: list[Language] = Field(..., min_length=1)
    layout: PaperLayout
    duration_minutes: DurationMinutes | None = Field(..., alias="durationMinutes")
    sourcing: Sourcing
    student_batch_id: UUID | None = Field(..., alias="studentBatchId")
    set_codes: list[SetCode1] = Field(..., alias="setCodes", max_length=8)


class PromptsOverview(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    versions: list[PromptVersion]
    can_edit: bool = Field(..., alias="canEdit")


class QuestionContent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    hi: QuestionText | None
    en: QuestionText | None


class QuestionImport(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    ref: str = Field(..., pattern="^[a-z0-9]+(-[a-z0-9]+)*$")
    qtype: QuestionType
    content: QuestionContent
    answer: Answer
    authoritative_language: Language = Field(..., alias="authoritativeLanguage")
    difficulty: int = Field(..., ge=1, le=5)
    marks: Marks | None
    negative_marks: NegativeMarks | None = Field(..., alias="negativeMarks")
    taxonomy: list[CodePath] = Field(..., min_length=1)
    licence: Licence


class SegmentedPaper(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    questions: list[SegmentedQuestion]


class StaffMember(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    user_id: UUID = Field(..., alias="userId")
    name: str
    email: EmailStr = Field(
        ...,
        pattern="^(?:[A-Za-z0-9_'+\\-]+\\.)*[A-Za-z0-9_'+\\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$",
    )
    role: OrgRole
    platform_admin: bool = Field(..., alias="platformAdmin")
    subjects: list[StaffSubject]
    monthly_budget_usd: float | None = Field(..., alias="monthlyBudgetUsd")
    spent_this_month_usd: float = Field(..., alias="spentThisMonthUsd")
    joined_at: AwareDatetime = Field(..., alias="joinedAt")


class SyllabusImport(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    subject: SyllabusNodeImport


class TaskSpec(RootModel[PaperSpec | NotesSpec]):
    root: PaperSpec | NotesSpec = Field(..., title="TaskSpec")


class Blueprint(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    sections: list[PaperSection] = Field(..., min_length=1)
    duration_minutes: int = Field(
        ..., alias="durationMinutes", gt=0, le=9007199254740991
    )
    instructions: LocalizedText
    default_difficulty_mix: DifficultyMix = Field(..., alias="defaultDifficultyMix")


class BlueprintImport(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    exam: str = Field(..., pattern="^[a-z0-9]+(_[a-z0-9]+)*$")
    name: str = Field(..., min_length=1)
    blueprint: Blueprint


class CanvasQuestion(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    qtype: QuestionType
    origin: QuestionOrigin
    status: QuestionStatus
    content: QuestionContent
    answer: Answer
    difficulty: Difficulty | None
    verification: dict[str, Any]
    sources: list[CitationRef]


class ChatBlock6(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["spec_review"]
    spec: TaskSpec
    availability: list[TopicAvailability]
    estimate: CostEstimate
    confirmed_at: AwareDatetime | None = Field(..., alias="confirmedAt")


class DraftSpec(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: TaskKind | None = None
    title: str | None = None
    exam_code: str | None = Field(None, alias="examCode")
    blueprint_id: UUID | None = Field(None, alias="blueprintId")
    taxonomy_node_ids: list[UUID] | None = Field(None, alias="taxonomyNodeIds")
    sections: list[PaperSection] | None = None
    languages: list[Language] | None = None
    layout: PaperLayout | None = None
    duration_minutes: DurationMinutes | None = Field(None, alias="durationMinutes")
    sourcing: Sourcing | None = None
    student_batch_id: UUID | None = Field(None, alias="studentBatchId")
    set_codes: list[str] | None = Field(None, alias="setCodes")
    depth: Depth | None = None
    include_examples: bool | None = Field(None, alias="includeExamples")
    include_practice: bool | None = Field(None, alias="includePractice")


class EditOp3(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    op: Literal["add_items"]
    after_slot_id: str | None = Field(..., alias="afterSlotId")
    slots: list[PaperSlot] = Field(..., min_length=1)


class EditOp8(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    op: Literal["edit_item"]
    slot_id: str = Field(..., alias="slotId")
    content: QuestionContent
    answer: Answer


class EditOp11(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    op: Literal["replace_section"]
    section: NotesSection


class EditOp(
    RootModel[
        EditOp1
        | EditOp2
        | EditOp3
        | EditOp4
        | EditOp5
        | EditOp6
        | EditOp7
        | EditOp8
        | EditOp9
        | EditOp10
        | EditOp11
    ]
):
    root: (
        EditOp1
        | EditOp2
        | EditOp3
        | EditOp4
        | EditOp5
        | EditOp6
        | EditOp7
        | EditOp8
        | EditOp9
        | EditOp10
        | EditOp11
    ) = Field(..., title="EditOp")


class ImportPaperPatternsRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    blueprints: list[BlueprintImport] = Field(..., max_length=500, min_length=1)


class LibraryPage(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    items: list[LibrarySource]
    total: int = Field(..., ge=0, le=9007199254740991)
    page_size: int = Field(..., alias="pageSize", ge=0, le=9007199254740991)


class NotesDocument(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    spec: NotesSpec
    sections: list[NotesSection]


class PaperDocument(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    spec: PaperSpec
    sections: list[Section]
    slots: list[PaperSlot]
    sets: list[PaperSet]


class PaperPattern(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    exam_id: UUID = Field(..., alias="examId")
    exam_code: str = Field(..., alias="examCode")
    name: str
    version: int = Field(..., gt=0, le=9007199254740991)
    blueprint: Blueprint
    total_questions: int = Field(..., alias="totalQuestions", ge=0, le=9007199254740991)
    total_marks: float = Field(..., alias="totalMarks", ge=0.0)


class Question(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    org_id: UUID = Field(..., alias="orgId")
    qtype: QuestionType
    origin: QuestionOrigin
    status: QuestionStatus
    content: QuestionContent
    authoritative_language: Language = Field(..., alias="authoritativeLanguage")
    answer: Answer
    marks: float | None
    negative_marks: float | None = Field(..., alias="negativeMarks")
    difficulty: Difficulty | None
    taxonomy_node_ids: list[UUID] = Field(..., alias="taxonomyNodeIds")
    figure_asset_ids: list[UUID] = Field(..., alias="figureAssetIds")
    licence: Licence
    source_chunk_ids: list[UUID] = Field(..., alias="sourceChunkIds")


class SavePaperPatternRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    exam_id: UUID = Field(..., alias="examId")
    name: str = Field(..., max_length=120, min_length=1)
    blueprint: Blueprint


class StaffDirectory(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    members: list[StaffMember]
    subjects: list[SubjectRef]


class ApplyDocumentEditsInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    v: Literal[1]
    org_id: UUID = Field(..., alias="orgId")
    document_id: UUID = Field(..., alias="documentId")
    run_id: UUID = Field(..., alias="runId")
    base_version: int = Field(..., alias="baseVersion", gt=0, le=9007199254740991)
    ops: list[EditOp]
    summary: str
    session_id: UUID | None = Field(..., alias="sessionId")
    message_id: UUID = Field(..., alias="messageId")


class ChatBlock9(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["edit_summary"]
    document_id: UUID = Field(..., alias="documentId")
    from_version: int = Field(..., alias="fromVersion", ge=0, le=9007199254740991)
    to_version: int = Field(..., alias="toVersion", ge=0, le=9007199254740991)
    summary: str
    ops: list[EditOp]


class ChatBlock(
    RootModel[
        ChatBlock1
        | ChatBlock2
        | ChatBlock3
        | ChatBlock4
        | ChatBlock5
        | ChatBlock6
        | ChatBlock7
        | ChatBlock8
        | ChatBlock9
        | ChatBlock10
        | ChatBlock11
    ]
):
    root: (
        ChatBlock1
        | ChatBlock2
        | ChatBlock3
        | ChatBlock4
        | ChatBlock5
        | ChatBlock6
        | ChatBlock7
        | ChatBlock8
        | ChatBlock9
        | ChatBlock10
        | ChatBlock11
    ) = Field(..., title="ChatBlock")


class ChatEngineEvent2(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    event: Literal["block"]
    block: ChatBlock


class ChatEngineEvent3(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    event: Literal["draft_spec"]
    draft_spec: DraftSpec = Field(..., alias="draftSpec")


class ChatEngineEvent4(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    event: Literal["document_edit"]
    document_id: UUID = Field(..., alias="documentId")
    base_version: int = Field(..., alias="baseVersion", gt=0, le=9007199254740991)
    ops: list[EditOp] = Field(..., min_length=1)
    summary: str


class ChatEngineEvent6(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    event: Literal["done"]
    blocks: list[ChatBlock]
    model_id: str | None = Field(..., alias="modelId")
    title: str | None
    session_status: ChatSessionStatus = Field(..., alias="sessionStatus")


class ChatEngineEvent(
    RootModel[
        ChatEngineEvent1
        | ChatEngineEvent2
        | ChatEngineEvent3
        | ChatEngineEvent4
        | ChatEngineEvent5
        | ChatEngineEvent6
        | ChatEngineEvent7
    ]
):
    root: (
        ChatEngineEvent1
        | ChatEngineEvent2
        | ChatEngineEvent3
        | ChatEngineEvent4
        | ChatEngineEvent5
        | ChatEngineEvent6
        | ChatEngineEvent7
    ) = Field(..., title="ChatEngineEvent")


class ChatMessage(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    seq: int = Field(..., ge=0, le=9007199254740991)
    role: Role
    blocks: list[ChatBlock]
    model_id: str | None = Field(..., alias="modelId")
    created_at: AwareDatetime = Field(..., alias="createdAt")


class ChatSessionDetail(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    session: ChatSessionSummary
    draft_spec: DraftSpec | None = Field(..., alias="draftSpec")
    messages: list[ChatMessage]
    active_turn_id: UUID | None = Field(..., alias="activeTurnId")
    generation: GenerationProgress | None


class ChatStreamEvent3(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    event: Literal["block"]
    block: ChatBlock


class ChatStreamEvent4(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    event: Literal["draft_spec"]
    draft_spec: DraftSpec = Field(..., alias="draftSpec")


class ChatStreamEvent(
    RootModel[
        ChatStreamEvent1
        | ChatStreamEvent2
        | ChatStreamEvent3
        | ChatStreamEvent4
        | ChatStreamEvent5
        | ChatStreamEvent6
    ]
):
    root: (
        ChatStreamEvent1
        | ChatStreamEvent2
        | ChatStreamEvent3
        | ChatStreamEvent4
        | ChatStreamEvent5
        | ChatStreamEvent6
    ) = Field(..., title="ChatStreamEvent")


class DocumentContent(RootModel[PaperDocument | NotesDocument]):
    root: PaperDocument | NotesDocument = Field(..., title="DocumentContent")


class DocumentDetail(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    document: DocumentSummary
    content: DocumentContent
    questions: dict[str, CanvasQuestion]
    node_names: dict[str, LocalizedText] = Field(..., alias="nodeNames")
    generation: GenerationProgress | None


class DocumentEdit(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    document_id: UUID = Field(..., alias="documentId")
    base_version: int = Field(..., alias="baseVersion", ge=0, le=9007199254740991)
    ops: list[EditOp] = Field(..., min_length=1)


class DocumentEditRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    base_version: int = Field(..., alias="baseVersion", gt=0, le=9007199254740991)
    ops: list[EditOp] = Field(..., max_length=100, min_length=1)


class DocumentVersion(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    version: int = Field(..., gt=0, le=9007199254740991)
    content: DocumentContent


class AppendChatBlocksInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    v: Literal[1]
    org_id: UUID = Field(..., alias="orgId")
    session_id: UUID = Field(..., alias="sessionId")
    message_id: UUID = Field(..., alias="messageId")
    blocks: list[ChatBlock] = Field(..., min_length=1)


SyllabusNodeImport.model_rebuild()
