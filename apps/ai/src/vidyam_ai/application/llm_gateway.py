"""The LLM gateway (plan v3 §8): the one door every model call goes through.

For each call it picks the model (the task's route, or the teacher's own choice where the policy allows it),
fills in the active prompt version, checks the center's and the teacher's monthly budgets, calls the provider,
falls back to the route's second model when a provider fails, and writes every call, failed ones included, to
the usage ledger. Without a provider key the built-in stub model answers instead, so the platform runs end to
end before keys exist; in production a missing key is an error instead.
"""

import json
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from decimal import Decimal
from time import monotonic
from typing import Literal, Protocol
from uuid import UUID

from pydantic import BaseModel, ValidationError

from vidyam_ai.domain.json_schema import drop_disallowed_nulls
from vidyam_ai.domain.llm import (
    FREE,
    TEACHER_CHOICE_TASKS,
    BatchResult,
    Budget,
    CacheTtl,
    Completion,
    Family,
    Finish,
    Image,
    MissingVariable,
    Model,
    ModelCall,
    OutputSchema,
    PromptTemplate,
    Provider,
    Route,
    Segment,
    Turn,
    Usage,
    check_cache_layout,
    cost_usd,
    month_bounds,
    render_prompt,
    supported_effort,
    teacher_may_use,
    valid_custom_id,
)

BatchStatus = Literal["running", "ended"]

_KEY_SETTING: Mapping[str, str] = {"anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY"}


class ProviderError(Exception):
    """A provider call failed. `retryable`: worth trying again, or on another model (rate limits, overloads,
    outages). Otherwise the request itself is wrong and another attempt would fail the same way."""

    def __init__(self, message: str, *, retryable: bool, request_id: str | None = None) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.request_id = request_id


class LlmError(Exception):
    """A call the gateway refuses or can't complete. The message says what to fix."""


class NoRoute(LlmError):
    pass


class ModelUnavailable(LlmError):
    pass


class ModelNotAllowed(LlmError):
    pass


class ProviderNotConfigured(LlmError):
    pass


class PromptMissing(LlmError):
    pass


class InvalidOutput(LlmError):
    pass


class BatchNotFound(LlmError):
    pass


class BudgetExceeded(LlmError):
    def __init__(self, budget: Budget) -> None:
        whose = "The center's" if budget.scope == "center" else "Your"
        super().__init__(f"{whose} monthly AI budget of US${budget.limit_usd:.2f} is used up")
        self.budget = budget


@dataclass(frozen=True)
class Caller:
    """Who a call is for and what it belongs to. Every ledger row carries it."""

    org_id: UUID
    user_id: UUID | None = None
    chat_session_id: UUID | None = None
    document_id: UUID | None = None
    turn_id: UUID | None = None
    workflow_id: str | None = None


@dataclass(frozen=True)
class LlmRequest:
    caller: Caller
    task: str
    # Values for the prompt template's {{placeholders}}.
    variables: Mapping[str, str] = field(default_factory=dict[str, str])
    # The conversation so far, ending with the user's turn. With turns, the rendered prompt is the system
    # prompt (cached for `prompt_cache`); without them it is the only user message (one-shot tasks).
    turns: Sequence[Turn] = ()
    # Pictures for a one-shot task (a page to read), sent with the rendered prompt.
    images: Sequence[Image] = ()
    # More system blocks after the prompt: an exam's style pack, retrieved evidence. Longest-lived first.
    context: Sequence[Segment] = ()
    prompt_cache: CacheTtl | None = None
    output: OutputSchema | None = None
    # The teacher's pick from the chat's model picker; honoured only for tasks teachers choose models for.
    model_id: str | None = None
    cache_key: str | None = None


@dataclass(frozen=True)
class LlmReply:
    text: str
    model_id: str  # the registry model that was asked for, even when the stub answered
    provider: Provider  # who actually answered
    usage: Usage
    cost_usd: Decimal
    finish: Finish
    prompt_version: str


@dataclass(frozen=True)
class StructuredReply[M: BaseModel]:
    value: M
    reply: LlmReply


@dataclass(frozen=True)
class BatchItem:
    """One request in a batch: its own id (1-64 letters, digits, '_' or '-') and what varies per request."""

    custom_id: str
    variables: Mapping[str, str] = field(default_factory=dict[str, str])
    turns: Sequence[Turn] = ()
    context: Sequence[Segment] = ()
    images: Sequence[Image] = ()


@dataclass(frozen=True)
class BatchOutcome:
    custom_id: str
    reply: LlmReply | None
    error: str | None = None


@dataclass(frozen=True)
class CostEstimate:
    model_id: str
    provider: Provider  # the stub, while the model's provider has no key
    cost_usd: Decimal


@dataclass(frozen=True)
class BatchSummary:
    batch_id: UUID
    succeeded: int
    failed: int
    cost_usd: Decimal


@dataclass(frozen=True)
class LedgerEntry:
    caller: Caller
    task: str
    provider: Provider
    model_id: str
    prompt_version: str | None
    usage: Usage
    cost_usd: Decimal
    latency_ms: int
    is_batch: bool = False
    stop_reason: str | None = None
    request_id: str | None = None
    error: str | None = None


@dataclass(frozen=True)
class BatchRecord:
    """A batch submitted to a provider (llm_batches). One task, one model, many requests."""

    caller: Caller
    provider: Provider
    provider_batch_id: str
    task: str
    model_id: str
    prompt_version: str
    request_count: int
    status: str = "running"
    id: UUID | None = None


# Stores what one kind of batch (OCR, tagging, ...) produced. Called again if collecting is retried.
type BatchHandler = Callable[[BatchRecord, Sequence[BatchOutcome]], Awaitable[None]]


class LlmProvider(Protocol):
    """Port: one provider's API (Anthropic, OpenAI) or the stub model."""

    async def complete(self, call: ModelCall) -> Completion: ...

    def stream(self, call: ModelCall) -> AsyncIterator[str | Completion]:
        """Text as it arrives, then the finished Completion as the last item."""
        ...

    async def submit_batch(self, calls: Sequence[tuple[str, ModelCall]]) -> str: ...
    async def batch_status(self, batch_id: str) -> BatchStatus: ...
    async def batch_results(self, batch_id: str) -> Sequence[BatchResult]: ...


class LlmCatalog(Protocol):
    """Port: the model registry, task routes, prompt versions and the center's AI policy."""

    async def route(self, org_id: UUID, task: str) -> Route | None:
        """The center's own route for the task, else the platform default."""
        ...

    async def model(self, model_id: str) -> Model | None: ...
    async def allowed_model_ids(self, org_id: UUID) -> list[str]: ...

    async def prompt(self, task: str, family: Family) -> PromptTemplate | None:
        """The active version of the task's prompt for that model family."""
        ...


class UsageLedger(Protocol):
    """Port: the usage ledger (llm_calls) and the monthly budgets (quotas) it is checked against."""

    async def record(self, entry: LedgerEntry) -> None: ...

    async def budgets(
        self, org_id: UUID, user_id: UUID | None, since: datetime, until: datetime
    ) -> list[Budget]:
        """The center's budget and the user's own, each with what was spent between `since` and `until`."""
        ...


class BatchLog(Protocol):
    """Port: submitted batches (llm_batches)."""

    async def create(self, batch: BatchRecord) -> UUID: ...
    async def get(self, org_id: UUID, batch_id: UUID) -> BatchRecord | None: ...
    async def mark_ended(self, org_id: UUID, batch_id: UUID) -> None: ...

    async def collect(self, org_id: UUID, batch_id: UUID, entries: Sequence[LedgerEntry]) -> bool:
        """Marks the batch collected and writes its ledger rows, once: False if it was already collected."""
        ...


@dataclass(frozen=True)
class _Target:
    model: Model
    provider: Provider  # who answers: the model's own provider, or the stub
    client: LlmProvider
    prompt: PromptTemplate
    call: ModelCall


def output_schema(output: type[BaseModel]) -> OutputSchema:
    return OutputSchema(output.__name__, output.model_json_schema(by_alias=True))


def parse_structured[M: BaseModel](text: str, output: type[M]) -> M:
    """Validates a structured reply (also a batch result) into its model."""
    try:
        data = drop_disallowed_nulls(json.loads(text), output.model_json_schema(by_alias=True))
        return output.model_validate(data)
    except (json.JSONDecodeError, ValidationError) as error:
        raise InvalidOutput(f"the reply doesn't match {output.__name__}: {error}") from error


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _elapsed_ms(started: float) -> int:
    return round((monotonic() - started) * 1000)


class LlmGateway:
    def __init__(
        self,
        catalog: LlmCatalog,
        ledger: UsageLedger,
        batches: BatchLog,
        providers: Mapping[Provider, LlmProvider],
        *,
        stub: LlmProvider | None,
        force_stub: bool = False,
        now: Callable[[], datetime] = _utcnow,
    ) -> None:
        """`stub` answers when a provider has no key (None in production, where that is an error);
        `force_stub` sends every call to it."""
        if force_stub and stub is None:
            raise ValueError("the stub model is forced on but not available")
        self._catalog = catalog
        self._ledger = ledger
        self._batches = batches
        self._providers = providers
        self._stub = stub
        self._force_stub = force_stub
        self._now = now

    async def complete(self, request: LlmRequest) -> LlmReply:
        route = await self._route(request.caller.org_id, request.task)
        target = await self._target(request, route, await self._chosen_model(request, route))
        await self._check_budgets(request.caller)
        while True:
            started = monotonic()
            try:
                completion = await target.client.complete(target.call)
            except ProviderError as error:
                await self._record_failure(request, target, error, started)
                fallback = await self._fallback(request, route, target, error)
                if fallback is None:
                    raise
                target = fallback
                continue
            return await self._record(request, target, completion, started)

    async def complete_structured[M: BaseModel](
        self, request: LlmRequest, output: type[M]
    ) -> StructuredReply[M]:
        """A reply that follows `output`'s JSON Schema, validated into the model."""
        reply = await self.complete(replace(request, output=output_schema(output)))
        if reply.finish != "done":
            raise InvalidOutput(f"{request.task}: the model stopped before finishing ({reply.finish})")
        return StructuredReply(parse_structured(reply.text, output), reply)

    async def stream(self, request: LlmRequest) -> AsyncIterator[str | LlmReply]:
        """Text as it arrives, then the LlmReply. Falls back to another model only before the first text."""
        route = await self._route(request.caller.org_id, request.task)
        target = await self._target(request, route, await self._chosen_model(request, route))
        await self._check_budgets(request.caller)
        while True:
            started, sent = monotonic(), False
            try:
                async for item in target.client.stream(target.call):
                    if isinstance(item, Completion):
                        yield await self._record(request, target, item, started)
                        return
                    sent = True
                    yield item
                raise ProviderError("the stream ended without a final message", retryable=True)
            except ProviderError as error:
                await self._record_failure(request, target, error, started)
                fallback = None if sent else await self._fallback(request, route, target, error)
                if fallback is None:
                    raise
                target = fallback

    async def submit_batch(
        self,
        caller: Caller,
        task: str,
        items: Sequence[BatchItem],
        *,
        output: OutputSchema | None = None,
        prompt_cache: CacheTtl | None = None,
    ) -> UUID:
        """Sends many requests for one task through the provider's Batch API (half price, results within 24
        hours). Returns the llm_batches id that `batch_ended` and `collect_batch` take."""
        if not items:
            raise ValueError("a batch needs at least one request")
        ids = [item.custom_id for item in items]
        if len(set(ids)) != len(ids) or not all(valid_custom_id(i) for i in ids):
            raise ValueError("batch request ids must be unique, 1-64 letters, digits, '_' or '-'")
        route = await self._route(caller.org_id, task)
        requests = [
            LlmRequest(
                caller,
                task,
                variables=item.variables,
                turns=item.turns,
                context=item.context,
                images=item.images,
                prompt_cache=prompt_cache,
                output=output,
            )
            for item in items
        ]
        target = await self._target(requests[0], route, route.model_id)
        if target.provider != "stub" and not target.model.batch:
            raise ModelUnavailable(
                f"{target.model.id} can't take batch requests; route {task} to another model"
            )
        await self._check_budgets(caller)
        calls = [
            (item.custom_id, self._call(request, route, target.model, target.prompt))
            for item, request in zip(items, requests, strict=True)
        ]
        provider_batch_id = await target.client.submit_batch(calls)
        return await self._batches.create(
            BatchRecord(
                caller=caller,
                provider=target.provider,
                provider_batch_id=provider_batch_id,
                task=task,
                model_id=target.model.id,
                prompt_version=target.prompt.label,
                request_count=len(items),
            )
        )

    async def estimate(
        self, org_id: UUID, task: str, usages: Sequence[Usage], *, batch: bool = True
    ) -> CostEstimate:
        """What requests of these sizes would cost on the task's route, before anything is sent (plan v3 §8:
        nothing paid starts without an estimate). Raises what the calls themselves would: no route, model
        switched off, no prompt, no provider key, budget used up."""
        route = await self._route(org_id, task)
        model = await self._catalog.model(route.model_id)
        if model is None or not model.enabled:
            raise ModelUnavailable(
                f"{route.model_id} is unknown or switched off; choose another model for {task}"
            )
        provider, _ = self._provider_for(model)
        if batch and provider != "stub" and not model.batch:
            raise ModelUnavailable(f"{model.id} can't take batch requests; route {task} to another model")
        prompt = await self._catalog.prompt(task, model.family) or await self._catalog.prompt(task, "any")
        if prompt is None:
            raise PromptMissing(f"no active prompt for {task!r}; add one in Admin → Prompts")
        await self._check_budgets(Caller(org_id))
        prices = FREE if provider == "stub" else model.prices
        total = sum((cost_usd(usage, prices, batch=batch) for usage in usages), Decimal(0))
        return CostEstimate(model.id, provider, total)

    async def batch_ended(self, org_id: UUID, batch_id: UUID) -> bool:
        batch = await self._batch(org_id, batch_id)
        if batch.status != "running":
            return True
        if await self._client(batch.provider).batch_status(batch.provider_batch_id) == "ended":
            await self._batches.mark_ended(org_id, batch_id)
            return True
        return False

    async def collect_batch(
        self,
        org_id: UUID,
        batch_id: UUID,
        handle: "BatchHandler",
    ) -> BatchSummary:
        """Hands an ended batch's results to `handle`, then records their cost. Safe to repeat: `handle` must
        be idempotent, and the ledger rows are written only once."""
        batch = await self._batch(org_id, batch_id)
        model = await self._catalog.model(batch.model_id)
        prices = FREE if batch.provider == "stub" or model is None else model.prices
        results = await self._client(batch.provider).batch_results(batch.provider_batch_id)
        outcomes: list[BatchOutcome] = []
        entries: list[LedgerEntry] = []
        for result in results:
            if result.completion is None:
                outcomes.append(BatchOutcome(result.custom_id, None, result.error or "no result"))
                continue
            done = result.completion
            cost = cost_usd(done.usage, prices, batch=True)
            reply = LlmReply(
                done.text, batch.model_id, batch.provider, done.usage, cost, done.finish, batch.prompt_version
            )
            outcomes.append(BatchOutcome(result.custom_id, reply))
            entries.append(
                LedgerEntry(
                    caller=batch.caller,
                    task=batch.task,
                    provider=batch.provider,
                    model_id=self._ledger_model_id(batch.provider, batch.model_id),
                    prompt_version=batch.prompt_version,
                    usage=done.usage,
                    cost_usd=cost,
                    latency_ms=0,
                    is_batch=True,
                    stop_reason=done.stop_reason,
                )
            )
        await handle(batch, outcomes)
        await self._batches.collect(org_id, batch_id, entries)
        return BatchSummary(
            batch_id,
            succeeded=len(entries),
            failed=len(outcomes) - len(entries),
            cost_usd=sum((e.cost_usd for e in entries), Decimal(0)),
        )

    # Choosing the model and building the call

    async def _route(self, org_id: UUID, task: str) -> Route:
        route = await self._catalog.route(org_id, task)
        if route is None:
            raise NoRoute(f"no model is routed for the task {task!r}")
        return route

    async def _chosen_model(self, request: LlmRequest, route: Route) -> str:
        if request.model_id is None or request.model_id == route.model_id:
            return route.model_id
        if request.task not in TEACHER_CHOICE_TASKS:
            raise ModelNotAllowed(f"the model for {request.task!r} is set by the center, not per request")
        model = await self._catalog.model(request.model_id)
        allowed = await self._catalog.allowed_model_ids(request.caller.org_id)
        if model is None or not teacher_may_use(model, allowed):
            raise ModelNotAllowed(f"{request.model_id} is not one of the center's models for teachers")
        return model.id

    async def _target(self, request: LlmRequest, route: Route, model_id: str) -> _Target:
        model = await self._catalog.model(model_id)
        if model is None or not model.enabled:
            raise ModelUnavailable(
                f"{model_id} is unknown or switched off; choose another model for {route.task}"
            )
        provider, client = self._provider_for(model)
        prompt = await self._catalog.prompt(request.task, model.family)
        if prompt is None and model.family != "any":
            prompt = await self._catalog.prompt(request.task, "any")
        if prompt is None:
            raise PromptMissing(f"no active prompt for {request.task!r}; add one in Admin → Prompts")
        return _Target(model, provider, client, prompt, self._call(request, route, model, prompt))

    def _call(self, request: LlmRequest, route: Route, model: Model, prompt: PromptTemplate) -> ModelCall:
        try:
            rendered = render_prompt(prompt.body, request.variables)
        except MissingVariable as error:
            raise LlmError(f"{prompt.label}: {error}") from error
        if request.turns:
            if request.turns[-1].role != "user":
                raise ValueError("the conversation must end with the user's turn")
            if request.images:
                raise ValueError("in a conversation, pictures go on its turns")
            system = (Segment(rendered, request.prompt_cache), *request.context)
            turns = tuple(request.turns)
        else:
            system, turns = tuple(request.context), (Turn("user", rendered, tuple(request.images)),)
        check_cache_layout(system)
        return ModelCall(
            model=model.api_model,
            system=system,
            turns=turns,
            max_tokens=min(route.max_tokens, model.max_output_tokens),
            effort=supported_effort(route.effort, model.effort_levels),
            output=request.output,
            cache_key=request.cache_key,
            task=request.task,
            variables=request.variables,
        )

    def _provider_for(self, model: Model) -> tuple[Provider, LlmProvider]:
        if not self._force_stub and model.provider != "stub":
            client = self._providers.get(model.provider)
            if client is not None:
                return model.provider, client
        if self._stub is None:
            setting = _KEY_SETTING.get(model.provider, "a key")
            raise ProviderNotConfigured(f"{model.id} needs {setting} in the AI engine's environment")
        return "stub", self._stub

    def _client(self, provider: Provider) -> LlmProvider:
        client = self._stub if provider == "stub" else self._providers.get(provider)
        if client is None:
            raise ProviderNotConfigured(f"the {provider} provider is not configured")
        return client

    async def _fallback(
        self, request: LlmRequest, route: Route, failed: _Target, error: ProviderError
    ) -> _Target | None:
        """The route's fallback model, once, after a provider outage, overload or rate limit."""
        fallback_id = route.fallback_model_id
        if not error.retryable or fallback_id is None or fallback_id == failed.model.id:
            return None
        try:
            return await self._target(request, route, fallback_id)
        except LlmError:
            return None

    async def _batch(self, org_id: UUID, batch_id: UUID) -> BatchRecord:
        batch = await self._batches.get(org_id, batch_id)
        if batch is None:
            raise BatchNotFound(f"no batch {batch_id}")
        return batch

    # Budgets and the ledger

    async def _check_budgets(self, caller: Caller) -> None:
        since, until = month_bounds(self._now())
        for budget in await self._ledger.budgets(caller.org_id, caller.user_id, since, until):
            if budget.exhausted:
                raise BudgetExceeded(budget)

    @staticmethod
    def _ledger_model_id(provider: Provider, model_id: str) -> str:
        """Stub calls are filed under "stub", so the usage page never shows a real model as free."""
        return "stub" if provider == "stub" else model_id

    async def _record(
        self, request: LlmRequest, target: _Target, done: Completion, started: float
    ) -> LlmReply:
        prices = FREE if target.provider == "stub" else target.model.prices
        cost = cost_usd(done.usage, prices)
        await self._ledger.record(
            LedgerEntry(
                caller=request.caller,
                task=request.task,
                provider=target.provider,
                model_id=self._ledger_model_id(target.provider, target.model.id),
                prompt_version=target.prompt.label,
                usage=done.usage,
                cost_usd=cost,
                latency_ms=_elapsed_ms(started),
                stop_reason=done.stop_reason,
                request_id=done.request_id,
            )
        )
        return LlmReply(
            done.text, target.model.id, target.provider, done.usage, cost, done.finish, target.prompt.label
        )

    async def _record_failure(
        self, request: LlmRequest, target: _Target, error: ProviderError, started: float
    ) -> None:
        await self._ledger.record(
            LedgerEntry(
                caller=request.caller,
                task=request.task,
                provider=target.provider,
                model_id=self._ledger_model_id(target.provider, target.model.id),
                prompt_version=target.prompt.label,
                usage=Usage(),
                cost_usd=Decimal(0),
                latency_ms=_elapsed_ms(started),
                request_id=error.request_id,
                error=str(error)[:2000],
            )
        )
