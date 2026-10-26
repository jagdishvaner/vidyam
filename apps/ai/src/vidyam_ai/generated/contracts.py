# Generated from packages/contracts by `pnpm codegen`. Do not edit by hand.

from __future__ import annotations

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


class Answer(RootModel[Answer1 | Answer2 | Answer3]):
    root: Answer1 | Answer2 | Answer3 = Field(..., title="Answer")


class PlatformRole(StrEnum):
    superadmin = "superadmin"


class Organization(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: UUID
    name: str
    slug: str


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


class IngestSourceInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    v: Literal[1]
    org_id: UUID = Field(..., alias="orgId")
    requested_by: UUID | None = Field(..., alias="requestedBy")
    source_id: UUID = Field(..., alias="sourceId")


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
    chunks: int = Field(..., ge=0, le=9007199254740991)


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


class PageStart(RootModel[int]):
    root: int = Field(..., ge=-9007199254740991, le=9007199254740991)


class PageEnd(RootModel[int]):
    root: int = Field(..., ge=-9007199254740991, le=9007199254740991)


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


class Item(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    item_id: str = Field(..., alias="itemId")
    question_id: UUID = Field(..., alias="questionId")
    slot_id: str | None = Field(..., alias="slotId")
    marks: float


class Section(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: str
    instructions: str | None
    items: list[Item]


class Layout(StrEnum):
    hindi_then_english = "hindi_then_english"
    side_by_side = "side_by_side"
    single_language = "single_language"


class DifficultyMix(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    easy: float
    medium: float
    hard: float


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


class Difficulty(RootModel[int]):
    root: int = Field(..., ge=1, le=5)


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


class SetMemberPasswordRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    password: str = Field(..., max_length=128, min_length=10)


class Slot(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    section_index: int = Field(..., alias="sectionIndex", ge=0, le=9007199254740991)
    qtype: QuestionType
    taxonomy_node_id: UUID = Field(..., alias="taxonomyNodeId")
    difficulty: int = Field(..., ge=1, le=5)
    marks: float = Field(..., gt=0.0)


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


class SourceState(StrEnum):
    queued = "queued"
    reading = "reading"
    ready = "ready"
    waiting_for_ocr = "waiting_for_ocr"
    failed = "failed"


class SystemStatus(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    ok: bool
    services: list[ServiceHealth]


class TaskQueue(StrEnum):
    ai = "ai"
    ai_cpu = "ai-cpu"
    ai_llm = "ai-llm"
    render = "render"


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
    added_at: AwareDatetime = Field(
        ...,
        alias="addedAt",
        pattern="^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$",
    )


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


class Section1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: str
    qtype: QuestionType
    count: int = Field(..., gt=0, le=9007199254740991)
    marks_each: float = Field(..., alias="marksEach", gt=0.0)
    difficulty_mix: DifficultyMix = Field(..., alias="difficultyMix")


class PaperSpec(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    exam_code: str = Field(..., alias="examCode")
    title: str
    languages: list[Language] = Field(..., min_length=1)
    layout: Layout
    duration_minutes: int = Field(
        ..., alias="durationMinutes", gt=0, le=9007199254740991
    )
    total_marks: float = Field(..., alias="totalMarks", gt=0.0)
    negative_marking: float = Field(..., alias="negativeMarking", ge=0.0)
    taxonomy_node_ids: list[UUID] = Field(..., alias="taxonomyNodeIds", min_length=1)
    sections: list[Section1] = Field(..., min_length=1)
    allow_pyq_reuse: bool = Field(..., alias="allowPyqReuse")
    student_batch_id: UUID | None = Field(..., alias="studentBatchId")


class QuestionContent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    hi: QuestionText | None
    en: QuestionText | None


class LibraryPage(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    items: list[LibrarySource]
    total: int = Field(..., ge=0, le=9007199254740991)
    page_size: int = Field(..., alias="pageSize", ge=0, le=9007199254740991)


class PaperDocument(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    spec: PaperSpec
    sections: list[Section]


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
