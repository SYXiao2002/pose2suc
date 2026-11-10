import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import * as THREE from "../../vendor/three/three.module.js";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden();
  await expect(page.locator("#model-stats")).toContainText("2,900");
});

async function cube(page) {
  await page.locator("#demo-select").selectOption("cube");
  await expect(page.locator("#model-name")).toHaveText("cube.obj");
}

async function project(
  page,
  point,
  min = [-0.02, -0.02, -0.02],
  max = [0.02, 0.02, 0.02],
) {
  const box = await page.locator("canvas").boundingBox();
  const bounds = new THREE.Box3(
    new THREE.Vector3(...min),
    new THREE.Vector3(...max),
  );
  const span = bounds.getSize(new THREE.Vector3()).length(),
    center = bounds.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(
    38,
    box.width / box.height,
    span / 10000,
    span * 10000,
  );
  camera.up.set(0, 0, 1);
  camera.position
    .copy(center)
    .add(new THREE.Vector3(1.1, -1.5, 1).multiplyScalar(span));
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  const position = new THREE.Vector3(...point).project(camera);
  return {
    x: box.x + ((position.x + 1) * box.width) / 2,
    y: box.y + ((1 - position.y) * box.height) / 2,
  };
}

async function pick(page, point) {
  const screen = await project(page, point);
  await page.mouse.click(screen.x, screen.y);
}

async function exportJSON(page) {
  const promise = page.waitForEvent("download");
  await page.locator("#export-json").click();
  const download = await promise;
  const path = await download.path();
  return {
    data: JSON.parse(await readFile(path, "utf8")),
    path,
    filename: download.suggestedFilename(),
  };
}

test("bundled plug accepts the first surface pick and exports a fitted normal", async ({
  page,
}) => {
  const box = await page.locator("canvas").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#grasp-count")).toHaveText("01");
  await expect(page.locator("#normal-source")).toHaveText("邻域拟合");
  await page.locator("#candidate-center").click();
  const output = await exportJSON(page);
  expect(output.data.object_id).toBe("eu_plug");
  const region = output.data.grasps[0].contact_region;
  expect(Math.hypot(...region.normal_obj)).toBeCloseTo(1, 8);
  expect(region.center_obj.every(Number.isFinite)).toBe(true);
  expect(
    execFileSync("python3", ["validate_annotation.py", output.path], {
      encoding: "utf8",
    }),
  ).toContain("PASS");
});

test("two independent grasps, candidates, manual normals and JSON roundtrip", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await cube(page);
  await pick(page, [0, 0, 0.02]);
  await expect(page.locator("#grasp-count")).toHaveText("01");
  expect(
    Number(
      await page
        .locator('[data-vector=center_obj][data-axis="2"]')
        .inputValue(),
    ),
  ).toBeCloseTo(0.02, 8);
  await page.locator("#notes").fill("第一次实吸：密封稳定");
  await page.locator("#status").selectOption("verified");
  await page.locator('[data-vector=normal_obj][data-axis="2"]').fill("2");
  await expect(page.locator("#normal-source")).toHaveText("人工修正");
  await page.locator("[data-mode=candidate]").click();
  await pick(page, [-0.006, -0.006, 0.02]);
  await expect(page.locator("#candidate-count")).toHaveText("1");
  await page.getByLabel("候选点 1 score", { exact: true }).fill("0.9");
  await page.locator("#add-grasp").click();
  await page.locator("#grasp-id").fill("side_region");
  await page.locator("#grasp-id").blur();
  await pick(page, [0.012, 0.004, 0.02]);
  await page.locator("#candidate-center").click();
  await page.locator("#notes").fill("第二种抓取方式");
  const first = await exportJSON(page);
  expect(first.filename).toBe("cube_grasps.json");
  expect(first.data.grasps).toHaveLength(2);
  expect(first.data.grasps[0].notes).toBe("第一次实吸：密封稳定");
  expect(first.data.grasps[0].contact_region.normal_source).toBe(
    "manual_corrected",
  );
  expect(first.data.grasps[0].contact_region.normal_obj).toEqual([0, 0, 1]);
  expect(first.data.grasps[0].candidate_points[0].score).toBe(0.9);
  expect(first.data.grasps[1].candidate_points).toHaveLength(1);
  expect(
    execFileSync("python3", ["validate_annotation.py", first.path], {
      encoding: "utf8",
    }),
  ).toContain("PASS");
  await page.locator("#json-file").setInputFiles(first.path);
  await expect(page.locator("#grasp-count")).toHaveText("02");
  const second = await exportJSON(page);
  expect(second.data).toEqual(first.data);
  expect(errors).toEqual([]);
});

test("duplicate IDs and invalid JSON preserve editing; degenerate tangent blocks export", async ({
  page,
}) => {
  await cube(page);
  await pick(page, [0, 0, 0.02]);
  await page.locator("#duplicate-grasp").click();
  const cloneId = await page.locator("#grasp-id").inputValue();
  await page.locator("#grasp-id").fill("grasp_01");
  await page.locator("#grasp-id").blur();
  await expect(page.locator("#error-details")).toContainText("已存在");
  await page.locator("#ack-error").click();
  await expect(page.locator("#grasp-id")).toHaveValue(cloneId);
  await page.locator("#notes").fill("必须保留的编辑");
  await page
    .locator("#json-file")
    .setInputFiles("tests/fixtures/invalid/parallel_tangent.json");
  await expect(page.locator("#error-details")).toContainText("tangent_ref_obj");
  await page.locator("#ack-error").click();
  await expect(page.locator("#notes")).toHaveValue("必须保留的编辑");
  await page
    .locator("#json-file")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("{bad"),
    });
  await expect(page.locator("#error-details")).toContainText("JSON 语法错误");
  await page.locator("#ack-error").click();
  await expect(page.locator("#grasp-count")).toHaveText("02");
  for (const [axis, value] of ["0", "0", "1"].entries())
    await page
      .locator(`[data-vector=tangent_ref_obj][data-axis="${axis}"]`)
      .fill(value);
  await expect(page.locator("#tangent-hint")).toContainText("接近平行");
  await page.locator("#export-json").click();
  await expect(page.locator("#error-details")).toContainText("parallel");
  await page.locator("#ack-error").click();
  await page.locator("#normal-clear").click();
  for (const [axis, value] of ["0", "1", "0"].entries())
    await page
      .locator(`[data-vector=normal_obj][data-axis="${axis}"]`)
      .fill(value);
  await expect(page.locator("#normal-source")).toHaveText("人工输入");
  await page.locator("#tangent-auto").click();
  const output = await exportJSON(page);
  expect(output.data.grasps[1].contact_region.normal_source).toBe("manual");
});

test("surface dragging moves the anchor and arrow dragging marks manual correction", async ({
  page,
}) => {
  await cube(page);
  await pick(page, [0, 0, 0.02]);
  const from = await project(page, [0, 0, 0.02]),
    to = await project(page, [0.008, 0.004, 0.02]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  const x = Number(
    await page.locator('[data-vector=center_obj][data-axis="0"]').inputValue(),
  );
  const y = Number(
    await page.locator('[data-vector=center_obj][data-axis="1"]').inputValue(),
  );
  expect(x).toBeCloseTo(0.008, 5);
  expect(y).toBeCloseTo(0.004, 5);
  const length = Math.sqrt(3) * 0.04 * 0.14;
  const tip = await project(page, [x, y, 0.02 + length]);
  await page.mouse.move(tip.x, tip.y);
  await page.mouse.down();
  await page.mouse.move(tip.x + 24, tip.y - 12, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("#normal-source")).toHaveText("人工修正");
  expect(
    Number(
      await page
        .locator('[data-vector=normal_obj][data-axis="0"]')
        .inputValue(),
    ),
  ).not.toBe(0);
});

test("uploaded off-origin OBJ display, local draft recovery and offline reload", async ({
  page,
  context,
}) => {
  await page
    .locator("#obj-file")
    .setInputFiles("tests/fixtures/known_coordinates.obj");
  await expect(page.locator("#model-name")).toHaveText("known_coordinates.obj");
  const screen = await project(page, [1.5, 3, 3], [1, 2, 3], [3, 5, 3]);
  await page.mouse.click(screen.x, screen.y);
  await expect(page.locator("#grasp-count")).toHaveText("01");
  await expect(page.locator("#pick-position")).toContainText(
    "1.500000  3.000000  3.000000",
  );
  await page.locator("#notes").fill("本地模型恢复");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("pose2suc.draft.v1"))?.annotation
            .grasps[0].notes,
      ),
    )
    .toBe("本地模型恢复");
  await expect(page.locator("#offline-status")).toHaveText("离线资源就绪");
  await page.reload();
  await expect(page.locator("#draft-banner")).toBeVisible();
  await page.locator("#restore-draft").click();
  await expect(page.locator("#model-name")).toHaveText("known_coordinates.obj");
  await expect(page.locator("#notes")).toHaveValue("本地模型恢复");
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#restore-draft").click();
  await expect(page.locator("#model-name")).toHaveText("known_coordinates.obj");
  await expect(page.locator("#notes")).toHaveValue("本地模型恢复");
});
