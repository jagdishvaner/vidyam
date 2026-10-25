# Generated from packages/contracts by `pnpm codegen`. Do not edit by hand.

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, RootModel


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


class Language(StrEnum):
    hi = "hi"
    en = "en"


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


class SourceLanguage(StrEnum):
    hi = "hi"
    en = "en"
    mixed = "mixed"


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
