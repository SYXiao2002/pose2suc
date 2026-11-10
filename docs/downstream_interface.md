# 下游接口与坐标变换

标注 JSON 是按 `object_id` 复用的物体模板，不包含任何实例位姿。所有 `_obj` 向量和顶点使用 OBJ 的原始右手坐标系，长度单位必须是米。前端不会为毫米模型自动缩放：请在导入前在建模工具中转换单位，并同步更新位姿所用模型。`radius_m` 不用于修改末端执行位置。

## 数据契约与法向

`schema/grasp_annotation.schema.json` 在阶段 1 冻结为 v1.0。结构约束使用 JSON Schema 2020-12；`x-unitVector`、`x-nonParallel`、`x-uniqueBy` 扩展分别约束单位向量、切向投影和抓取 ID 唯一性。普通 JSON Schema 校验不能替代完整校验：使用 `python3 validate_annotation.py your_object_grasps.json` 或前端相同校验器。schema 没有后续结构修改。

`normal_convention` 固定为 `outward_surface`：`normal_obj` 指向物体表面外侧。前端邻域最小二乘平面拟合取最小特征值方向，并按拾取三角面的顶点绕序定向；邻域不足或退化时退回三角面法向。网格不闭合、绕序错误或尖锐边缘时，人工必须检查橙色箭头并翻转/编辑。软件无法仅从任意 OBJ 保证真实朝外方向。

`auto_fitted` 表示自动初值，修正已有法向或拖动箭头记为 `manual_corrected`，清空后重新输入记为 `manual`。导出归一化法向与切向，不会自动翻转法向，也不会替使用者消除平行切向。

## 从物体坐标变换到基坐标

采用列向量，`T_obj_cam`（\(T_{\mathrm{obj}}^{\mathrm{cam}}\)）把物体坐标变换到相机坐标，`T_cam_base`（\(T_{\mathrm{cam}}^{\mathrm{base}}\)）把相机坐标变换到机器人基坐标。矩阵是行优先 JSON 数组，但数学上仍左乘列向量：

\[
T_{\mathrm{obj}}^{\mathrm{base}} = T_{\mathrm{cam}}^{\mathrm{base}} T_{\mathrm{obj}}^{\mathrm{cam}} = \begin{bmatrix}R&t\\0&1\end{bmatrix}.
\]

\[
c_{base}=R c_{obj}+t,\quad n_{base}=R n_{obj},\quad r_{base}=R r_{obj}.
\]

平移仅作用于点；法向与切向只乘旋转。矩阵必须为刚体变换，旋转正交且行列式为 +1。参考实现拒绝缩放、反射、非齐次矩阵和非有限值。

组装末端旋转矩阵：

\[
z=-n_{base},\quad x=\frac{r_{base}-(r_{base}\cdot z)z}{\|r_{base}-(r_{base}\cdot z)z\|},\quad y=z\times x,\quad R_{tool}^{base}=[x\ y\ z].
\]

因此工具 +Z 朝向物体内部，是进给方向。四元数使用 `[x, y, z, w]`，表示工具坐标到基坐标的主动旋转，必须根据实际机器人 API 调整分量顺序与工具 TCP 标定。切向投影长度 ≤ 1e-3 时明确报错，无静默降级。

预接近位置：`pregrasp_position = position + normal_base * pre_offset_m`。先到预接近位置，再沿 `approach_direction = -normal_base` 直线进给。返回的 `pre_offset` 是基坐标系三维偏移向量，`pre_offset_m` 是标量距离。参考实现默认距离为 0.05 m，允许配置为零。

## 选择抓取与执行点

1. 过滤 `status == "deprecated"`，按 `priority` 升序；相同优先级时按 `grasp_id` 排序。
2. 默认执行 `center_obj`。传入 `--use-best-candidate` 时选同一抓取方式下最高 `score` 的候选点；没有候选点则使用圆心，同分选原数组中第一个。
3. 变换执行点、法向和切向，组装位姿与预接近偏移。
4. 透传 `grasp_id`、`status`、`notes` 与实例位姿的 `pose_source_confidence`。后者是本次实例推理结果，不写入冻结的模板 schema；未知时输出 `null`。
5. 使用变换后的 **contact_region.center_obj** 和 `radius_m` 做在线接触区域校验；失败则按优先级切换抓取方式，耗尽后跳过该实例并记录原因。

`pending` 表示尚未实吸验证，`verified` 表示已有实吸记录，`deprecated` 表示不再使用。参考脚本保留前两种并透传状态；实际执行策略可仅允许 `verified`，或要求人工批准 `pending`。

候选点是人工定义的同一抓取方式的备用执行点，并非自动规划结果。选择偏离圆心的候选点时，仍保留模板圆心用于既定区域校验，并应额外验证该候选点周围实际吸盘足迹，不能把 `radius_m` 当作工具位移或吸盘实际物理半径。

## 参考脚本

仅需 Python 与 numpy；校验脚本本身只用标准库。

```bash
python3 -m pip install -r reference/requirements.txt
python3 reference/transform_grasp.py examples/plug_type_a.json
python3 reference/transform_grasp.py examples/plug_type_a.json \
  --object-pose examples/T_obj_cam.json \
  --extrinsics examples/T_cam_base.json \
  --pre-offset-m 0.05 --pose-source-confidence 0.92 \
  --output /tmp/plug_poses.json
```

不传矩阵时为单位变换，输出 position 为 `[0.012, 0.003, 0.045]`、进给方向 `[0, 0, -1]`。非平凡示例中：先绕相机 Z 轴旋转 90° 再平移 `[0.1, 0.2, 0.3]`，再通过绕 X 轴旋转 90°、平移 `[0.4, 0.5, 0.6]` 的外参。手算得到 `position = [0.497, 0.155, 0.812]`、`normal_base = [0, -1, 0]`、`approach_direction = [0, 1, 0]`、预接近位置 `[0.497, 0.105, 0.812]`。

Python 调用：

```python
from reference.transform_grasp import transform_annotation
poses = transform_annotation(annotation, T_obj_cam, T_cam_base,
                             pre_offset_m=0.05, pose_source_confidence=0.92)
```

返回每个 `grasp_id` 的 `position`、`quaternion`、`quaternion_order`、`approach_direction`、`pre_offset`、`pre_offset_m`、`pregrasp_position`、`contact_center_base`、`normal_base`、`tangent_ref_base`、`radius_m`、`priority`、`status`、`notes`、`normal_source`、`execution_point_source`、`pose_source_confidence`。

## SuctionGrasp 字段映射示例

下列为普通数据结构示例，不依赖 ROS 或特定机器人驱动。

| SuctionGrasp 字段 | 参考输出 / 来源 | 语义 |
|---|---|---|
| `object_id` | 模板 `object_id` | 物体类型 |
| `grasp_id` | `grasp_id` | 独立抓取方式 |
| `pose.position` | `position` | 基坐标执行锚点，m |
| `pose.orientation` | `quaternion` | xyzw，工具到基坐标 |
| `approach_direction` | `approach_direction` | 基坐标下进给单位向量 |
| `pregrasp_position` | `pregrasp_position` | 预接近位置，m |
| `contact_center` | `contact_center_base` | 区域校验圆心 |
| `contact_radius` | `radius_m` | 容差半径，不进入运动指令 |
| `priority`, `status`, `notes` | 同名输出 | 方式优先级与实吸结果 |
| `pose_source_confidence` | 当前实例推理结果 | [0,1] 或 null |

## RGB-D 在线校验伪代码

这是下游接口建议，工具内不实现深度分析、规划、位姿估计或机器人控制。所有深度点需先变换到同一个基坐标，阈值由传感器噪声、材质与实际吸盘决定。

```python
for grasp in sorted(non_deprecated_grasps, key=lambda g: g.priority):
    center, n, tangent = transform_region(grasp, T_cam_base @ T_obj_cam)
    # 从当前深度反投影得到可见基坐标点，并保留原像素/缺失深度掩码。
    points, observed_normals, pixel_mask = rgbd_points_in_base(current_rgbd)
    delta = points - center
    plane_error = abs(delta @ n)
    tangent_delta = delta - (delta @ n)[:, None] * n
    footprint = norm(tangent_delta, axis=1) <= grasp.contact_region.radius_m
    # 先按区域在当前相机的投影评估覆盖率，不能仅对已有深度点统计可见性。
    projected_disk = project_disk_to_image(center, n, grasp.contact_region.radius_m)
    if valid_depth_coverage(projected_disk, pixel_mask) < min_coverage:
        continue  # 缺深度 / 遮挡
    if not footprint.any():
        continue
    if percentile(plane_error[footprint], 95) > depth_tolerance_m:
        continue  # 接触面高度不一致
    # 实测法向也需朝外定向后比较，禁止无条件 abs(dot) 掩盖反向。
    if min(dot(observed_normals[footprint], n)) < cos(max_normal_angle):
        continue
    if foreground_occluder_in_approach_corridor(projected_disk, center, n):
        continue
    execution_point = choose_center_or_best_candidate(grasp)
    if not validate_actual_cup_footprint(execution_point, current_rgbd):
        continue
    emit_suction_grasp(grasp, execution_point, pose_source_confidence)
    break
else:
    log_and_skip_instance("no consistent contact region")
```
