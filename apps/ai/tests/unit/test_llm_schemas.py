"""Offline schema compatibility (plan v3 §11): every contract, adapted for Claude and for OpenAI's strict
mode, uses only what that provider accepts; the stub model's answers validate; and the nulls strict mode
returns for optional fields are dropped again before validation."""

import inspect
import json
from typing import Any

import pytest
from pydantic import BaseModel, RootModel
from vidyam_ai.domain.json_schema import drop_disallowed_nulls
from vidyam_ai.generated import contracts
from vidyam_ai.infrastructure.llm.schemas import (
    anthropic_problems,
    anthropic_schema,
    example,
    openai_problems,
    openai_strict_schema,
)

CONTRACTS = [
    cls
    for _, cls in inspect.getmembers(contracts, inspect.isclass)
    if issubclass(cls, BaseModel) and cls.__module__ == contracts.__name__ and not issubclass(cls, RootModel)
]
# Admin import formats, never asked of a model: a syllabus tree nests to any depth.
KNOWN_PROBLEMS = {
    "SyllabusImport": (["recursive schema"], []),
    "SyllabusNodeImport": (["recursive schema"], ["the root must be an object"]),
}


def schema_of(model: type[BaseModel]) -> dict[str, Any]:
    return model.model_json_schema(by_alias=True)


@pytest.mark.parametrize("model", CONTRACTS, ids=lambda m: m.__name__)
def test_every_contract_adapts_to_both_providers(model: type[BaseModel]) -> None:
    schema = schema_of(model)
    for_claude, for_openai = KNOWN_PROBLEMS.get(model.__name__, ([], []))
    assert anthropic_problems(anthropic_schema(schema)) == for_claude
    assert openai_problems(openai_strict_schema(schema)) == for_openai


@pytest.mark.parametrize("model", CONTRACTS, ids=lambda m: m.__name__)
def test_the_stub_answers_every_contract_validly(model: type[BaseModel]) -> None:
    model.model_validate_json(json.dumps(example(schema_of(model))))


@pytest.mark.parametrize("model", CONTRACTS, ids=lambda m: m.__name__)
def test_nulls_for_optional_fields_fall_back_to_defaults(model: type[BaseModel]) -> None:
    schema = schema_of(model)
    reply = example(schema)
    for name in set(schema.get("properties", {})) - set(schema.get("required", [])):
        reply[name] = None  # what OpenAI's strict mode sends for an optional field it leaves out
    model.model_validate(drop_disallowed_nulls(reply, schema))


def test_the_checks_catch_what_providers_reject() -> None:
    schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string", "minLength": 1},
            "child": {"$ref": "#/$defs/Node", "description": "x"},
        },
        "$defs": {
            "Node": {
                "type": "object",
                "properties": {"kids": {"type": "array", "items": {"$ref": "#/$defs/Node"}}},
            }
        },
    }
    claude = anthropic_problems(schema)
    assert "recursive schema" in claude
    assert "#: object not closed" in claude
    assert "#/properties/name: minLength" in claude
    assert "#/properties/child: keywords beside $ref" in claude
    assert "#: not required: child, name" in openai_problems(schema)


def test_adapting_never_changes_the_original_schema() -> None:
    schema = schema_of(contracts.PaperSpec)
    before = json.dumps(schema, sort_keys=True)
    anthropic_schema(schema)
    openai_strict_schema(schema)
    assert json.dumps(schema, sort_keys=True) == before
