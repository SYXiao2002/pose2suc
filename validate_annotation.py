#!/usr/bin/env python3
"""Validate frozen grasp v1.0, including its semantic schema extensions (stdlib only)."""

import argparse
import json
import math
from pathlib import Path
import re
import sys

SCHEMA_PATH = Path(__file__).parent / "schema/grasp_annotation.schema.json"


def is_number(value):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def is_vector(value):
    return isinstance(value, list) and len(value) == 3 and all(is_number(x) for x in value)


def validate_annotation(annotation):
    """Return all field-level errors, without mutating the input."""
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    errors = []

    def fail(path, message):
        errors.append(f"{path}: {message}")

    def visit(value, rule, path):
        if "$ref" in rule:
            target = schema
            for part in rule["$ref"][2:].split("/"):
                target = target[part]
            visit(value, target, path)
            return
        kind = rule.get("type")
        matches = {
            "object": lambda: isinstance(value, dict),
            "array": lambda: isinstance(value, list),
            "string": lambda: isinstance(value, str),
            "number": lambda: is_number(value),
            "integer": lambda: is_number(value) and value % 1 == 0,
        }
        if kind and not matches[kind]():
            fail(path, f"expected {kind} (numbers must be finite)")
            return
        if "const" in rule and value != rule["const"]:
            fail(path, f"must equal {rule['const']!r}")
        if "enum" in rule and value not in rule["enum"]:
            fail(path, f"must be one of {rule['enum']}")
        if kind == "object":
            for key in rule.get("required", []):
                if key not in value:
                    fail(f"{path}.{key}", "required field is missing")
            for key, child in value.items():
                if key in rule.get("properties", {}):
                    visit(child, rule["properties"][key], f"{path}.{key}")
                elif rule.get("additionalProperties") is False:
                    fail(f"{path}.{key}", "unknown field")
            if "x-nonParallel" in rule:
                config = rule["x-nonParallel"]
                n, t = value.get(config["normal"]), value.get(config["tangent"])
                if is_vector(n) and is_vector(t):
                    length = math.hypot(*n)
                    if length > 0:
                        n = [x / length for x in n]
                        dot = sum(a * b for a, b in zip(n, t))
                        projection = math.hypot(*(t[i] - dot * n[i] for i in range(3)))
                        if projection <= config["threshold"]:
                            fail(f"{path}.{config['tangent']}", "projection onto normal plane must be > 0.001 (vectors are parallel)")
        if kind == "array":
            if len(value) < rule.get("minItems", 0):
                fail(path, f"must contain at least {rule['minItems']} items")
            if "maxItems" in rule and len(value) > rule["maxItems"]:
                fail(path, f"must contain at most {rule['maxItems']} items")
            for i, child in enumerate(value):
                if "items" in rule:
                    visit(child, rule["items"], f"{path}[{i}]")
            if "x-unitVector" in rule and is_vector(value):
                length = math.hypot(*value)
                if abs(length - 1) > rule["x-unitVector"]:
                    fail(path, f"must be a unit vector (norm={length:.8g}, tolerance=0.001)")
            if "x-uniqueBy" in rule:
                seen = set()
                key = rule["x-uniqueBy"]
                for i, item in enumerate(value):
                    if isinstance(item, dict) and isinstance(item.get(key), str):
                        if item[key] in seen:
                            fail(f"{path}[{i}].{key}", f"duplicate {key} {item[key]!r}")
                        seen.add(item[key])
        if kind == "string":
            if len(value) < rule.get("minLength", 0):
                fail(path, "must not be empty")
            if "pattern" in rule and not re.search(rule["pattern"], value):
                fail(path, "must contain non-whitespace characters")
        if kind in ("number", "integer"):
            for keyword, predicate, label in [
                ("minimum", lambda a, b: a < b, ">="),
                ("maximum", lambda a, b: a > b, "<="),
                ("exclusiveMinimum", lambda a, b: a <= b, ">"),
            ]:
                if keyword in rule and predicate(value, rule[keyword]):
                    fail(path, f"must be {label} {rule[keyword]}")

    visit(annotation, schema, "$")
    return errors


def load_annotation(path):
    with open(path, encoding="utf-8") as stream:
        return json.load(stream)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("annotation", type=Path)
    args = parser.parse_args()
    try:
        errors = validate_annotation(load_annotation(args.annotation))
    except (OSError, ValueError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    if errors:
        print("FAIL\n" + "\n".join(errors), file=sys.stderr)
        return 1
    print(f"PASS: {args.annotation}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
