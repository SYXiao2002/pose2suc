# 规格文档：吸盘抓取标注 Web 离线工具

## 1. 目标

构建一个纯前端、可离线运行的 web 工具。输入 OBJ 模型（含物体坐标系），人工在模型表面定义多个吸盘抓取方式（接触圆区域 + 法向 + 切向参考 + 候选点），以结构化 JSON 导出，供下游机械臂结合物体 6D 位姿变换后执行。

核心设计原则：

- 标注数据存于 **OBJ 自带的物体坐标系**，与实例位姿解耦，一次标注多次复用。
- 多种抓取方式按唯一 `grasp_id` **独立管理**，改一个不影响其他。
- 法向由**人工确认**，几何自动拟合只作为初值；法向符号全局统一并可视化。
- 区域与点语义分开：`center` 是执行锚点，`radius` 是容差与在线校验半径。
- 冗余分三层：方式级（`grasp_id` + `priority`）、点级（`candidate_points`）、实例级（模板与位姿解耦，不在本工具内）。
- 每个抓取方式带 `status` 和 `notes`，支持实吸验证后回填。

## 2. 核心约定（冻结，所有阶段遵守）

1. **坐标系**：所有几何量存于物体坐标系，字段后缀统一 `_obj`。OBJ 加载不得引入额外旋转/缩放/平移，必须与文件顶点坐标一致。
2. **法向符号**：`normal_obj` 定义为物体表面**朝外**的单位向量。导出 JSON 顶层必须含 `"normal_convention": "outward_surface"`。UI 必须用箭头可视化法向，方向为朝外。
3. **法向来源**：`contact_region.normal_source` 取值 `manual` / `auto_fitted` / `manual_corrected`。默认由拾取点邻域拟合给出 `auto_fitted`，人工修改后置为 `manual_corrected`，人工直接输入置为 `manual`。
4. **区域与点**：`contact_region` 描述圆盘（center + normal + radius + tangent_ref）。`center_obj` 是执行锚点；`radius_m` 是接触圆半径，用途是容差与在线校验，不直接进运动指令。
5. **冗余三层**：方式级用独立 `grasp_id` + `priority`；点级用同一方式下 `candidate_points` 子数组（每项含 `point_obj` 与 `score`）；实例级不在本工具范围，模板按 `object_id` 复用。
6. **状态**：`status` 取 `verified` / `pending` / `deprecated`。`notes` 存实吸总结。
7. **切向参考**：`tangent_ref_obj` 用于锁定绕法向的旋转，必须与 `normal_obj` 不平行；导出前校验其投影模长大于阈值。
8. **归一化**：`normal_obj` 和 `tangent_ref_obj` 导出前必须归一化；schema 校验单位向量。

## 3. 数据契约（阶段 1 冻结）

### 3.1 导出 JSON 结构

```json
{
  "schema_version": "1.0",
  "object_id": "plug_type_a",
  "normal_convention": "outward_surface",
  "grasps": [
    {
      "grasp_id": "top_region_v1",
      "priority": 1,
      "status": "pending",
      "notes": "",
      "contact_region": {
        "type": "disk",
        "center_obj": [0.012, 0.003, 0.045],
        "normal_obj": [0.0, 0.0, 1.0],
        "normal_source": "manual_corrected",
        "radius_m": 0.008,
        "tangent_ref_obj": [1.0, 0.0, 0.0]
      },
      "candidate_points": [
        { "point_obj": [0.012, 0.003, 0.045], "score": 0.9 }
      ]
    }
  ]
}
```

### 3.2 字段约束

| 字段 | 类型 | 约束 |
|---|---|---|
| `schema_version` | string | 必填，当前 `"1.0"` |
| `object_id` | string | 必填，非空 |
| `normal_convention` | string | 必填，固定 `"outward_surface"` |
| `grasps` | array | 必填，至少 1 项，`grasp_id` 全局唯一 |
| `grasp_id` | string | 必填，非空，唯一，建议 `[a-z0-9_]+` |
| `priority` | integer | 必填，≥ 1 |
| `status` | string | 必填，枚举三态 |
| `notes` | string | 可为空 |
| `contact_region.type` | string | 固定 `"disk"` |
| `center_obj` | array[3] | 必填，有限数值 |
| `normal_obj` | array[3] | 必填，模长 ≈ 1（容差 1e-3） |
| `normal_source` | string | 必填，枚举三值 |
| `radius_m` | number | 必填，> 0 |
| `tangent_ref_obj` | array[3] | 必填，模长 ≈ 1，与 `normal_obj` 不平行（投影模长 > 1e-3） |
| `candidate_points` | array | 可为空；每项 `point_obj` 为 array[3]，`score` 为 [0,1] |

### 3.3 交付物

- `schema/grasp_annotation.schema.json`：JSON Schema，覆盖上述约束。
- `validate_annotation.py`：输入 JSON，输出通过/失败及逐条原因。
- `examples/plug_type_a.json`：通过校验的示例。
- `tests/fixtures/invalid/*.json`：至少覆盖法向未归一化、`radius_m ≤ 0`、`grasp_id` 重复、缺 `schema_version`、`normal_convention` 错误、`tangent_ref` 与法向平行六类反例。

### 3.4 验收

- 示例通过校验。
- 六类反例均被拒绝并给出字段级错误信息。
- 校验脚本无第三方重依赖，仅用标准库或 `jsonschema`。

## 4. 功能需求

### 4.1 OBJ 加载与 3D 视图

- 纯前端，Three.js（`OBJLoader`）加载 OBJ，显示物体坐标系三轴（红 X / 绿 Y / 蓝 Z）。
- 轨道控制（旋转、缩放、平移）。
- 点击拾取表面点，显示 `_obj` 坐标与表面法向。
- 可放置并拖动接触圆盘标记：center 随拾取/拖动更新，normal 默认取邻域拟合（`auto_fitted`），radius 可调。
- 法向箭头可视化，方向朝外；切向参考以另一颜色箭头显示，并实时提示其与法向是否接近平行。
- 支持切换线框/实体显示，便于看清平面区域。

### 4.2 多抓取方式管理

- 侧栏列表显示所有 `grasp_id`，按 `priority` 排序。
- 支持新增、复制、重命名、删除、修改 `priority`、切换 `status`、编辑 `notes`。
- 选中条目时 3D 视图高亮其圆盘与候选点。
- 编辑 center / normal / radius / tangent_ref 实时更新视图与内存数据。
- `candidate_points` 子数组：在当前选中方式下增删候选点，每点带 `score`，视图中以小圆点显示，与 center 区分颜色。
- `grasp_id` 重复时阻止保存并提示。
- 有未保存更改时 `beforeunload` 提示。

### 4.3 法向编辑

- 默认 `auto_fitted`：拾取点邻域拟合平面法向作为初值。
- 人工可拖拽箭头或直接输入分量修改，修改后 `normal_source` 置 `manual_corrected`；清空重输置 `manual`。
- 导出前强制归一化；UI 显示当前模长与是否已归一化。
- 法向箭头必须始终可见且方向与 `normal_convention` 一致。

### 4.4 导入 / 导出 / 持久化

- 导出：生成符合 schema 的 JSON 文件下载，导出前跑一遍与 `validate_annotation.py` 等价的校验，不通过则阻止并提示。
- 导入：读取 JSON，校验后恢复全部抓取方式并渲染；非法文件给明确错误且不破坏当前编辑状态。
- localStorage 自动保存草稿，页面加载时提示恢复。
- 导出文件名默认 `{object_id}_grasps.json`。

## 5. 阶段计划与验收

### 阶段 1：数据契约与校验层

交付 3.3 全部内容。验收 3.4。**此阶段完成后 schema 冻结**，后续只读不改，除非发现结构性缺陷并显式记录变更。

### 阶段 2：OBJ 加载与 3D 视图

交付 4.1。验收：

- 能加载至少两个不同 OBJ。
- 点击表面显示 `_obj` 坐标与法向。
- 圆盘可拖动，法向箭头朝外可见。
- **坐标一致性测试**：加载一个含已知顶点的简单 OBJ，断言拾取/显示坐标与文件顶点一致，不引入额外变换。此测试必须先通过再进入阶段 3。

### 阶段 3：多抓取方式管理与法向编辑

交付 4.2、4.3。验收：

- 新增/删除/编辑任一 `grasp_id` 不影响其他条目。
- 导出 JSON 通过阶段 1 校验。
- `grasp_id` 重复被阻止。
- 法向修改后 `normal_source` 正确变化；平行切向参考被提示。
- 端到端手测：定义两个抓取方式、各带候选点、导出、导入、再导出，语义等价。

### 阶段 4：导入 / 导出 / 持久化

交付 4.4。验收：

- 导出 → 导入 → 再导出语义等价。
- 导入非法 JSON 给明确错误且不破坏编辑状态。
- localStorage 恢复可用。

### 阶段 5：下游接口文档与参考变换脚本

交付：

- `docs/downstream_interface.md`：说明下游如何用 \( T_{\text{obj}}^{\text{cam}} \)、\( T_{\text{cam}}^{\text{base}} \) 变换 `center_obj`、`normal_obj`、`tangent_ref_obj`；如何组装 Z 轴沿 `-normal_base`、X 轴由切向参考投影锁定的末端 6D 位姿；如何加预接近偏移；`radius_m` 作为在线校验容差的用法；`status` 与 `pose_source_confidence` 透传建议；`SuctionGrasp` 字段映射示例。
- `reference/transform_grasp.py`：纯 numpy 参考实现，输入标注 JSON、物体位姿、外参，输出每个 `grasp_id` 的 position、quaternion、approach_direction、pre_offset。
- 文档中含在线校验伪代码：以变换后 center 为圆心、`radius_m` 为半径，检查实测深度/法向/遮挡。

验收：

- 单位变换下输出 position 等于 `center_obj`、approach_direction 等于 `-normal_obj`。
- 一个非平凡旋转位姿下变换结果与手算一致。
- 切向参考退化时脚本报错或给出明确降级策略。

## 6. 目录结构建议

```
suction-annotator/
  index.html
  src/
    main.js
    viewer.js
    obj_loader.js
    grasp_model.js
    ui_sidebar.js
    normal_editor.js
    io.js
  schema/
    grasp_annotation.schema.json
  validate_annotation.py
  examples/
    plug_type_a.json
  tests/
    fixtures/invalid/*.json
    coord_consistency.test.js
  reference/
    transform_grasp.py
  docs/
    downstream_interface.md
  README.md
```

## 7. 明确不做的事

- 不做自动抓取规划或自动候选点生成（人工定义是需求）。
- 不做后端服务、用户系统、数据库。
- 不做机器人驱动或 ROS 节点，只到参考变换脚本与文档。
- 不在本工具内做位姿估计或在线校验实现，只留接口文档与伪代码。
- 不引入 Three.js 以外的重型 3D 框架。
- 不做多物体/多实例管理，模板按 `object_id` 单文件维护。

## 8. 下游使用摘要（写入 README 与 docs）

下游拿到标注 JSON 和物体当前 6D 位姿后：

1. 过滤 `status == "deprecated"`，按 `priority` 升序。
2. 选执行点：`center_obj` 或 `candidate_points` 中 `score` 最高者。
3. 用 \( T_{\text{obj}}^{\text{base}} = T_{\text{cam}}^{\text{base}} \cdot T_{\text{obj}}^{\text{cam}} \) 变换 center、normal、tangent_ref 到基坐标系。
4. 组装末端位姿：Z 轴 = `-normal_base`，X 轴 = `tangent_ref_base` 在垂直于 Z 平面的投影归一化，Y 轴 = Z × X。
5. 加预接近偏移：沿 `+normal_base` 退开 `pre_offset_m`，再沿 `-normal_base` 直线进给。
6. 输出 position、quaternion、approach_direction、`grasp_id`、`status`、`pose_source_confidence`。
7. 执行前用 `radius_m` 在当前 RGB-D 帧做接触区域一致性校验；不通过则按 `priority` 切换下一个条目，耗尽则跳过该实例并记录日志。

## 9. 给 Codex 的执行顺序

1. 先完成阶段 1 并冻结 schema。
2. 完成阶段 2，**坐标一致性测试通过后才继续**。
3. 完成阶段 3 并端到端手测。
4. 完成阶段 4。
5. 完成阶段 5，参考脚本加单元测试（单位变换 + 非平凡旋转）。
6. 每阶段结束在 `README.md` 记录完成状态与已知限制。

---

这份规格把数据契约放在最前并冻结，把坐标一致性作为阶段 2 的硬门槛，把下游变换和在线校验写成可验收的文档与脚本，同时明确划定了不做的事，避免 Codex 范围蔓延。