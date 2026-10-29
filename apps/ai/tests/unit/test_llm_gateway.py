"""The gateway's rules, against in-memory registry, ledger and providers: routing, the teacher's model choice,
budgets, fallbacks, the stub, structured replies, streaming and batches."""

from collections.abc import AsyncIterator, Sequence
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

import pytest
from pydantic import BaseModel
from vidyam_ai.application.llm_gateway import (
    BatchItem,
    BatchOutcome,
    BatchRecord,
    BatchStatus,
    BudgetExceeded,
    Caller,
    LedgerEntry,
    LlmGateway,
    LlmProvider,
    LlmReply,
    LlmRequest,
    ModelNotAllowed,
    PromptMissing,
    ProviderError,
    ProviderNotConfigured,
)
from vidyam_ai.domain.llm import (
    BatchResult,
    Budget,
    Completion,
    Family,
    Model,
    ModelCall,
    Prices,
    PromptTemplate,
    Provider,
    Route,
    Segment,
    Turn,
    Usage,
)
from vidyam_ai.infrastructure.llm.stub import StubProvider

ORG, TEACHER = uuid4(), uuid4()
PRICES = Prices.parse(
    {"input": "4", "output": "20", "cache_read": "0.4", "cache_write_5m": "5", "cache_write_1h": "8"}
)
MODELS = {
    "claude-opus-5-5": Model(
        "claude-opus-5-5",
        "anthropic",
        "claude-opus-5-5",
        PRICES,
        128_000,
        True,
        True,
        ("low", "medium", "high"),
        True,
    ),
    "claude-haiku-5-5": Model(
        "claude-haiku-5-5", "anthropic", "claude-haiku-5-5", PRICES, 128_000, batch=True
    ),
    "gpt-6-astra": Model("gpt-6-astra", "openai", "gpt-6-astra", PRICES, 64_000, True, True, ("low", "high")),
}


class Catalog:
    def __init__(self) -> None:
        self.routes = {
            "generate": Route(
                "generate", "claude-opus-5-5", "high", 200_000, fallback_model_id="gpt-6-astra"
            ),
            "chat_title": Route("chat_title", "claude-haiku-5-5", "low", 200),
            "tag": Route("tag", "claude-haiku-5-5", "medium", 4_000),
        }
        self.allowed: list[str] = []
        self.prompts = {
            ("generate", "claude"): PromptTemplate("generate", "claude", 3, "Write {{count}} questions."),
            ("generate", "any"): PromptTemplate("generate", "any", 1, "Generic: {{count}}"),
            ("chat_title", "any"): PromptTemplate("chat_title", "any", 1, "Title for: {{first_message}}"),
            ("tag", "any"): PromptTemplate("tag", "any", 2, "Tag: {{text}}"),
        }

    async def route(self, org_id: UUID, task: str) -> Route | None:
        return self.routes.get(task)

    async def model(self, model_id: str) -> Model | None:
        return MODELS.get(model_id)

    async def allowed_model_ids(self, org_id: UUID) -> list[str]:
        return self.allowed

    async def prompt(self, task: str, family: Family) -> PromptTemplate | None:
        return self.prompts.get((task, family))


class Ledger:
    def __init__(self) -> None:
        self.entries: list[LedgerEntry] = []
        self.limits: list[tuple[Literal["center", "user"], Decimal]] = []

    async def record(self, entry: LedgerEntry) -> None:
        self.entries.append(entry)

    async def budgets(
        self, org_id: UUID, user_id: UUID | None, since: datetime, until: datetime
    ) -> list[Budget]:
        spent = sum((e.cost_usd for e in self.entries), Decimal(0))
        return [Budget(scope, limit, spent) for scope, limit in self.limits]


class Batches:
    def __init__(self) -> None:
        self.rows: dict[UUID, BatchRecord] = {}
        self.ledger: list[LedgerEntry] = []

    async def create(self, batch: BatchRecord) -> UUID:
        batch_id = uuid4()
        self.rows[batch_id] = BatchRecord(**{**batch.__dict__, "id": batch_id})
        return batch_id

    async def get(self, org_id: UUID, batch_id: UUID) -> BatchRecord | None:
        return self.rows.get(batch_id)

    async def mark_ended(self, org_id: UUID, batch_id: UUID) -> None:
        self.rows[batch_id] = BatchRecord(**{**self.rows[batch_id].__dict__, "status": "ended"})

    async def collect(self, org_id: UUID, batch_id: UUID, entries: Sequence[LedgerEntry]) -> bool:
        if self.rows[batch_id].status == "collected":
            return False
        self.rows[batch_id] = BatchRecord(**{**self.rows[batch_id].__dict__, "status": "collected"})
        self.ledger += entries
        return True


class Scripted:
    """A provider that replays canned outcomes and remembers what it was asked."""

    def __init__(self, *outcomes: str | ProviderError) -> None:
        self.outcomes = list(outcomes)
        self.calls: list[ModelCall] = []

    def _next(self, call: ModelCall) -> Completion:
        self.calls.append(call)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, ProviderError):
            raise outcome
        return Completion(outcome, Usage(input_tokens=1_000, output_tokens=100), "done", "end_turn", "req_1")

    async def complete(self, call: ModelCall) -> Completion:
        return self._next(call)

    async def stream(self, call: ModelCall) -> AsyncIterator[str | Completion]:
        done = self._next(call)
        for word in done.text.split(" "):
            yield word
        yield done

    async def submit_batch(self, calls: Sequence[tuple[str, ModelCall]]) -> str:
        raise NotImplementedError

    async def batch_status(self, batch_id: str) -> BatchStatus:
        raise NotImplementedError

    async def batch_results(self, batch_id: str) -> Sequence[BatchResult]:
        raise NotImplementedError


def gateway(
    providers: dict[Provider, LlmProvider],
    *,
    stub: LlmProvider | None = None,
    force_stub: bool = False,
    catalog: Catalog | None = None,
    ledger: Ledger | None = None,
    batches: Batches | None = None,
) -> LlmGateway:
    return LlmGateway(
        catalog or Catalog(),
        ledger or Ledger(),
        batches or Batches(),
        providers,
        stub=stub,
        force_stub=force_stub,
        now=lambda: datetime(2026, 10, 28, tzinfo=UTC),
    )


def generate(**overrides: object) -> LlmRequest:
    base = LlmRequest(Caller(ORG, TEACHER), "generate", variables={"count": "5"})
    return LlmRequest(**{**base.__dict__, **overrides})  # type: ignore[arg-type]


async def test_a_call_follows_the_route_and_lands_in_the_ledger() -> None:
    claude, ledger = Scripted("five questions"), Ledger()
    reply = await gateway({"anthropic": claude}, ledger=ledger).complete(generate())

    [call] = claude.calls
    assert call.model == "claude-opus-5-5"
    assert call.effort == "high"
    assert call.max_tokens == 128_000  # the route asks for more than the model can give
    assert call.turns == (Turn("user", "Write 5 questions."),)  # family-specific prompt, one-shot
    assert (reply.text, reply.provider, reply.prompt_version) == (
        "five questions",
        "anthropic",
        "generate.claude.v3",
    )
    assert reply.cost_usd == Decimal("0.006000")  # 1000 in at $4, 100 out at $20
    [entry] = ledger.entries
    assert (entry.model_id, entry.cost_usd, entry.request_id, entry.error) == (
        "claude-opus-5-5",
        reply.cost_usd,
        "req_1",
        None,
    )


async def test_with_a_conversation_the_prompt_becomes_the_cached_system_prompt() -> None:
    claude = Scripted("ok")
    turns = [Turn("user", "make a paper"), Turn("assistant", "which chapter?"), Turn("user", "motion")]
    request = generate(turns=turns, prompt_cache="1h", context=[Segment("evidence", "5m")])
    await gateway({"anthropic": claude}).complete(request)
    [call] = claude.calls
    assert call.system == (Segment("Write 5 questions.", "1h"), Segment("evidence", "5m"))
    assert call.turns == tuple(turns)


async def test_teachers_pick_among_the_models_the_center_allows() -> None:
    claude, gpt, catalog = Scripted(), Scripted("from gpt"), Catalog()
    reply = await gateway({"anthropic": claude, "openai": gpt}, catalog=catalog).complete(
        generate(model_id="gpt-6-astra")
    )
    assert reply.model_id == "gpt-6-astra"
    assert gpt.calls[0].effort == "high"
    assert gpt.calls[0].turns[0].text == "Generic: 5"  # no GPT prompt yet: the "any" version

    catalog.allowed = ["claude-opus-5-5"]
    with pytest.raises(ModelNotAllowed):
        await gateway({"openai": gpt}, catalog=catalog).complete(generate(model_id="gpt-6-astra"))
    with pytest.raises(ModelNotAllowed):  # never selectable
        await gateway({}, catalog=Catalog()).complete(generate(model_id="claude-haiku-5-5"))
    with pytest.raises(ModelNotAllowed):  # tagging always follows its route
        await gateway({}, catalog=Catalog()).complete(
            LlmRequest(Caller(ORG), "tag", variables={"text": "x"}, model_id="claude-opus-5-5")
        )


async def test_a_check_runs_on_the_other_provider_than_the_writer() -> None:
    catalog = Catalog()
    catalog.routes["verify_solve"] = Route(
        "verify_solve", "gpt-6-astra", "high", 8_000, other_provider_model_id="claude-opus-5-5"
    )
    catalog.prompts["verify_solve", "any"] = PromptTemplate("verify_solve", "any", 1, "Solve it.")
    claude, gpt = Scripted("by claude"), Scripted("by gpt", "by gpt")
    llm = gateway({"anthropic": claude, "openai": gpt}, catalog=catalog)
    request = LlmRequest(Caller(ORG), "verify_solve")

    # Written by GPT: checked by Claude. Written by Claude, or by nobody known: the route's own model.
    assert (await llm.complete(replace(request, written_by="gpt-6-astra"))).model_id == "claude-opus-5-5"
    assert (await llm.complete(replace(request, written_by="claude-opus-5-5"))).model_id == "gpt-6-astra"
    assert (await llm.complete(request)).model_id == "gpt-6-astra"


async def test_a_used_up_budget_stops_the_call_before_it_is_made() -> None:
    claude, ledger = Scripted("a", "b"), Ledger()
    ledger.limits = [("center", Decimal("100")), ("user", Decimal("0.006"))]
    llm = gateway({"anthropic": claude}, ledger=ledger)
    await llm.complete(generate())
    with pytest.raises(BudgetExceeded, match=r"Your monthly AI budget of US\$0\.01"):
        await llm.complete(generate())
    assert len(claude.calls) == 1


async def test_an_outage_falls_back_to_the_routes_second_model_and_both_are_recorded() -> None:
    claude = Scripted(ProviderError("Claude: overloaded", retryable=True, request_id="req_x"))
    gpt, ledger = Scripted("from gpt"), Ledger()
    reply = await gateway({"anthropic": claude, "openai": gpt}, ledger=ledger).complete(generate())
    assert (reply.model_id, reply.text) == ("gpt-6-astra", "from gpt")
    failed, served = ledger.entries
    assert (failed.model_id, failed.error, failed.cost_usd, failed.request_id) == (
        "claude-opus-5-5",
        "Claude: overloaded",
        Decimal(0),
        "req_x",
    )
    assert served.model_id == "gpt-6-astra"


async def test_a_rejected_request_does_not_fall_back() -> None:
    claude = Scripted(ProviderError("Claude: bad request", retryable=False))
    gpt = Scripted("unused")
    with pytest.raises(ProviderError, match="bad request"):
        await gateway({"anthropic": claude, "openai": gpt}).complete(generate())
    assert gpt.calls == []


async def test_without_a_key_the_stub_answers_and_costs_nothing(tmp_path: Path) -> None:
    ledger = Ledger()
    llm = gateway({}, stub=StubProvider(tmp_path), ledger=ledger)
    request = LlmRequest(
        Caller(ORG, TEACHER), "chat_title", variables={"first_message": "RPSC science paper on motion please"}
    )
    reply = await llm.complete(request)
    assert reply.text == "RPSC science paper on motion please"
    assert (reply.provider, reply.model_id, reply.cost_usd) == ("stub", "claude-haiku-5-5", Decimal(0))
    assert ledger.entries[0].model_id == "stub"
    assert ledger.entries[0].usage.output_tokens > 0


async def test_in_production_a_missing_key_is_an_error() -> None:
    with pytest.raises(ProviderNotConfigured, match="ANTHROPIC_API_KEY"):
        await gateway({"openai": Scripted()}).complete(generate())


async def test_the_stub_can_be_forced_on_even_with_keys(tmp_path: Path) -> None:
    claude = Scripted("real")
    reply = await gateway({"anthropic": claude}, stub=StubProvider(tmp_path), force_stub=True).complete(
        generate()
    )
    assert reply.provider == "stub"
    assert claude.calls == []


async def test_a_task_without_an_active_prompt_is_refused() -> None:
    catalog = Catalog()
    catalog.routes["lint"] = Route("lint", "claude-opus-5-5", None, 1_000)
    with pytest.raises(PromptMissing, match="Admin"):
        await gateway({"anthropic": Scripted()}, catalog=catalog).complete(LlmRequest(Caller(ORG), "lint"))


class Draft(BaseModel):
    stem: str
    options: list[str]
    answer: int
    hint: str | None = None
    marks: int = 1


async def test_structured_replies_are_validated_into_the_model(tmp_path: Path) -> None:
    catalog = Catalog()  # a task the stub has no responder for: it answers with the schema's example
    catalog.routes["lint"] = Route("lint", "claude-opus-5-5", None, 1_000)
    catalog.prompts["lint", "any"] = PromptTemplate("lint", "any", 1, "Check it.")
    llm = gateway({}, stub=StubProvider(tmp_path), catalog=catalog)
    result = await llm.complete_structured(LlmRequest(Caller(ORG), "lint"), Draft)
    assert result.value == Draft(stem="stub", options=["stub"], answer=0, hint="stub", marks=0)

    # OpenAI's strict mode sends optional fields back as null: they fall back to their defaults.
    gpt = Scripted('{"stem": "s", "options": ["a", "b"], "answer": 1, "hint": null, "marks": null}')
    result = await gateway({"anthropic": gpt}).complete_structured(generate(), Draft)
    assert result.value == Draft(stem="s", options=["a", "b"], answer=1)


async def test_streaming_yields_text_then_the_reply() -> None:
    claude, ledger = Scripted("two words"), Ledger()
    items = [item async for item in gateway({"anthropic": claude}, ledger=ledger).stream(generate())]
    assert items[:2] == ["two", "words"]
    assert isinstance(items[2], LlmReply)
    assert len(ledger.entries) == 1


async def test_a_stream_that_fails_before_any_text_falls_back() -> None:
    claude = Scripted(ProviderError("Claude: overloaded", retryable=True))
    gpt = Scripted("from gpt")
    items = [item async for item in gateway({"anthropic": claude, "openai": gpt}).stream(generate())]
    assert items[:2] == ["from", "gpt"]


async def test_batches_are_collected_once_at_half_price(tmp_path: Path) -> None:
    batches = Batches()
    llm = gateway({}, stub=StubProvider(tmp_path), batches=batches)
    items = [BatchItem(f"chunk-{i}", variables={"text": f"chunk {i}"}) for i in range(3)]
    batch_id = await llm.submit_batch(Caller(ORG, workflow_id="tagging:1"), "tag", items)
    assert batches.rows[batch_id].prompt_version == "tag.any.v2"
    assert await llm.batch_ended(ORG, batch_id)

    received: list[BatchOutcome] = []

    async def store(batch: BatchRecord, outcomes: Sequence[BatchOutcome]) -> None:
        received.extend(outcomes)

    summary = await llm.collect_batch(ORG, batch_id, store)
    assert (summary.succeeded, summary.failed, summary.cost_usd) == (3, 0, Decimal(0))
    assert [o.custom_id for o in received] == ["chunk-0", "chunk-1", "chunk-2"]
    assert all(entry.is_batch and entry.caller.workflow_id == "tagging:1" for entry in batches.ledger)

    await llm.collect_batch(ORG, batch_id, store)  # a retried collection writes no second set of rows
    assert len(batches.ledger) == 3
    assert len(received) == 6  # but the handler runs again, so it must be idempotent


async def test_batch_request_ids_are_checked_before_anything_is_sent(tmp_path: Path) -> None:
    llm = gateway({}, stub=StubProvider(tmp_path))
    with pytest.raises(ValueError, match="unique"):
        await llm.submit_batch(Caller(ORG), "tag", [BatchItem("a b")])
    with pytest.raises(ValueError, match="unique"):
        await llm.submit_batch(Caller(ORG), "tag", [BatchItem("a"), BatchItem("a")])
