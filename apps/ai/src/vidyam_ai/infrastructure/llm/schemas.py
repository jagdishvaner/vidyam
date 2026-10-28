"""JSON Schemas for structured outputs, adapted to what each provider accepts (plan v3 §11: Claude and OpenAI
accept different subsets). The schemas come from Pydantic models; constraints a provider can't enforce are
dropped here and still checked when the reply is validated against the model.

- Claude: every object closed (additionalProperties: false); no recursion; no numeric, string-length or
  complex array constraints; a limited set of string formats.
- OpenAI strict mode: every object closed with every property required (optional ones become nullable); no
  defaults or length limits.

`anthropic_problems` / `openai_problems` list what a provider would reject (the offline compatibility test).
The nulls OpenAI returns for optional properties are dropped by domain.json_schema.drop_disallowed_nulls.
"""

import copy
import json
import re
import uuid
from collections.abc import Callable, Iterator, Mapping
from typing import Any, cast

from vidyam_ai.domain.json_schema import resolve as _resolve

type Json = dict[str, Any]

_DROPPED_EVERYWHERE = frozenset({"title", "default", "examples", "discriminator", "readOnly", "writeOnly"})
_ANTHROPIC_DROPPED = frozenset(
    {
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
        "minLength",
        "maxLength",
        "pattern",
        "maxItems",
        "uniqueItems",
        "minProperties",
        "maxProperties",
        "patternProperties",
        "propertyNames",
    }
)
_ANTHROPIC_FORMATS = frozenset(
    {"date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"}
)
_OPENAI_DROPPED = frozenset(
    {
        "minLength",
        "maxLength",
        "uniqueItems",
        "minProperties",
        "maxProperties",
        "patternProperties",
        "propertyNames",
    }
)
_OPENAI_FORMATS = frozenset(
    {"date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"}
)


def anthropic_schema(schema: Mapping[str, Any]) -> Json:
    def adapt(node: Json) -> None:
        for key in _ANTHROPIC_DROPPED & node.keys():
            del node[key]
        if node.get("minItems", 0) > 1:
            node["minItems"] = 1  # only 0 or 1 is accepted
        if "format" in node and node["format"] not in _ANTHROPIC_FORMATS:
            del node["format"]

    return _transform(schema, adapt)


def openai_strict_schema(schema: Mapping[str, Any]) -> Json:
    def adapt(node: Json) -> None:
        for key in _OPENAI_DROPPED & node.keys():
            del node[key]
        if "format" in node and node["format"] not in _OPENAI_FORMATS:
            del node["format"]
        properties = cast(Json, node.get("properties", {}))
        if node.get("type") == "object" and properties:
            required = set(cast(list[str], node.get("required", [])))
            for name, prop in properties.items():
                if name not in required:
                    properties[name] = _nullable(cast(Json, prop))
            node["required"] = list(properties)

    return _transform(schema, adapt)


def anthropic_problems(schema: Mapping[str, Any]) -> list[str]:
    problems = _common_problems(schema)
    if _is_recursive(schema):
        problems.append("recursive schema")
    for path, node in _nodes(cast(Json, schema)):
        problems += [f"{path}: {key}" for key in _ANTHROPIC_DROPPED & node.keys()]
        if node.get("minItems", 0) > 1:
            problems.append(f"{path}: minItems above 1")
        if "format" in node and node["format"] not in _ANTHROPIC_FORMATS:
            problems.append(f"{path}: format {node['format']}")
    return problems


def openai_problems(schema: Mapping[str, Any]) -> list[str]:
    problems = _common_problems(schema)
    if schema.get("type") != "object":
        problems.append("the root must be an object")
    for path, node in _nodes(cast(Json, schema)):
        problems += [f"{path}: {key}" for key in _OPENAI_DROPPED & node.keys()]
        if "format" in node and node["format"] not in _OPENAI_FORMATS:
            problems.append(f"{path}: format {node['format']}")
        properties = cast(Json, node.get("properties", {}))
        missing = set(properties) - set(cast(list[str], node.get("required", [])))
        if missing:
            problems.append(f"{path}: not required: {', '.join(sorted(missing))}")
    return problems


def example(schema: Mapping[str, Any], *, seed: str = "") -> Any:
    """A small value that follows the schema: the stub model's answer when a reply needs structure."""
    defs = cast(Json, schema.get("$defs", {}))

    def build(node: Mapping[str, Any], path: str, depth: int) -> Any:
        node = _resolve(node, defs)
        if "const" in node:
            return node["const"]
        if "enum" in node:
            return cast(list[Any], node["enum"])[0]
        for key in ("anyOf", "oneOf"):
            options = [o for o in cast(list[Json], node.get(key, [])) if o.get("type") != "null"]
            if options:
                return build(options[0], path, depth)
        if "allOf" in node:
            merged: Json = {}
            for part in cast(list[Json], node["allOf"]):
                merged.update(_resolve(part, defs))
            return build(merged, path, depth)
        kind = node.get("type")
        if isinstance(kind, list):
            kind = next((k for k in cast(list[str], kind) if k != "null"), "null")
        if kind == "object" or "properties" in node:
            if depth > 12:
                return {}
            properties = cast(Json, node.get("properties", {}))
            return {
                name: build(cast(Json, prop), f"{path}.{name}", depth + 1)
                for name, prop in properties.items()
            }
        if kind == "array":
            count = max(1, int(node.get("minItems", 1)))
            if "maxItems" in node:
                count = min(count, int(node["maxItems"]))
            items = cast(Json, node.get("items", {}))
            return (
                [build(items, f"{path}[{i}]", depth + 1) for i in range(count)] if depth <= 4 else []
            )  # recursive schemas end at an empty list
        if kind in ("integer", "number"):
            low = node.get("minimum", node.get("exclusiveMinimum", 0))
            value = max(0, low) + (1 if "exclusiveMinimum" in node else 0)
            if "maximum" in node:
                value = min(value, node["maximum"])
            return int(value) if kind == "integer" else float(value)
        if kind == "boolean":
            return False
        if kind == "null":
            return None
        return _example_string(node, f"{seed}{path}")

    return build(schema, "", 0)


# Values that satisfy the simple patterns contracts use (set codes, page ranges, months, slugs, codes).
_PATTERN_CANDIDATES = ("stub", "A", "1", "1-4", "2026-01", "2026", "a", "stub_code", "stub-code", "1.0.0")


def _example_string(node: Mapping[str, Any], path: str) -> str:
    fmt = node.get("format")
    if fmt == "uuid":
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"vidyam-stub:{path}"))
    if fmt == "date-time":
        return "2026-01-01T00:00:00+05:30"
    if fmt == "date":
        return "2026-01-01"
    if fmt == "email":
        return "stub@example.com"
    if fmt in ("uri", "url"):
        return "https://example.com/stub"
    pattern = node.get("pattern")
    if isinstance(pattern, str):
        return next((c for c in _PATTERN_CANDIDATES if re.search(pattern, c)), "stub")
    text = "stub"
    return text.ljust(int(node.get("minLength", 0)), "x")[: int(node.get("maxLength", 10_000))]


# Shared helpers


def _transform(schema: Mapping[str, Any], adapt: Callable[[Json], None]) -> Json:
    """A copy with every schema node closed, cleaned and passed through `adapt`."""
    root = copy.deepcopy(dict(schema))
    for _, node in _nodes(root):
        for key in _DROPPED_EVERYWHERE & node.keys():
            del node[key]
        if "$ref" in node:
            for key in [k for k in node if k not in ("$ref", "$defs")]:
                del node[key]  # siblings of $ref are rejected; the definition carries the description
            continue
        all_of = node.get("allOf")
        if isinstance(all_of, list) and len(cast(list[Any], all_of)) == 1:
            del node["allOf"]
            node.update(cast(Json, all_of[0]))
        if node.get("type") == "object" or "properties" in node:
            node.setdefault("type", "object")
            node["additionalProperties"] = False
            node.setdefault("properties", {})
        adapt(node)
    return root


def _nodes(root: Json, path: str = "#") -> Iterator[tuple[str, Json]]:
    """Every schema node, parents before children. Children are reached through the dicts in place, so
    changing a node while iterating changes the schema."""
    yield path, root
    for key in ("properties", "$defs", "definitions", "patternProperties"):
        children = root.get(key)
        if isinstance(children, dict):
            for name, child in cast(Json, children).items():
                if isinstance(child, dict):
                    yield from _nodes(cast(Json, child), f"{path}/{key}/{name}")
    for key in ("items", "additionalProperties", "not"):
        child = root.get(key)
        if isinstance(child, dict):
            yield from _nodes(cast(Json, child), f"{path}/{key}")
    for key in ("anyOf", "oneOf", "allOf", "prefixItems"):
        options = root.get(key)
        if isinstance(options, list):
            for i, child in enumerate(cast(list[Any], options)):
                if isinstance(child, dict):
                    yield from _nodes(cast(Json, child), f"{path}/{key}/{i}")


def _common_problems(schema: Mapping[str, Any]) -> list[str]:
    problems: list[str] = []
    for path, node in _nodes(cast(Json, schema)):
        if "$ref" in node and set(node) - {"$ref", "$defs"}:
            problems.append(f"{path}: keywords beside $ref")
        is_object = node.get("type") == "object" or "properties" in node
        if is_object and node.get("additionalProperties") is not False:
            problems.append(f"{path}: object not closed")
        problems += [f"{path}: {key}" for key in ("default", "discriminator") if key in node]
        if "allOf" in node:
            problems.append(f"{path}: allOf")
    return problems


def _is_recursive(schema: Mapping[str, Any]) -> bool:
    defs = cast(Json, schema.get("$defs", {}))

    def refs(node: Any) -> set[str]:
        text = json.dumps(node)
        return {name for name in defs if f'"#/$defs/{name}"' in text}

    graph = {name: refs(body) for name, body in defs.items()}

    def cycle(name: str, seen: frozenset[str]) -> bool:
        return name in seen or any(cycle(n, seen | {name}) for n in graph[name])

    return any(cycle(name, frozenset()) for name in graph)


def _nullable(prop: Json) -> Json:
    if prop.get("type") == "null" or any(
        o.get("type") == "null" for o in cast(list[Json], prop.get("anyOf", []))
    ):
        return prop
    scalar = prop.get("type") in ("string", "integer", "number", "boolean", "array")
    if scalar and "$ref" not in prop and "enum" not in prop:
        return {**prop, "type": [prop["type"], "null"]}
    return {"anyOf": [prop, {"type": "null"}]}
