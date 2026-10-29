"""Postgres adapters for the LLM gateway. The model registry and prompts are global; routes, policy, the
ledger, budgets and batches are read and written inside the center's organization (row-level security)."""

from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal
from typing import Any, cast, get_args
from uuid import UUID

from sqlalchemy import func, insert, select, update
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncEngine

from vidyam_ai.application.llm_gateway import BatchRecord, Caller, LedgerEntry
from vidyam_ai.domain.llm import Budget, Effort, Family, Model, Prices, PromptTemplate, Provider, Route
from vidyam_ai.infrastructure.db.engine import org_transaction
from vidyam_ai.infrastructure.db.generated.tables import (
    t_llm_batches,
    t_llm_calls,
    t_llm_models,
    t_org_settings,
    t_prompt_templates,
    t_quotas,
    t_task_routes,
)

_EFFORTS = frozenset(get_args(Effort))


def _model(row: Row[Any]) -> Model:
    capabilities = cast(dict[str, Any], row.capabilities or {})
    levels = [level for level in capabilities.get("effortLevels", []) if level in _EFFORTS]
    return Model(
        id=row.id,
        provider=cast(Provider, row.provider),
        api_model=row.api_model,
        prices=Prices.parse(row.prices),
        max_output_tokens=row.max_output_tokens,
        enabled=row.enabled,
        teacher_selectable=row.teacher_selectable,
        effort_levels=tuple(cast(list[Effort], levels)),
        batch=bool(capabilities.get("batch", False)),
    )


def _other_provider_model(options: object) -> str | None:
    if not isinstance(options, dict):
        return None
    options = cast(dict[str, object], options)
    alt = options.get("altModelId")
    return alt if options.get("crossProvider") is True and isinstance(alt, str) else None


class SqlLlmCatalog:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def route(self, org_id: UUID, task: str) -> Route | None:
        query = (
            select(t_task_routes)
            .where(t_task_routes.c.task == task)
            .order_by(t_task_routes.c.org_id.is_(None))  # the center's own route before the platform default
            .limit(1)
        )
        async with org_transaction(self._engine, org_id) as conn:
            row = (await conn.execute(query)).first()
        if row is None:
            return None
        return Route(
            task=row.task,
            model_id=row.model_id,
            effort=cast(Effort, row.effort) if row.effort in _EFFORTS else None,
            max_tokens=row.max_tokens,
            fallback_model_id=row.fallback_model_id,
            other_provider_model_id=_other_provider_model(row.options),
        )

    async def model(self, model_id: str) -> Model | None:
        async with self._engine.connect() as conn:
            row = (await conn.execute(select(t_llm_models).where(t_llm_models.c.id == model_id))).first()
        return _model(row) if row else None

    async def allowed_model_ids(self, org_id: UUID) -> list[str]:
        query = select(t_org_settings.c.ai_policy).where(t_org_settings.c.org_id == org_id)
        async with org_transaction(self._engine, org_id) as conn:
            policy = (await conn.execute(query)).scalar()
        return [str(i) for i in cast(dict[str, Any], policy or {}).get("allowedModelIds", [])]

    async def prompt(self, task: str, family: Family) -> PromptTemplate | None:
        t = t_prompt_templates
        query = (
            select(t.c.version, t.c.body)
            .where(t.c.name == task, t.c.model_family == family, t.c.is_active)
            .order_by(t.c.version.desc())
            .limit(1)
        )
        async with self._engine.connect() as conn:
            row = (await conn.execute(query)).first()
        return PromptTemplate(task, family, row.version, row.body) if row else None


def _ledger_row(entry: LedgerEntry) -> dict[str, Any]:
    caller, usage = entry.caller, entry.usage
    return {
        "org_id": caller.org_id,
        "user_id": caller.user_id,
        "chat_session_id": caller.chat_session_id,
        "document_id": caller.document_id,
        "turn_id": caller.turn_id,
        "workflow_id": caller.workflow_id,
        "task": entry.task,
        "provider": entry.provider,
        "model_id": entry.model_id,
        "prompt_version": entry.prompt_version,
        "input_tokens": usage.input_tokens,
        "cache_write_tokens": usage.cache_write_tokens,
        "cache_read_tokens": usage.cache_read_tokens,
        "output_tokens": usage.output_tokens,
        "cost_usd": entry.cost_usd,
        "latency_ms": entry.latency_ms,
        "is_batch": entry.is_batch,
        "stop_reason": entry.stop_reason,
        "request_id": entry.request_id,
        "error": entry.error,
    }


class SqlUsageLedger:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def record(self, entry: LedgerEntry) -> None:
        async with org_transaction(self._engine, entry.caller.org_id) as conn:
            await conn.execute(insert(t_llm_calls).values(_ledger_row(entry)))

    async def budgets(
        self, org_id: UUID, user_id: UUID | None, since: datetime, until: datetime
    ) -> list[Budget]:
        calls = t_llm_calls
        in_month = (calls.c.created_at >= since, calls.c.created_at < until)
        mine = (
            t_quotas.c.user_id.is_(None)
            if user_id is None
            else t_quotas.c.user_id.is_(None) | (t_quotas.c.user_id == user_id)
        )
        async with org_transaction(self._engine, org_id) as conn:
            quotas = (
                await conn.execute(select(t_quotas.c.user_id, t_quotas.c.monthly_limit_usd).where(mine))
            ).all()
            budgets: list[Budget] = []
            for quota in quotas:
                spent = select(func.coalesce(func.sum(calls.c.cost_usd), 0)).where(*in_month)
                if quota.user_id is not None:
                    spent = spent.where(calls.c.user_id == quota.user_id)
                total = Decimal((await conn.execute(spent)).scalar_one())
                scope = "center" if quota.user_id is None else "user"
                budgets.append(Budget(scope, Decimal(quota.monthly_limit_usd), total))
        return budgets


class SqlBatchLog:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def create(self, batch: BatchRecord) -> UUID:
        caller = batch.caller
        meta = {
            "modelId": batch.model_id,
            "promptVersion": batch.prompt_version,
            "userId": str(caller.user_id) if caller.user_id else None,
            "documentId": str(caller.document_id) if caller.document_id else None,
            "workflowId": caller.workflow_id,
        }
        values = {
            "org_id": caller.org_id,
            "provider": batch.provider,
            "provider_batch_id": batch.provider_batch_id,
            "task": batch.task,
            "status": batch.status,
            "request_count": batch.request_count,
            "meta": meta,
        }
        async with org_transaction(self._engine, caller.org_id) as conn:
            return (
                await conn.execute(insert(t_llm_batches).values(values).returning(t_llm_batches.c.id))
            ).scalar_one()

    async def get(self, org_id: UUID, batch_id: UUID) -> BatchRecord | None:
        async with org_transaction(self._engine, org_id) as conn:
            row = (await conn.execute(select(t_llm_batches).where(t_llm_batches.c.id == batch_id))).first()
        if row is None:
            return None
        meta = cast(dict[str, Any], row.meta)

        def uuid_or_none(key: str) -> UUID | None:
            return UUID(meta[key]) if meta.get(key) else None

        caller = Caller(
            org_id=row.org_id,
            user_id=uuid_or_none("userId"),
            document_id=uuid_or_none("documentId"),
            workflow_id=meta.get("workflowId"),
        )
        return BatchRecord(
            caller=caller,
            provider=cast(Provider, row.provider),
            provider_batch_id=row.provider_batch_id,
            task=row.task,
            model_id=str(meta.get("modelId", "")),
            prompt_version=str(meta.get("promptVersion", "")),
            request_count=row.request_count,
            status=row.status,
            id=row.id,
        )

    async def mark_ended(self, org_id: UUID, batch_id: UUID) -> None:
        t = t_llm_batches
        async with org_transaction(self._engine, org_id) as conn:
            await conn.execute(
                update(t)
                .where(t.c.id == batch_id, t.c.status == "running")
                .values(status="ended", ended_at=func.now())
            )

    async def collect(self, org_id: UUID, batch_id: UUID, entries: Sequence[LedgerEntry]) -> bool:
        t = t_llm_batches
        async with org_transaction(self._engine, org_id) as conn:
            claimed = (
                await conn.execute(
                    update(t)
                    .where(t.c.id == batch_id, t.c.collected_at.is_(None))
                    .values(
                        status="collected",
                        collected_at=func.now(),
                        ended_at=func.coalesce(t.c.ended_at, func.now()),
                    )
                    .returning(t.c.id)
                )
            ).first()
            if claimed is None:
                return False
            if entries:
                await conn.execute(insert(t_llm_calls), [_ledger_row(entry) for entry in entries])
        return True
