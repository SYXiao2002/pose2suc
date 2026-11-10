import { Viewer } from "./viewer.js";
import { GraspModel, emptyAnnotation } from "./grasp_model.js";
import { Sidebar } from "./ui_sidebar.js";
import { fitSurfaceNormal, tangentFor } from "./normal_editor.js";
import { vector3 } from "./validation.js";
import {
  AnnotationError,
  parseAnnotation,
  prepareExport,
  downloadAnnotation,
  saveDraft,
  readDraft,
  DRAFT_KEY,
} from "./io.js";

const $ = (id) => document.getElementById(id);
const DEMOS = {
  plug: {
    url: "./demo_data/mesh_eu-plug/TexturedMeshSimplified.obj",
    name: "TexturedMeshSimplified.obj",
    objectId: "eu_plug",
  },
  cube: { url: "./demo_data/cube.obj", name: "cube.obj", objectId: "cube" },
};
let model = new GraspModel();
let modelFile = null,
  lastPick = null,
  mode = "center",
  dirty = false,
  draftPending = false,
  pendingDraft = null;
let schema, viewer, sidebar, saveTimer, toastTimer;

function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 4000);
}

function showError(error, context = "请修正以下问题后重试。") {
  $("error-context").textContent = context;
  $("error-details").textContent =
    error.errors?.join("\n") ?? error.message ?? String(error);
  if (!$("error-dialog").open) $("error-dialog").showModal();
}

function persist() {
  clearTimeout(saveTimer);
  if (!modelFile || draftPending || !dirty) return;
  try {
    saveDraft(model.annotation, modelFile, model.selectedId);
    $("dirty-state").textContent = "草稿已存 · 未导出";
  } catch (error) {
    $("dirty-state").textContent = "未导出 · 草稿保存失败";
    toast(`草稿保存失败：${error.message}。请导出 JSON 保存标注。`);
  }
}

function render() {
  viewer.mode = mode;
  sidebar.render(model, mode);
  viewer.setGrasps(model.annotation.grasps, model.selectedId);
  if (document.activeElement !== $("object-id"))
    $("object-id").value = model.annotation.object_id;
  $("view-object").textContent = model.annotation.object_id || "未命名";
  for (const button of document.querySelectorAll("[data-mode]"))
    button.classList.toggle("active", button.dataset.mode === mode);
}

function changed() {
  dirty = true;
  $("dirty-state").textContent = "未导出";
  $("dirty-state").classList.add("dirty");
  render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 350);
}

function edit(change, id = model.selectedId) {
  if (!id) return;
  model.update(id, change);
  changed();
}

function setMode(next) {
  mode = next;
  render();
  if (next === "candidate") toast("在模型表面点击，为当前抓取方式添加候选点。");
}

function showPick(pick) {
  lastPick = pick;
  const format = (values) => values.map((x) => x.toFixed(6)).join("  ");
  $("pick-position").textContent = `point_obj  [ ${format(pick.point_obj)} ] m`;
  $("pick-normal").textContent = `normal_obj [ ${format(pick.normal_obj)} ]`;
}

function place(id, pick) {
  showPick(pick);
  edit((g) => {
    g.contact_region.center_obj = [...pick.point_obj];
    if (g.contact_region.normal_source === "auto_fitted")
      g.contact_region.normal_obj = [...pick.normal_obj];
  }, id);
}

function addGrasp(pick = lastPick) {
  if (!viewer.model) return;
  model.add(pick, Math.min(0.008, viewer.span * 0.08));
  mode = "center";
  changed();
  if (!pick) toast("请在模型表面点击，设置新圆盘的接触圆心。");
}

function candidateAt(point) {
  if (!model.selected) {
    toast("请先创建或选择抓取方式。");
    return;
  }
  edit((g) => {
    (g.candidate_points ??= []).push({ point_obj: [...point], score: 1 });
  });
}

function pickSurface(pick) {
  showPick(pick);
  if (mode === "inspect") return;
  if (mode === "candidate") {
    candidateAt(pick.point_obj);
    return;
  }
  if (!model.selected) addGrasp(pick);
  else place(model.selectedId, pick);
}

function applyModel(text, name, demo = "custom") {
  const loaded = viewer.load(text);
  modelFile = { text, name, demo };
  lastPick = null;
  $("model-name").textContent = name;
  $("model-stats").textContent =
    `${loaded.triangles.toLocaleString()} triangles · 原始坐标 / m`;
  $("demo-select").value = demo;
  $("pick-position").textContent = "点击模型表面查看物体坐标";
  $("pick-normal").textContent = "法向需人工确认朝外";
}

async function loadDemo(key, initial = false) {
  const demo = DEMOS[key];
  if (!demo) return;
  if (
    !initial &&
    model.annotation.grasps.length &&
    !confirm("打开另一个模型将开始新的标注。请先导出需要保留的标注。继续？")
  ) {
    $("demo-select").value = modelFile?.demo ?? "custom";
    return;
  }
  $("loading").hidden = false;
  try {
    const response = await fetch(demo.url);
    if (!response.ok) throw new Error(`模型加载失败 (${response.status})`);
    applyModel(await response.text(), demo.name, key);
    model = new GraspModel(emptyAnnotation(demo.objectId));
    dirty = false;
    $("dirty-state").textContent = "尚未编辑";
    $("dirty-state").classList.remove("dirty");
    clearTimeout(saveTimer);
    render();
  } catch (error) {
    showError(error, "模型加载失败，当前标注已保留。");
  } finally {
    $("loading").hidden = true;
  }
}

async function boot() {
  const response = await fetch("./schema/grasp_annotation.schema.json");
  if (!response.ok)
    throw new Error("无法读取本地数据契约，请从本地 HTTP 服务打开项目。");
  schema = await response.json();
  viewer = new Viewer($("viewer"), {
    onPick: pickSurface,
    onSelect: (id) => {
      model.selectedId = id;
      render();
    },
    onMove: place,
    onNormal: (id, normal) =>
      edit((g) => {
        g.contact_region.normal_obj = normal;
        g.contact_region.normal_source = "manual_corrected";
      }, id),
  });
  sidebar = new Sidebar({
    select: (id) => {
      model.selectedId = id;
      render();
    },
    add: () => addGrasp(),
    edit,
    duplicate: () => {
      if (model.duplicate()) changed();
    },
    remove: () => {
      model.remove();
      changed();
    },
    error: showError,
    refit: () => {
      if (!model.selected || !viewer.model) return;
      const region = model.selected.contact_region;
      if (
        !vector3(region.center_obj) ||
        !Number.isFinite(region.radius_m) ||
        region.radius_m <= 0
      ) {
        showError(new Error("请先输入有效圆心和正半径。"));
        return;
      }
      const orientation =
        vector3(region.normal_obj) && Math.hypot(...region.normal_obj) > 0
          ? region.normal_obj
          : (lastPick?.normal_obj ?? [0, 0, 1]);
      const normal = fitSurfaceNormal(
        viewer.model,
        region.center_obj,
        region.radius_m,
        orientation,
      );
      edit((g) => {
        g.contact_region.normal_obj = normal;
        g.contact_region.normal_source = "auto_fitted";
      });
    },
    tangent: () => {
      const normal = model.selected?.contact_region.normal_obj;
      if (!vector3(normal) || Math.hypot(...normal) === 0) {
        showError(new Error("请先输入有效的非零法向。"));
        return;
      }
      edit((g) => {
        g.contact_region.tangent_ref_obj = tangentFor(normal);
      });
    },
    normalize: () => {
      if (!model.selected) return;
      const copy = { ...model.annotation, grasps: [model.selected] };
      try {
        const normalized = prepareExport(copy, schema).grasps[0];
        edit((g) => {
          g.contact_region = normalized.contact_region;
        });
      } catch (error) {
        showError(error);
      }
    },
    candidateMode: () => setMode(mode === "candidate" ? "center" : "candidate"),
    candidateCenter: () => {
      if (model.selected) candidateAt(model.selected.contact_region.center_obj);
    },
  });

  try {
    pendingDraft = readDraft();
    if (pendingDraft) {
      draftPending = true;
      $("draft-banner").hidden = false;
      const time = new Date(pendingDraft.saved_at).toLocaleString("zh-CN");
      $("draft-message").textContent =
        `发现本地草稿 · ${pendingDraft.annotation.object_id || "未命名"} · ${time}`;
    }
  } catch (error) {
    toast(`本地草稿无法读取：${error.message}`);
  }

  await loadDemo("plug", true);

  $("object-id").addEventListener("input", (event) => {
    model.annotation.object_id = event.target.value;
    changed();
  });
  $("open-obj").addEventListener("click", () => {
    $("obj-file").value = "";
    $("obj-file").click();
  });
  $("obj-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (
      model.annotation.grasps.length &&
      !confirm("打开新的 OBJ 将开始新的标注。请先导出需要保留的标注。继续？")
    )
      return;
    try {
      applyModel(await file.text(), file.name);
      model = new GraspModel(emptyAnnotation(file.name.replace(/\.obj$/i, "")));
      dirty = false;
      $("dirty-state").textContent = "尚未编辑";
      $("dirty-state").classList.remove("dirty");
      clearTimeout(saveTimer);
      render();
      toast("已加载 OBJ，原始顶点坐标保持不变。");
    } catch (error) {
      showError(error, "无法加载 OBJ，当前模型与标注已保留。");
    }
  });
  $("demo-select").addEventListener("change", (event) =>
    loadDemo(event.target.value),
  );
  $("fit-view").addEventListener("click", () => viewer.fitCamera());
  $("wireframe").addEventListener("click", () => {
    viewer.setWireframe(!viewer.wireframe);
    $("wireframe").setAttribute("aria-pressed", String(viewer.wireframe));
  });
  for (const button of document.querySelectorAll("[data-mode]"))
    button.addEventListener("click", () => setMode(button.dataset.mode));
  $("import-json").addEventListener("click", () => {
    $("json-file").value = "";
    $("json-file").click();
  });
  $("json-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const annotation = parseAnnotation(await file.text(), schema);
      if (dirty && !confirm("导入会替换当前标注，继续？")) return;
      model = new GraspModel(annotation);
      changed();
      toast(
        `已导入 ${annotation.grasps.length} 个抓取方式；请确认当前 OBJ 与 object_id 对应。`,
      );
    } catch (error) {
      showError(error, "导入失败，当前模型与编辑内容已保留。");
    }
  });
  $("export-json").addEventListener("click", () => {
    try {
      const annotation = prepareExport(model.annotation, schema);
      downloadAnnotation(annotation);
      model.annotation = annotation;
      dirty = false;
      $("dirty-state").textContent = "已导出";
      $("dirty-state").classList.remove("dirty");
      clearTimeout(saveTimer);
      if (!draftPending && modelFile) {
        try {
          saveDraft(annotation, modelFile, model.selectedId);
        } catch {
          /* Download already succeeded. */
        }
      }
      render();
      toast("标注已导出，法向与切向已归一化。");
    } catch (error) {
      showError(error, "导出前校验未通过，文件未生成。");
    }
  });
  $("restore-draft").addEventListener("click", () => {
    if (!pendingDraft) return;
    try {
      const restored = new GraspModel(pendingDraft.annotation);
      applyModel(
        pendingDraft.model.text,
        pendingDraft.model.name,
        pendingDraft.model.demo ?? "custom",
      );
      model = restored;
      if (
        model.annotation.grasps.some(
          (g) => g.grasp_id === pendingDraft.selectedId,
        )
      )
        model.selectedId = pendingDraft.selectedId;
      draftPending = false;
      pendingDraft = null;
      $("draft-banner").hidden = true;
      changed();
      toast("已恢复标注与原始 OBJ 草稿。");
    } catch (error) {
      showError(error, "草稿恢复失败，当前编辑内容已保留。");
    }
  });
  $("discard-draft").addEventListener("click", () => {
    draftPending = false;
    pendingDraft = null;
    $("draft-banner").hidden = true;
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* Editing remains available. */
    }
    if (dirty) persist();
  });
  for (const id of ["close-error", "ack-error"])
    $(id).addEventListener("click", () => $("error-dialog").close());
  window.addEventListener("beforeunload", (event) => {
    if (dirty) {
      persist();
      event.preventDefault();
      event.returnValue = "";
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) persist();
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js")
      .then(async (registration) => {
        await navigator.serviceWorker.ready;
        $("offline-status").textContent = "离线资源就绪";
        registration.addEventListener("updatefound", () => {
          $("offline-status").textContent = "缓存更新中";
        });
      })
      .catch(() => {
        $("offline-status").textContent = "本地资源模式";
      });
  }
}

boot().catch((error) => {
  $("loading").textContent = "初始化失败，请查看错误提示。";
  showError(error);
});
