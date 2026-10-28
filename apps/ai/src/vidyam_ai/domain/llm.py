"""Model calls in provider-neutral terms: what we ask for, what comes back, what it costs, and who may spend
it. Pure; no SDKs, no I/O. Money is Decimal so the ledger adds up to the cent.

Plan v3 §8: tasks are routed to models by task_routes; a teacher's own model choice replaces the route for the
work they see; every call is checked against the center's and the teacher's monthly budget and recorded in the
usage ledger.
"""

import re
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal

Provider = Literal["anthropic", "openai", "stub"]
Family = Literal["claude", "gpt", "any"]
Effort = Literal["low", "medium", "high", "xhigh", "max"]
CacheTtl = Literal["5m", "1h"]
Role = Literal["user", "assistant"]
# How a reply ended: complete, cut off by the token limit, refused by the model's safety rules, or otherwise.
Finish = Literal["done", "max_tokens", "refusal", "other"]

EFFORTS: tuple[Effort, ...] = ("low", "medium", "high", "xhigh", "max")

# Tasks whose model the teacher picks in the chat; every other task always follows its route.
TEACHER_CHOICE_TASKS = frozenset({"chat_qa", "generate", "notes_write", "edit_agent"})

_MILLION = Decimal(1_000_000)
_BATCH_DISCOUNT = Decimal("0.5")  # both providers bill Batch API calls at half price
_MICRO = Decimal("0.000001")  # llm_calls.cost_usd is numeric(12, 6)
IST = timezone(timedelta(hours=5, minutes=30))  # budgets run by calendar month in India time


@dataclass(frozen=True)
class Segment:
    """One block of the system prompt. Stable blocks go first: a cached block caches everything before it too,
    so 1-hour blocks (rules, an exam's style pack) come before 5-minute ones (topic evidence)."""

    text: str
    cache: CacheTtl | None = None


@dataclass(frozen=True)
class Image:
    """A picture sent with a turn: a page to read (OCR), a figure. PNG, JPEG, GIF or WebP."""

    media_type: str
    data: bytes


@dataclass(frozen=True)
class Turn:
    role: Role
    text: str
    images: tuple[Image, ...] = ()  # shown to the model before the text


@dataclass(frozen=True)
class OutputSchema:
    """The JSON Schema a reply must follow. Each provider adapter adapts it to what that provider accepts."""

    name: str
    schema: Mapping[str, object]


@dataclass(frozen=True)
class ModelCall:
    """One fully resolved request to a provider."""

    model: str  # the provider's own model name (llm_models.api_model)
    system: tuple[Segment, ...]
    turns: tuple[Turn, ...]
    max_tokens: int
    effort: Effort | None = None
    output: OutputSchema | None = None
    cache_key: str | None = None  # requests sharing a prefix share a key, so OpenAI routes them to one cache
    # What the call is for. Real providers ignore these; the stub model uses them to answer in character.
    task: str = ""
    variables: Mapping[str, str] = field(default_factory=dict[str, str])


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0  # neither read from nor written to the prompt cache
    cache_read_tokens: int = 0
    cache_write_5m_tokens: int = 0  # OpenAI's default (30-minute) cache writes are counted here too
    cache_write_1h_tokens: int = 0
    output_tokens: int = 0  # includes thinking / reasoning

    @property
    def prompt_tokens(self) -> int:
        return (
            self.input_tokens
            + self.cache_read_tokens
            + self.cache_write_5m_tokens
            + self.cache_write_1h_tokens
        )

    @property
    def cache_write_tokens(self) -> int:
        return self.cache_write_5m_tokens + self.cache_write_1h_tokens


@dataclass(frozen=True)
class Completion:
    text: str
    usage: Usage
    finish: Finish
    stop_reason: str | None = None  # the provider's own word for how the reply ended
    request_id: str | None = None


@dataclass(frozen=True)
class BatchResult:
    custom_id: str
    completion: Completion | None
    error: str | None = None


@dataclass(frozen=True)
class Prices:
    """US$ per million tokens (llm_models.prices). Above `long_context_threshold` prompt tokens, every input
    price scales with the long-context input price, and output costs `long_context_output`."""

    input: Decimal
    output: Decimal
    cache_read: Decimal
    cache_write_5m: Decimal
    cache_write_1h: Decimal
    long_context_threshold: int | None = None
    long_context_input: Decimal | None = None
    long_context_output: Decimal | None = None

    @classmethod
    def parse(cls, raw: Mapping[str, object]) -> "Prices":
        """Reads the registry's JSON. A missing cache price falls back to the input price, so a gap in the
        registry over-counts spend instead of hiding it."""

        def money(key: str) -> Decimal | None:
            value = raw.get(key)
            return None if value is None else Decimal(str(value))

        input_price, output_price = money("input"), money("output")
        if input_price is None or output_price is None:
            raise ValueError("a model's prices need at least input and output")
        threshold = raw.get("long_context_threshold")
        return cls(
            input=input_price,
            output=output_price,
            cache_read=money("cache_read") or input_price,
            cache_write_5m=money("cache_write_5m") or input_price,
            cache_write_1h=money("cache_write_1h") or input_price,
            long_context_threshold=int(str(threshold)) if threshold is not None else None,
            long_context_input=money("long_context_input"),
            long_context_output=money("long_context_output"),
        )


FREE = Prices(Decimal(0), Decimal(0), Decimal(0), Decimal(0), Decimal(0))


def cost_usd(usage: Usage, prices: Prices, *, batch: bool = False) -> Decimal:
    scale, output = Decimal(1), prices.output
    long_input = prices.long_context_input
    if prices.long_context_threshold is not None and usage.prompt_tokens > prices.long_context_threshold:
        if long_input is not None and prices.input:
            scale = long_input / prices.input
        output = prices.long_context_output if prices.long_context_output is not None else output * scale
    prompt = (
        usage.input_tokens * prices.input
        + usage.cache_read_tokens * prices.cache_read
        + usage.cache_write_5m_tokens * prices.cache_write_5m
        + usage.cache_write_1h_tokens * prices.cache_write_1h
    )
    total = (prompt * scale + usage.output_tokens * output) / _MILLION
    if batch:
        total *= _BATCH_DISCOUNT
    return total.quantize(_MICRO)


@dataclass(frozen=True)
class Model:
    """One model in the platform's registry (llm_models)."""

    id: str
    provider: Provider
    api_model: str
    prices: Prices
    max_output_tokens: int
    enabled: bool = True
    teacher_selectable: bool = False
    effort_levels: tuple[Effort, ...] = ()
    batch: bool = False

    @property
    def family(self) -> Family:
        """Prompts are written per model family (prompt_templates.model_family)."""
        if self.provider == "anthropic":
            return "claude"
        return "gpt" if self.provider == "openai" else "any"


@dataclass(frozen=True)
class Route:
    """Which model serves a task: the center's own route, or the platform default (task_routes)."""

    task: str
    model_id: str
    effort: Effort | None
    max_tokens: int
    fallback_model_id: str | None = None


def teacher_may_use(model: Model, allowed_ids: Collection[str]) -> bool:
    """The center's AI policy: its allow-list, or (when empty) every model marked teacher-selectable."""
    return model.enabled and model.teacher_selectable and (not allowed_ids or model.id in allowed_ids)


def _rank(effort: Effort) -> int:
    return EFFORTS.index(effort)


def supported_effort(wanted: Effort | None, levels: Sequence[Effort]) -> Effort | None:
    """The route's effort if the model offers it; otherwise the nearest level below it, or the model's lowest.
    Models without effort levels (the stub) get none."""
    if wanted is None or not levels:
        return None
    if wanted in levels:
        return wanted
    below: list[Effort] = [level for level in levels if _rank(level) < _rank(wanted)]
    return max(below, key=_rank) if below else min(levels, key=_rank)


def check_cache_layout(segments: Sequence[Segment]) -> None:
    """Longer-lived cache blocks come first: Claude rejects a 1-hour block after a 5-minute one."""
    seen_short = False
    for segment in segments:
        if segment.cache == "5m":
            seen_short = True
        elif segment.cache == "1h" and seen_short:
            raise ValueError("a 1-hour cached prompt block must come before every 5-minute one")


@dataclass(frozen=True)
class Budget:
    scope: Literal["center", "user"]
    limit_usd: Decimal
    spent_usd: Decimal

    @property
    def exhausted(self) -> bool:
        return self.spent_usd >= self.limit_usd


def month_bounds(now: datetime) -> tuple[datetime, datetime]:
    """The India-time calendar month containing `now`: its first instant and the next month's."""
    start = now.astimezone(IST).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start, (start + timedelta(days=32)).replace(day=1)


@dataclass(frozen=True)
class PromptTemplate:
    """A versioned prompt (prompt_templates): `body` refers to its variables as {{name}}."""

    task: str
    family: Family
    version: int
    body: str

    @property
    def label(self) -> str:
        """What the usage ledger records as the prompt version."""
        return f"{self.task}.{self.family}.v{self.version}"


_PLACEHOLDER = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")


class MissingVariable(Exception):
    pass


def render_prompt(body: str, values: Mapping[str, str]) -> str:
    """Fills the placeholders (the same rules as packages/prompts); a missing value is an error, not a gap."""

    def fill(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in values:
            raise MissingVariable(f"no value for {{{{{name}}}}}")
        return values[name]

    return _PLACEHOLDER.sub(fill, body)


_CUSTOM_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def valid_custom_id(custom_id: str) -> bool:
    """Batch request ids both providers accept: 1-64 letters, digits, '_' or '-'."""
    return bool(_CUSTOM_ID.match(custom_id))
