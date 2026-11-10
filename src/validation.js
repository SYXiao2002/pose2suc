// Executes the same frozen schema and semantic assertions as validate_annotation.py.
export const finiteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);
export const vector3 = (value) =>
  Array.isArray(value) && value.length === 3 && value.every(finiteNumber);

export function validateAnnotation(annotation, schema) {
  const errors = [];
  const fail = (path, message) => errors.push(`${path}: ${message}`);
  function visit(value, rule, path) {
    if (rule.$ref) {
      visit(
        value,
        rule.$ref
          .slice(2)
          .split("/")
          .reduce((node, key) => node[key], schema),
        path,
      );
      return;
    }
    const kind = rule.type;
    const matches = {
      object: () =>
        value !== null && typeof value === "object" && !Array.isArray(value),
      array: () => Array.isArray(value),
      string: () => typeof value === "string",
      number: () => finiteNumber(value),
      integer: () => finiteNumber(value) && Number.isInteger(value),
    };
    if (kind && !matches[kind]()) {
      fail(path, `expected ${kind} (numbers must be finite)`);
      return;
    }
    if ("const" in rule && value !== rule.const)
      fail(path, `must equal ${JSON.stringify(rule.const)}`);
    if (rule.enum && !rule.enum.includes(value))
      fail(path, `must be one of ${JSON.stringify(rule.enum)}`);
    if (kind === "object") {
      for (const key of rule.required ?? [])
        if (!Object.hasOwn(value, key))
          fail(`${path}.${key}`, "required field is missing");
      for (const [key, child] of Object.entries(value)) {
        if (Object.hasOwn(rule.properties ?? {}, key))
          visit(child, rule.properties[key], `${path}.${key}`);
        else if (rule.additionalProperties === false)
          fail(`${path}.${key}`, "unknown field");
      }
      const config = rule["x-nonParallel"];
      if (
        config &&
        vector3(value[config.normal]) &&
        vector3(value[config.tangent])
      ) {
        const normal = value[config.normal],
          tangent = value[config.tangent];
        const length = Math.hypot(...normal);
        if (length > 0) {
          const n = normal.map((x) => x / length),
            dot = n.reduce((sum, x, i) => sum + x * tangent[i], 0);
          const projection = Math.hypot(
            ...tangent.map((x, i) => x - dot * n[i]),
          );
          if (projection <= config.threshold)
            fail(
              `${path}.${config.tangent}`,
              "projection onto normal plane must be > 0.001 (vectors are parallel)",
            );
        }
      }
    }
    if (kind === "array") {
      if (value.length < (rule.minItems ?? 0))
        fail(path, `must contain at least ${rule.minItems} items`);
      if ("maxItems" in rule && value.length > rule.maxItems)
        fail(path, `must contain at most ${rule.maxItems} items`);
      value.forEach((child, i) => {
        if (rule.items) visit(child, rule.items, `${path}[${i}]`);
      });
      if (
        "x-unitVector" in rule &&
        vector3(value) &&
        Math.abs(Math.hypot(...value) - 1) > rule["x-unitVector"]
      ) {
        fail(
          path,
          `must be a unit vector (norm=${Math.hypot(...value).toPrecision(8)}, tolerance=0.001)`,
        );
      }
      if (rule["x-uniqueBy"]) {
        const seen = new Set(),
          key = rule["x-uniqueBy"];
        value.forEach((item, i) => {
          if (typeof item?.[key] === "string") {
            if (seen.has(item[key]))
              fail(
                `${path}[${i}].${key}`,
                `duplicate ${key} ${JSON.stringify(item[key])}`,
              );
            seen.add(item[key]);
          }
        });
      }
    }
    if (kind === "string") {
      if (value.length < (rule.minLength ?? 0)) fail(path, "must not be empty");
      if (rule.pattern && !new RegExp(rule.pattern).test(value))
        fail(path, "must contain non-whitespace characters");
    }
    if (kind === "number" || kind === "integer") {
      if ("minimum" in rule && value < rule.minimum)
        fail(path, `must be >= ${rule.minimum}`);
      if ("maximum" in rule && value > rule.maximum)
        fail(path, `must be <= ${rule.maximum}`);
      if ("exclusiveMinimum" in rule && value <= rule.exclusiveMinimum)
        fail(path, `must be > ${rule.exclusiveMinimum}`);
    }
  }
  visit(annotation, schema, "$");
  return errors;
}
