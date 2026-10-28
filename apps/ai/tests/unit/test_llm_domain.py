from datetime import UTC, datetime
from decimal import Decimal

import pytest
from vidyam_ai.domain.llm import (
    MissingVariable,
    Model,
    Prices,
    Segment,
    Usage,
    check_cache_layout,
    cost_usd,
    month_bounds,
    render_prompt,
    supported_effort,
    teacher_may_use,
    valid_custom_id,
)

OPUS = Prices.parse(
    {"input": "4", "output": "20", "cache_read": "0.20", "cache_write_5m": "5", "cache_write_1h": "8"}
)
HAIKU = Prices.parse(
    {
        "input": "0.10",
        "output": "0.50",
        "cache_read": "0.01",
        "cache_write_5m": "0.125",
        "cache_write_1h": "0.20",
        "long_context_threshold": 100_000,
        "long_context_input": "0.50",
        "long_context_output": "2.50",
    }
)


def test_cost_counts_every_kind_of_token_at_its_own_price() -> None:
    usage = Usage(
        input_tokens=1_000,
        cache_read_tokens=10_000,
        cache_write_5m_tokens=2_000,
        cache_write_1h_tokens=3_000,
        output_tokens=500,
    )
    # 1000*4 + 10000*0.2 + 2000*5 + 3000*8 + 500*20 = 50,000 per million
    assert cost_usd(usage, OPUS) == Decimal("0.050000")


def test_batch_calls_cost_half() -> None:
    usage = Usage(input_tokens=1_000_000, output_tokens=100_000)
    assert cost_usd(usage, OPUS) == Decimal("6.000000")
    assert cost_usd(usage, OPUS, batch=True) == Decimal("3.000000")


def test_long_prompts_switch_to_long_context_prices() -> None:
    short = Usage(input_tokens=100_000, output_tokens=1_000)
    long = Usage(input_tokens=60_000, cache_read_tokens=50_000, output_tokens=1_000)
    assert cost_usd(short, HAIKU) == Decimal("0.010500")  # 100000*0.10 + 1000*0.50
    # 110K prompt tokens: input 0.50, cache reads scaled 5x (0.05), output 2.50
    assert cost_usd(long, HAIKU) == Decimal("0.035000")


def test_missing_cache_prices_fall_back_to_the_input_price() -> None:
    prices = Prices.parse({"input": 2, "output": 10})
    assert prices.cache_read == prices.cache_write_1h == Decimal(2)
    with pytest.raises(ValueError, match="input and output"):
        Prices.parse({"input": 1})


def test_effort_falls_back_to_the_nearest_level_the_model_offers() -> None:
    gpt = ("low", "medium", "high")
    assert supported_effort("high", gpt) == "high"
    assert supported_effort("max", gpt) == "high"
    assert supported_effort("xhigh", ("medium", "max")) == "medium"
    assert supported_effort("low", ("high", "max")) == "high"
    assert supported_effort(None, gpt) is None
    assert supported_effort("high", ()) is None


def test_teachers_may_use_selectable_models_the_center_allows() -> None:
    opus = Model("claude-opus-5-5", "anthropic", "claude-opus-5-5", OPUS, 128_000, teacher_selectable=True)
    haiku = Model("claude-haiku-5-5", "anthropic", "claude-haiku-5-5", HAIKU, 128_000)
    assert teacher_may_use(opus, [])
    assert teacher_may_use(opus, ["claude-opus-5-5"])
    assert not teacher_may_use(opus, ["gpt-6-astra"])
    assert not teacher_may_use(haiku, [])
    assert not teacher_may_use(Model(**{**opus.__dict__, "enabled": False}), [])


def test_budget_months_run_in_india_time() -> None:
    # 20:00 UTC on 31 October is already 1 November in India.
    start, end = month_bounds(datetime(2026, 10, 31, 20, 0, tzinfo=UTC))
    assert start.isoformat() == "2026-11-01T00:00:00+05:30"
    assert end.isoformat() == "2026-12-01T00:00:00+05:30"
    start, end = month_bounds(datetime(2026, 12, 15, tzinfo=UTC))
    assert (start.month, end.year, end.month) == (12, 2027, 1)


def test_prompts_fill_every_placeholder_or_fail() -> None:
    assert render_prompt(
        "Title in {{language}}: {{ first_message }}", {"language": "Hindi", "first_message": "x"}
    ) == ("Title in Hindi: x")
    with pytest.raises(MissingVariable, match="language"):
        render_prompt("{{language}}", {})


def test_one_hour_cache_blocks_come_first() -> None:
    check_cache_layout(
        [Segment("rules", "1h"), Segment("style", "1h"), Segment("evidence", "5m"), Segment("x")]
    )
    with pytest.raises(ValueError, match="1-hour"):
        check_cache_layout([Segment("evidence", "5m"), Segment("rules", "1h")])


def test_batch_ids_follow_the_providers_rules() -> None:
    assert valid_custom_id("page-12_ocr")
    assert not valid_custom_id("page 12")
    assert not valid_custom_id("x" * 65)
