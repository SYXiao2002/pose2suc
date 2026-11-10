import { tangentFor } from "./normal_editor.js";

export const emptyAnnotation = (objectId = "eu_plug") => ({
  schema_version: "1.0",
  object_id: objectId,
  normal_convention: "outward_surface",
  grasps: [],
});

export class GraspModel {
  constructor(annotation = emptyAnnotation()) {
    this.annotation = structuredClone(annotation);
    this.selectedId = annotation.grasps[0]?.grasp_id ?? null;
  }
  get selected() {
    return this.annotation.grasps.find(
      (grasp) => grasp.grasp_id === this.selectedId,
    );
  }
  get sorted() {
    return [...this.annotation.grasps].sort(
      (a, b) => a.priority - b.priority || a.grasp_id.localeCompare(b.grasp_id),
    );
  }
  nextId(base = "grasp") {
    let index = 1;
    while (
      this.annotation.grasps.some(
        (grasp) =>
          grasp.grasp_id === `${base}_${String(index).padStart(2, "0")}`,
      )
    )
      index++;
    return `${base}_${String(index).padStart(2, "0")}`;
  }
  add(pick, radius = 0.008) {
    const normal = pick?.normal_obj ?? [0, 0, 1];
    const grasp = {
      grasp_id: this.nextId(),
      priority:
        Math.max(0, ...this.annotation.grasps.map((g) => g.priority)) + 1,
      status: "pending",
      notes: "",
      contact_region: {
        type: "disk",
        center_obj: [...(pick?.point_obj ?? [0, 0, 0])],
        normal_obj: [...normal],
        normal_source: "auto_fitted",
        radius_m: radius,
        tangent_ref_obj: tangentFor(normal),
      },
      candidate_points: [],
    };
    this.annotation.grasps.push(grasp);
    this.selectedId = grasp.grasp_id;
    return grasp;
  }
  duplicate(id = this.selectedId) {
    const source = this.annotation.grasps.find((g) => g.grasp_id === id);
    if (!source) return;
    const clone = structuredClone(source);
    clone.grasp_id = this.nextId(`${id}_copy`);
    clone.priority =
      Math.max(...this.annotation.grasps.map((g) => g.priority)) + 1;
    this.annotation.grasps.push(clone);
    this.selectedId = clone.grasp_id;
    return clone;
  }
  update(id, change) {
    const index = this.annotation.grasps.findIndex((g) => g.grasp_id === id);
    if (index < 0) return;
    const clone = structuredClone(this.annotation.grasps[index]);
    change(clone);
    if (typeof clone.grasp_id !== "string" || !clone.grasp_id.trim())
      throw new Error("grasp_id 不能为空。");
    if (
      this.annotation.grasps.some(
        (g, i) => i !== index && g.grasp_id === clone.grasp_id,
      )
    ) {
      throw new Error(`grasp_id「${clone.grasp_id}」已存在，请使用唯一 ID。`);
    }
    this.annotation.grasps[index] = clone;
    if (this.selectedId === id) this.selectedId = clone.grasp_id;
    return clone;
  }
  remove(id = this.selectedId) {
    this.annotation.grasps = this.annotation.grasps.filter(
      (g) => g.grasp_id !== id,
    );
    if (id === this.selectedId)
      this.selectedId = this.sorted[0]?.grasp_id ?? null;
  }
}
