import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { GraspModel } from "../src/grasp_model.js";
import { validateAnnotation } from "../src/validation.js";
import {
  prepareExport,
  parseAnnotation,
  readDraft,
  saveDraft,
  DRAFT_KEY,
} from "../src/io.js";

const schema = JSON.parse(
  await readFile("schema/grasp_annotation.schema.json", "utf8"),
);
const example = JSON.parse(await readFile("examples/plug_type_a.json", "utf8"));

test("JS/Python validators agree for fixtures and non-finite, null, boolean and boundary mutations", async () => {
  const { readdir } = await import("node:fs/promises");
  const values = [example, null, [], true, {}, { grasps: [null] }];
  for (const name of await readdir("tests/fixtures/invalid")) {
    values.push(
      JSON.parse(await readFile(`tests/fixtures/invalid/${name}`, "utf8")),
    );
  }
  for (const [field, value] of [
    ["normal_obj", [0, 0, true]],
    ["normal_obj", [null, 0, 1]],
    ["radius_m", -1],
    ["tangent_ref_obj", [0.0001, 0, 1]],
    ["radius_m", 1e-12],
  ]) {
    const data = structuredClone(example);
    data.grasps[0].contact_region[field] = value;
    values.push(data);
  }
  const python = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import json,sys; from validate_annotation import validate_annotation; print(json.dumps([len(validate_annotation(x)) == 0 for x in json.load(sys.stdin)]))",
      ],
      { input: JSON.stringify(values), encoding: "utf8" },
    ),
  );
  assert.deepEqual(
    values.map((value) => validateAnnotation(value, schema).length === 0),
    python,
  );
  for (const value of [NaN, Infinity, -Infinity]) {
    const data = structuredClone(example);
    data.grasps[0].contact_region.radius_m = value;
    assert.ok(validateAnnotation(data, schema).length);
  }
});

test("independent grasps and duplicate rejection leave the source unchanged", () => {
  const model = new GraspModel(example);
  const original = structuredClone(model.selected);
  const clone = model.duplicate();
  model.update(clone.grasp_id, (g) => {
    g.contact_region.center_obj[0] = 99;
    g.candidate_points[0].point_obj[2] = 20;
    g.notes = "独立编辑";
  });
  assert.deepEqual(model.annotation.grasps[0], original);
  assert.throws(
    () =>
      model.update(clone.grasp_id, (g) => {
        g.grasp_id = original.grasp_id;
      }),
    /已存在/,
  );
  model.remove(clone.grasp_id);
  assert.deepEqual(model.annotation, example);
});

test("normalization, two-grasp candidate roundtrip and invalid import are atomic", () => {
  const model = new GraspModel(example);
  model.duplicate();
  model.update(model.selectedId, (g) => {
    g.contact_region.normal_obj = [0, 0, 2];
  });
  const before = structuredClone(model.annotation);
  const output = prepareExport(model.annotation, schema);
  assert.equal(output.grasps[1].contact_region.normal_obj[2], 1);
  assert.deepEqual(model.annotation, before);
  const imported = parseAnnotation(JSON.stringify(output), schema);
  assert.deepEqual(prepareExport(imported, schema), output);
  assert.throws(() => parseAnnotation('{"grasps": []}', schema));
  assert.deepEqual(model.annotation, before);
  model.update(model.selectedId, (g) => {
    g.contact_region.tangent_ref_obj = [0, 0, 2];
  });
  assert.throws(() => prepareExport(model.annotation, schema), /parallel/);
});

test("draft retains locally uploaded OBJ and incomplete numeric input", () => {
  const storage = {
    data: new Map(),
    setItem(key, value) {
      this.data.set(key, value);
    },
    getItem(key) {
      return this.data.get(key) ?? null;
    },
  };
  const model = new GraspModel(example);
  model.selected.contact_region.normal_obj[0] = null;
  saveDraft(
    model.annotation,
    { text: "v 1 2 3\nf 1 1 1", name: "test.obj" },
    model.selectedId,
    storage,
  );
  const draft = readDraft(storage);
  assert.deepEqual(draft.annotation, model.annotation);
  assert.equal(draft.model.name, "test.obj");
  assert.equal(draft.selectedId, model.selectedId);
  storage.setItem(DRAFT_KEY, "wrong");
  assert.throws(() => readDraft(storage));
});
