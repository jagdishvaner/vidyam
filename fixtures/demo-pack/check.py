"""Checks the demo pack's questions and evaluation queries against the contracts and the pack's own rules.

pnpm demo:check                  # everything
pnpm demo:check -- --only motion # question files and query files whose name contains "motion"
"""

import argparse
import json
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from vidyam_ai.generated.contracts import QuestionImport, SyllabusImport, SyllabusNodeImport

PACK = Path(__file__).parent
QUESTION_FILES = {  # chapter code → how many questions the pack holds for it (200 in all)
    "motion": 23,
    "force_and_laws_of_motion": 23,
    "work_and_energy": 22,
    "light_reflection_refraction": 22,
    "electricity": 22,
    "acids_bases_salts": 22,
    "carbon_compounds": 22,
    "cell": 22,
    "life_processes": 22,
}


def syllabus_paths() -> dict[str, str]:
    """Every code path in the demo syllabus → its level."""
    tree = SyllabusImport.model_validate_json((PACK / "catalog" / "syllabus-science.json").read_text())
    paths: dict[str, str] = {}

    def walk(node: SyllabusNodeImport, prefix: str) -> None:
        path = f"{prefix}/{node.code}" if prefix else node.code
        paths[path] = node.level.value
        for child in node.children:
            walk(child, path)

    walk(tree.subject, "")
    return paths


def _norm(text: str) -> str:
    return " ".join(unicodedata.normalize("NFC", text).split())


def check_questions(chapter: str, expected_count: int, paths: dict[str, str]) -> list[str]:
    errors: list[str] = []
    path = PACK / "questions" / f"{chapter}.json"
    if not path.exists():
        return [f"{path.name}: missing"]
    items: list[dict[str, Any]] = json.loads(path.read_text())
    if len(items) != expected_count:
        errors.append(f"{path.name}: {len(items)} questions, expected {expected_count}")
    chapter_path = next(p for p, level in paths.items() if level == "chapter" and p.endswith("/" + chapter))
    topics = {p for p, level in paths.items() if level == "topic" and p.startswith(chapter_path + "/")}
    covered: Counter[str] = Counter()
    answers: Counter[str] = Counter()
    for item in items:
        ref = item.get("ref", "?")
        try:
            question = QuestionImport.model_validate(item)
        except ValidationError as error:
            errors.append(f"{ref}: {error}".replace("\n", " "))
            continue
        for node in question.taxonomy:
            if node.root not in paths:
                errors.append(f"{ref}: unknown syllabus node {node.root}")
        primary = question.taxonomy[0].root
        if primary not in topics:
            errors.append(f"{ref}: first taxonomy entry must be a topic of {chapter_path}")
        covered[primary] += 1
        hi, en = question.content.hi, question.content.en
        if hi is None or en is None:
            errors.append(f"{ref}: needs both Hindi and English")
            continue
        answer = question.answer.root
        if question.qtype.value == "numerical":
            if answer.kind != "numeric" or hi.options or en.options:
                errors.append(f"{ref}: a numerical question has no options and a numeric answer")
        else:
            keys = [o.key for o in en.options]
            if keys != ["A", "B", "C", "D"] or [o.key for o in hi.options] != keys:
                errors.append(f"{ref}: options must be A, B, C, D in both languages")
            if answer.kind != "options" or len(answer.keys) != 1 or answer.keys[0] not in keys:
                errors.append(f"{ref}: exactly one correct option")
            else:
                answers[answer.keys[0]] += 1
        for text in (hi.stem, en.stem, *(o.text for o in hi.options + en.options)):
            if "$" in text or "**" in text:
                errors.append(f"{ref}: plain Unicode only, no LaTeX or Markdown ({text[:40]!r})")
                break
        if not (hi.solution and en.solution):
            errors.append(f"{ref}: a short solution in both languages")
    thin = sorted(t for t in topics if covered[t] < 3)
    if thin:
        errors.append(f"{path.name}: each topic needs at least 3 questions: {thin}")
    if answers and max(answers.values()) - min(answers[k] for k in "ABCD") > 3:
        errors.append(f"{path.name}: correct options are unbalanced {dict(answers)}")
    refs = [item.get("ref") for item in items]
    if len(set(refs)) != len(refs):
        errors.append(f"{path.name}: duplicate refs")
    return errors


def check_queries(path: Path, paths: dict[str, str]) -> list[str]:
    errors: list[str] = []
    queries: list[dict[str, Any]] = json.loads(path.read_text())
    for query in queries:
        qid = query.get("id", "?")
        missing = {"id", "query", "lang", "node", "expect"} - query.keys()
        if missing:
            errors.append(f"{qid}: missing {sorted(missing)}")
            continue
        if query["lang"] not in {"hi", "en", "hinglish"}:
            errors.append(f"{qid}: lang is hi, en or hinglish")
        if query["node"] not in paths:
            errors.append(f"{qid}: unknown syllabus node {query['node']}")
        for expect in query["expect"]:
            source = PACK / "texts" / (Path(expect["file"]).stem + ".md")
            if not source.exists():
                errors.append(f"{qid}: no source text for {expect['file']}")
                continue
            if len(expect["phrase"].split()) < 4:
                errors.append(f"{qid}: phrase should be at least 4 words")
            if _norm(expect["phrase"]) not in _norm(source.read_text()):
                errors.append(f"{qid}: phrase not found verbatim in {source.name}: {expect['phrase'][:50]!r}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--only", help="check only files whose name contains this")
    args = parser.parse_args()
    paths = syllabus_paths()
    errors: list[str] = []
    for chapter, count in QUESTION_FILES.items():
        if args.only is None or args.only in chapter:
            errors += check_questions(chapter, count, paths)
    for path in sorted((PACK / "eval").glob("retrieval*.json")):
        if args.only is None or args.only in path.name:
            errors += check_queries(path, paths)
    for error in errors:
        print(error, file=sys.stderr)
    print("ok" if not errors else f"{len(errors)} problem(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
