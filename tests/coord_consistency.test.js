import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "../vendor/three/three.module.js";
import { parseOBJ, surfaceHit } from "../src/obj_loader.js";
import { fitPlaneNormal } from "../src/normal_editor.js";

test("OBJ loading and raycast preserve original off-origin vertex coordinates", async () => {
  const { object, bounds } = parseOBJ(
    await readFile("tests/fixtures/known_coordinates.obj", "utf8"),
  );
  assert.deepEqual(object.position.toArray(), [0, 0, 0]);
  assert.deepEqual(object.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(bounds.min.toArray(), [1, 2, 3]);
  assert.deepEqual(bounds.max.toArray(), [3, 5, 3]);
  const positions = object.children[0].geometry.getAttribute("position");
  for (const [index, vertex] of [
    [1, 2, 3],
    [3, 2, 3],
    [1, 5, 3],
  ].entries()) {
    assert.deepEqual(
      new THREE.Vector3().fromBufferAttribute(positions, index).toArray(),
      vertex,
    );
  }
  // Cast strictly inside the face; edge hits are sensitive to floating-point sphere rejection.
  for (const vertex of [
    [1.5, 3, 3],
    [2, 2.5, 3],
  ]) {
    const ray = new THREE.Raycaster(
      new THREE.Vector3(vertex[0], vertex[1], 10),
      new THREE.Vector3(0, 0, -1),
    );
    const hits = ray.intersectObject(object, true);
    assert.ok(hits.length);
    assert.deepEqual(surfaceHit(hits[0], object), {
      point_obj: vertex,
      normal_obj: [0, 0, 1],
    });
  }
});

test("both supplied demo OBJs load without transformations", async () => {
  for (const path of [
    "demo_data/cube.obj",
    "demo_data/mesh_eu-plug/TexturedMeshSimplified.obj",
  ]) {
    const { object, triangles } = parseOBJ(await readFile(path, "utf8"));
    assert.ok(triangles > 0);
    assert.ok(object.matrixWorld.equals(new THREE.Matrix4()));
  }
});

test("neighbourhood plane fit follows winding with a tilted plane", () => {
  const expected = new THREE.Vector3(-1, -2, 1).normalize();
  const points = [
    [0, 0, 1],
    [1, 0, 2],
    [0, 1, 3],
    [1, 1, 4],
    [2, -1, 1],
  ];
  const fitted = new THREE.Vector3(
    ...fitPlaneNormal(points, expected.toArray()),
  );
  assert.ok(fitted.dot(expected) > 0.999999);
  assert.deepEqual(
    fitPlaneNormal(
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
      [0, 0, 1],
    ),
    [0, 0, 1],
  );
});
