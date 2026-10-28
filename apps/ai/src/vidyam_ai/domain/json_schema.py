"""Small helpers for the JSON Schemas of structured replies. Pure; no I/O."""

from collections.abc import Mapping
from typing import Any, cast


def resolve(node: Mapping[str, Any], defs: Mapping[str, Any]) -> Mapping[str, Any]:
    """Follows a local `#/$defs/...` reference; any other node is returned as it is."""
    ref = node.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/$defs/"):
        return cast(Mapping[str, Any], defs[ref.removeprefix("#/$defs/")])
    return node


def drop_disallowed_nulls(value: Any, schema: Mapping[str, Any]) -> Any:
    """Removes optional properties that came back null where the schema doesn't allow null, so the model's
    default applies. OpenAI's strict mode makes every property required, so optional ones are sent as nullable
    and come back as null."""
    defs = cast(Mapping[str, Any], schema.get("$defs", {}))

    def walk(item: object, node: Mapping[str, Any]) -> object:
        node = resolve(node, defs)
        obj, items = _as_object(item), _as_list(item)
        if obj is not None and "properties" in node:
            properties = cast(Mapping[str, Any], node["properties"])
            required = set(cast(list[str], node.get("required", [])))
            out: dict[str, Any] = {}
            for key, sub in obj.items():
                prop = properties.get(key)
                if prop is None:
                    out[key] = sub
                elif sub is None and key not in required and not _allows_null(prop, defs):
                    continue
                else:
                    out[key] = walk(sub, prop)
            return out
        if items is not None and isinstance(node.get("items"), Mapping):
            return [walk(sub, cast(Mapping[str, Any], node["items"])) for sub in items]
        for option in cast(list[Mapping[str, Any]], node.get("anyOf", [])):
            if option.get("type") != "null" and _same_shape(item, resolve(option, defs)):
                return walk(item, option)
        return item

    return cast(Any, walk(value, schema))


def _as_object(item: object) -> dict[str, Any] | None:
    return cast(dict[str, Any], item) if isinstance(item, dict) else None


def _as_list(item: object) -> list[Any] | None:
    return cast(list[Any], item) if isinstance(item, list) else None


def _allows_null(prop: Mapping[str, Any], defs: Mapping[str, Any]) -> bool:
    node = resolve(prop, defs)
    kind = node.get("type")
    if kind == "null" or (isinstance(kind, list) and "null" in kind):
        return True
    return any(_allows_null(option, defs) for option in cast(list[Mapping[str, Any]], node.get("anyOf", [])))


def _same_shape(item: object, node: Mapping[str, Any]) -> bool:
    if _as_object(item) is not None:
        return node.get("type") == "object" or "properties" in node
    if _as_list(item) is not None:
        return node.get("type") == "array"
    return False
