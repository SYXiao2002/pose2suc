import { vector3 } from "./validation.js";

const $ = (id) => document.getElementById(id);
const number = (input) =>
  input.value.trim() === "" ? null : input.valueAsNumber;
const statusNames = {
  pending: "待验证",
  verified: "已验证",
  deprecated: "已弃用",
};
const sourceNames = {
  auto_fitted: "邻域拟合",
  manual_corrected: "人工修正",
  manual: "人工输入",
};

export class Sidebar {
  constructor(actions) {
    this.actions = actions;
    $("grasp-list").addEventListener("click", (event) => {
      const item = event.target.closest("[data-id]");
      if (item) actions.select(item.dataset.id);
    });
    for (const id of ["add-grasp", "empty-add"])
      $(id).addEventListener("click", actions.add);
    $("duplicate-grasp").addEventListener("click", actions.duplicate);
    $("delete-grasp").addEventListener("click", actions.remove);
    $("grasp-id").addEventListener("change", (event) => {
      try {
        actions.edit((g) => {
          g.grasp_id = event.target.value.trim();
        });
      } catch (error) {
        actions.error(error);
        event.target.value = this.current?.grasp_id ?? "";
      }
    });
    $("priority").addEventListener("input", (event) =>
      actions.edit((g) => {
        g.priority = number(event.target);
      }),
    );
    $("status").addEventListener("change", (event) =>
      actions.edit((g) => {
        g.status = event.target.value;
      }),
    );
    $("notes").addEventListener("input", (event) =>
      actions.edit((g) => {
        g.notes = event.target.value;
      }),
    );
    $("radius").addEventListener("input", (event) =>
      actions.edit((g) => {
        g.contact_region.radius_m = number(event.target);
      }),
    );
    $("editor").addEventListener("input", (event) => {
      const input = event.target;
      if (!input.dataset.vector) return;
      actions.edit((g) => {
        const field = input.dataset.vector;
        g.contact_region[field][Number(input.dataset.axis)] = number(input);
        if (
          field === "normal_obj" &&
          g.contact_region.normal_source !== "manual"
        )
          g.contact_region.normal_source = "manual_corrected";
      });
    });
    $("normal-flip").addEventListener("click", () =>
      actions.edit((g) => {
        g.contact_region.normal_obj = g.contact_region.normal_obj.map((x) =>
          x === null ? null : -x,
        );
        g.contact_region.normal_source = "manual_corrected";
      }),
    );
    $("normal-clear").addEventListener("click", () =>
      actions.edit((g) => {
        g.contact_region.normal_obj = [null, null, null];
        g.contact_region.normal_source = "manual";
      }),
    );
    $("normal-fit").addEventListener("click", actions.refit);
    $("tangent-auto").addEventListener("click", actions.tangent);
    $("vectors-normalize").addEventListener("click", actions.normalize);
    $("candidate-pick").addEventListener("click", actions.candidateMode);
    $("candidate-center").addEventListener("click", actions.candidateCenter);
    $("candidate-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-candidate]");
      if (button)
        actions.edit((g) => {
          g.candidate_points.splice(Number(button.dataset.removeCandidate), 1);
        });
    });
    $("candidate-list").addEventListener("input", (event) => {
      const input = event.target;
      if (!input.dataset.candidate) return;
      actions.edit((g) => {
        const candidate =
          g.candidate_points[Number(input.dataset.candidate) - 1];
        if (input.dataset.score) candidate.score = number(input);
        else candidate.point_obj[Number(input.dataset.axis)] = number(input);
      });
    });
  }

  value(id, value) {
    const element = $(id);
    if (document.activeElement !== element) element.value = value ?? "";
  }

  render(model, mode) {
    this.current = model.selected;
    const grasps = model.sorted;
    $("grasp-count").textContent = String(grasps.length).padStart(2, "0");
    $("list-empty").hidden = grasps.length > 0;
    $("grasp-list").replaceChildren(
      ...grasps.map((grasp) => {
        const button = document.createElement("button");
        button.className = `grasp-item ${grasp.grasp_id === model.selectedId ? "selected" : ""}`;
        button.dataset.id = grasp.grasp_id;
        button.setAttribute(
          "aria-pressed",
          String(grasp.grasp_id === model.selectedId),
        );
        const title = document.createElement("strong");
        title.textContent = grasp.grasp_id;
        const meta = document.createElement("span");
        meta.className = "grasp-meta";
        const priority = document.createElement("span");
        priority.textContent = `P${grasp.priority ?? "—"}`;
        const status = document.createElement("span");
        status.className = `status-dot ${grasp.status}`;
        status.textContent = statusNames[grasp.status];
        meta.append(priority, status);
        const detail = document.createElement("small");
        detail.textContent = `${grasp.candidate_points?.length ?? 0} 个候选点 · r ${Number.isFinite(grasp.contact_region.radius_m) ? (grasp.contact_region.radius_m * 1000).toFixed(1) : "—"} mm`;
        button.append(title, meta, detail);
        return button;
      }),
    );
    $("editor").hidden = !model.selected;
    $("editor-empty").hidden = !!model.selected;
    $("duplicate-grasp").disabled = !model.selected;
    $("delete-grasp").disabled = !model.selected;
    if (!model.selected) return;
    const grasp = model.selected,
      region = grasp.contact_region;
    this.value("grasp-id", grasp.grasp_id);
    this.value("priority", grasp.priority);
    this.value("status", grasp.status);
    this.value("notes", grasp.notes ?? "");
    this.value("radius", region.radius_m);
    $("radius-mm").textContent = Number.isFinite(region.radius_m)
      ? `${(region.radius_m * 1000).toFixed(2)} mm`
      : "请输入半径";
    for (const input of document.querySelectorAll("[data-vector]")) {
      if (document.activeElement !== input)
        input.value =
          region[input.dataset.vector][Number(input.dataset.axis)] ?? "";
    }
    $("normal-source").textContent = sourceNames[region.normal_source];
    const norm = vector3(region.normal_obj)
      ? Math.hypot(...region.normal_obj)
      : NaN;
    $("normal-norm").textContent = Number.isFinite(norm)
      ? `模长 ${norm.toFixed(6)} · ${Math.abs(norm - 1) <= 0.001 ? "已归一化" : "导出时归一化"}`
      : "请输入全部三个分量";
    $("normal-norm").classList.toggle(
      "invalid",
      !Number.isFinite(norm) || norm === 0,
    );
    let projection = 0;
    if (norm > 0 && vector3(region.tangent_ref_obj)) {
      const n = region.normal_obj.map((x) => x / norm);
      const dot = n.reduce(
        (sum, x, i) => sum + x * region.tangent_ref_obj[i],
        0,
      );
      projection = Math.hypot(
        ...region.tangent_ref_obj.map((x, i) => x - dot * n[i]),
      );
    }
    $("tangent-hint").textContent =
      projection > 0.001
        ? `切向投影 ${projection.toFixed(6)} · 可用`
        : "切向与法向接近平行或无效，无法导出";
    $("tangent-hint").classList.toggle("invalid", projection <= 0.001);
    $("candidate-pick").classList.toggle("active", mode === "candidate");
    $("candidate-count").textContent = String(
      grasp.candidate_points?.length ?? 0,
    );
    const list = $("candidate-list");
    // Retain focused number input while typing; rebuild on add/remove/selection.
    if (
      !list.contains(document.activeElement) ||
      list.childElementCount !== (grasp.candidate_points?.length ?? 0)
    ) {
      list.replaceChildren(
        ...(grasp.candidate_points ?? []).map((candidate, index) =>
          this.candidateRow(candidate, index),
        ),
      );
    }
  }

  candidateRow(candidate, index) {
    const row = document.createElement("div");
    row.className = "candidate-row";
    const top = document.createElement("div");
    top.className = "candidate-top";
    const label = document.createElement("span");
    label.textContent = `● 候选点 ${index + 1}`;
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.className = "icon-button";
    remove.dataset.removeCandidate = index;
    remove.setAttribute("aria-label", `删除候选点 ${index + 1}`);
    top.append(label, remove);
    const coords = document.createElement("div");
    coords.className = "vector-inputs";
    candidate.point_obj.forEach((value, axis) => {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.value = value ?? "";
      input.dataset.candidate = index + 1;
      input.dataset.axis = axis;
      input.setAttribute("aria-label", `候选点 ${index + 1} ${"XYZ"[axis]}`);
      coords.append(input);
    });
    const scoreLabel = document.createElement("label");
    scoreLabel.className = "score-label";
    scoreLabel.textContent = "score";
    const score = document.createElement("input");
    score.type = "number";
    score.min = 0;
    score.max = 1;
    score.step = 0.05;
    score.value = candidate.score ?? "";
    score.dataset.candidate = index + 1;
    score.dataset.score = "true";
    score.setAttribute("aria-label", `候选点 ${index + 1} score`);
    scoreLabel.append(score);
    row.append(top, coords, scoreLabel);
    return row;
  }
}
