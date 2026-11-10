import { validateAnnotation, vector3 } from "./validation.js";

export const DRAFT_KEY = "pose2suc.draft.v1";
export class AnnotationError extends Error {
  constructor(errors) {
    super(errors.join("\n"));
    this.errors = errors;
  }
}

export function parseAnnotation(text, schema) {
  let annotation;
  try {
    annotation = JSON.parse(text);
  } catch (error) {
    throw new AnnotationError([`JSON 语法错误：${error.message}`]);
  }
  const errors = validateAnnotation(annotation, schema);
  if (errors.length) throw new AnnotationError(errors);
  return annotation;
}

export function prepareExport(annotation, schema) {
  const copy = structuredClone(annotation);
  for (const grasp of copy.grasps ?? []) {
    for (const field of ["normal_obj", "tangent_ref_obj"]) {
      const value = grasp.contact_region?.[field];
      if (vector3(value) && Math.hypot(...value) > 0) {
        const length = Math.hypot(...value);
        grasp.contact_region[field] = value.map((x) => x / length);
      }
    }
  }
  const errors = validateAnnotation(copy, schema);
  if (errors.length) throw new AnnotationError(errors);
  return copy;
}

export function downloadAnnotation(annotation) {
  const blob = new Blob([JSON.stringify(annotation, null, 2) + "\n"], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${annotation.object_id.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")}_grasps.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Include the OBJ text: local File objects cannot be reopened after a page reload.
export function saveDraft(
  annotation,
  model,
  selectedId,
  storage = localStorage,
) {
  storage.setItem(
    DRAFT_KEY,
    JSON.stringify({
      version: 1,
      saved_at: new Date().toISOString(),
      annotation,
      model,
      selectedId,
    }),
  );
}
export function readDraft(storage = localStorage) {
  const raw = storage.getItem(DRAFT_KEY);
  if (!raw) return null;
  const draft = JSON.parse(raw);
  const a = draft?.annotation;
  const editableNumber = (x) =>
    x === null || (typeof x === "number" && Number.isFinite(x));
  const editableVector = (x) =>
    Array.isArray(x) && x.length === 3 && x.every(editableNumber);
  const ids = new Set();
  const editableGrasp = (g) => {
    const region = g?.contact_region;
    if (
      typeof g?.grasp_id !== "string" ||
      !g.grasp_id.trim() ||
      ids.has(g.grasp_id)
    )
      return false;
    ids.add(g.grasp_id);
    return (
      editableNumber(g.priority) &&
      ["pending", "verified", "deprecated"].includes(g.status) &&
      (g.notes === undefined || typeof g.notes === "string") &&
      region?.type === "disk" &&
      ["auto_fitted", "manual_corrected", "manual"].includes(
        region.normal_source,
      ) &&
      editableVector(region.center_obj) &&
      editableVector(region.normal_obj) &&
      editableVector(region.tangent_ref_obj) &&
      editableNumber(region.radius_m) &&
      (g.candidate_points === undefined ||
        (Array.isArray(g.candidate_points) &&
          g.candidate_points.every(
            (p) => editableVector(p?.point_obj) && editableNumber(p?.score),
          )))
    );
  };
  if (
    draft?.version !== 1 ||
    a?.schema_version !== "1.0" ||
    a.normal_convention !== "outward_surface" ||
    typeof a.object_id !== "string" ||
    !Array.isArray(a.grasps) ||
    !a.grasps.every(editableGrasp) ||
    typeof draft.model?.text !== "string" ||
    typeof draft.model?.name !== "string"
  ) {
    throw new Error("本地草稿格式不兼容。");
  }
  return draft;
}
