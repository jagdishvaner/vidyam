"""Measuring retrieval against queries with known answers (plan v3 step 21, §10). Pure; no I/O.

A query names the passage that answers it: a file, and a phrase that appears in that file verbatim. A
retrieved passage answers when it comes from that file and contains the phrase, ignoring whitespace (or half
of it, when the phrase runs over a chunk boundary).

What is measured:

- **recall@20**, the plan's target (≥ 0.9): the answer is among the first 20 candidates hybrid search hands
  to the reranker. What search never finds, reranking can't fix.
- **within the chapter**: the same, searching only the answer's chapter, as a teacher who picked it would.
  This also checks that the passage was tagged to the right chapter.
- **the picks**: the answer is among the passages retrieval returns (after reranking and the cut-off), and
  where: found, first, and the mean reciprocal rank.
- **questions the material doesn't answer** should come back with nothing.

A query whose answer file has nothing searchable yet (a scan waiting for OCR) can't be found by any search;
it is reported apart and left out of the rates.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any, Literal
from uuid import UUID

from vidyam_ai.domain.sections import SyllabusNode

TARGET_RECALL_AT_20 = 0.9
RECALL_AT = (1, 5, 10, 20)


@dataclass(frozen=True)
class Expected:
    file: str
    phrase: str


@dataclass(frozen=True)
class EvalQuery:
    id: str
    query: str
    lang: str  # hi, en, hinglish
    node: str | None = None  # the syllabus path the answer belongs to
    expect: tuple[Expected, ...] = ()  # empty: the material doesn't answer it


def parse_queries(raw: Sequence[Mapping[str, Any]]) -> list[EvalQuery]:
    """The demo pack's format: `{id, query, lang, node, expect: [{file, phrase}]}`; `node` and `expect` are
    left out for questions the material doesn't answer."""
    return [
        EvalQuery(
            id=str(item["id"]),
            query=str(item["query"]),
            lang=str(item["lang"]),
            node=item.get("node"),
            expect=tuple(Expected(str(e["file"]), str(e["phrase"])) for e in item.get("expect", [])),
        )
        for item in raw
    ]


def _flat(text: str) -> str:
    return "".join(text.split())


def file_name(path: str) -> str:
    return PurePosixPath(path).name


def answers(expected: Sequence[Expected], filename: str, text: str) -> bool:
    flat = _flat(text)
    for item in expected:
        if file_name(item.file) != file_name(filename):
            continue
        phrase = _flat(item.phrase)
        half = max(len(phrase) // 2, 1)
        if phrase in flat or phrase[:half] in flat or phrase[-half:] in flat:
            return True
    return False


def chapters(nodes: Sequence[SyllabusNode]) -> dict[str, UUID]:
    """Each syllabus path → the chapter it belongs to (itself, for a chapter)."""
    by_path = {node.path: node for node in nodes}
    result: dict[str, UUID] = {}
    for node in nodes:
        parts = node.path.split("/")
        for end in range(len(parts), 0, -1):
            above = by_path.get("/".join(parts[:end]))
            if above is not None and above.level == "chapter":
                result[node.path] = above.id
                break
    return result


Status = Literal["answerable", "waiting", "unanswerable"]


@dataclass(frozen=True)
class Outcome:
    query: EvalQuery
    status: Status  # waiting: the answer's file has nothing searchable yet
    candidate_rank: int | None  # where the answer is among the fused candidates, from 1
    chapter_rank: int | None  # the same, searching only the answer's chapter
    pick_rank: int | None  # among the passages returned
    picks: int
    top_relevance: float | None  # the first pick's reranker score
    timings_ms: Mapping[str, float] = field(default_factory=dict[str, float])


@dataclass(frozen=True)
class Rates:
    queries: int
    recall_at: dict[int, float]
    chapter_recall_at_20: float | None  # None when no query names a chapter
    found: float  # an answer among the picks
    first: float
    mrr: float


def _share(count: int, total: int) -> float:
    return count / total if total else 0.0


def rates(outcomes: Sequence[Outcome]) -> Rates:
    """Over answerable queries only."""
    scored = [o for o in outcomes if o.status == "answerable"]
    total = len(scored)
    scoped = [o for o in scored if o.query.node]
    return Rates(
        queries=total,
        recall_at={
            k: _share(sum(1 for o in scored if o.candidate_rank and o.candidate_rank <= k), total)
            for k in RECALL_AT
        },
        chapter_recall_at_20=(
            _share(sum(1 for o in scoped if o.chapter_rank and o.chapter_rank <= 20), len(scoped))
            if scoped
            else None
        ),
        found=_share(sum(1 for o in scored if o.pick_rank), total),
        first=_share(sum(1 for o in scored if o.pick_rank == 1), total),
        mrr=sum(1 / o.pick_rank for o in scored if o.pick_rank) / total if total else 0.0,
    )


def percentile(values: Sequence[float], share: float) -> float:
    """Nearest-rank percentile (share 0–1)."""
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[max(0, math.ceil(share * len(ordered)) - 1)]


@dataclass(frozen=True)
class Summary:
    overall: Rates
    by_language: dict[str, Rates]
    waiting: list[str]  # ids of queries whose answer can't be searched yet
    unanswerable: int
    rejected: int  # unanswerable queries that came back with nothing
    latency_ms: dict[str, tuple[float, float]]  # stage → (median, 95th percentile)
    reranked: bool

    @property
    def meets_target(self) -> bool:
        return self.overall.recall_at[20] >= TARGET_RECALL_AT_20


def _spread(values: Sequence[float]) -> tuple[float, float]:
    return percentile(values, 0.5), percentile(values, 0.95)


def summarize(outcomes: Sequence[Outcome], *, reranked: bool) -> Summary:
    languages = sorted({o.query.lang for o in outcomes if o.status == "answerable"})
    stages = list(dict.fromkeys(stage for o in outcomes for stage in o.timings_ms))  # pipeline order
    unanswerable = [o for o in outcomes if o.status == "unanswerable"]
    return Summary(
        overall=rates(outcomes),
        by_language={lang: rates([o for o in outcomes if o.query.lang == lang]) for lang in languages},
        waiting=[o.query.id for o in outcomes if o.status == "waiting"],
        unanswerable=len(unanswerable),
        rejected=sum(1 for o in unanswerable if o.picks == 0),
        latency_ms={
            stage: _spread([o.timings_ms[stage] for o in outcomes if stage in o.timings_ms])
            for stage in stages
        },
        reranked=reranked,
    )


def _pct(value: float | None) -> str:
    return "–" if value is None else f"{value:.0%}"


def _rank(rank: int | None) -> str:
    return str(rank) if rank else "–"


def report(summary: Summary, outcomes: Sequence[Outcome], *, title: str) -> str:
    """The summary as Markdown, with every query whose answer wasn't picked first."""
    head = "| | Queries | recall@1 | @5 | @10 | @20 | @20 in chapter | Found | First | MRR |"
    lines = [f"# {title}", "", head, "| - | -: | -: | -: | -: | -: | -: | -: | -: | -: |"]
    for name, row in [("All", summary.overall), *summary.by_language.items()]:
        recall = [_pct(row.recall_at[k]) for k in RECALL_AT]
        found = [_pct(row.found), _pct(row.first), f"{row.mrr:.2f}"] if summary.reranked else ["–"] * 3
        cells = [name, str(row.queries), *recall, _pct(row.chapter_recall_at_20), *found]
        lines.append("| " + " | ".join(cells) + " |")
    verdict = "meets" if summary.meets_target else "misses"
    lines += [
        "",
        f"recall@20 {_pct(summary.overall.recall_at[20])} {verdict} the target of {TARGET_RECALL_AT_20:.0%}.",
        "Found / First / MRR: the answer among the passages returned (after reranking), and where.",
    ]
    if summary.unanswerable:
        empty = f"{summary.rejected} of {summary.unanswerable}"
        lines.append(f"Questions the material doesn't answer: {empty} came back empty.")
    if summary.waiting:
        lines.append(
            f"Not counted, their file has nothing searchable yet (OCR): {', '.join(summary.waiting)}."
        )
    if summary.latency_ms:
        timings = ", ".join(f"{s} {p50:.0f} / {p95:.0f} ms" for s, (p50, p95) in summary.latency_ms.items())
        lines.append(f"Time per query (median / 95th percentile): {timings}.")
    misses = [
        o
        for o in outcomes
        if (o.status == "answerable" and o.pick_rank != 1) or (o.status == "unanswerable" and o.picks)
    ]
    if misses:
        lines += [
            "",
            "| Query | Lang | Candidate | In chapter | Pick | Top score | Text |",
            "| - | - | -: | -: | -: | -: | - |",
        ]
        for o in misses:
            score = "–" if o.top_relevance is None else f"{o.top_relevance:.2f}"
            text = o.query.query.replace("|", "/")
            cells = [o.query.id, o.query.lang, _rank(o.candidate_rank), _rank(o.chapter_rank)]
            lines.append("| " + " | ".join([*cells, _rank(o.pick_rank), score, text]) + " |")
    return "\n".join(lines) + "\n"
