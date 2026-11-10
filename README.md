# Pose2Suc · 吸盘抓取标注

纯前端离线标注 OBJ 表面抓取区域。几何量始终使用 OBJ 原始物体坐标，长度单位为米。

## 启动

不需要安装前端依赖即可使用。仓库已包含 Three.js 0.180.0 及所用加载器/控制器，运行时无 CDN、无后端、无上传。

```bash
cd /home/yixiaoshen/Repo/pose2suc
python3 -m http.server 8080 --bind 127.0.0.1
```

浏览器打开 <http://localhost:8080>。也可使用 Node.js 22+ 运行 `npm start`，用 `PORT=8081 npm start` 修改端口。请通过本地 HTTP 打开，不要双击 `index.html`（浏览器会阻止本地 ES 模块与资源读取）。

默认自动打开 `demo_data/mesh_eu-plug/TexturedMeshSimplified.obj`，示例菜单可切换到 `demo_data/cube.obj`。上传自有 OBJ 后始终保留文件顶点坐标，相机取景不会修改模型。网页所有处理与 localStorage 草稿都在当前浏览器中进行。

首次本地启动即可在无互联网的环境运行。浏览器显示「离线资源就绪」后，Service Worker 还支持本地 HTTP 服务关闭后的离线刷新（localhost 或 HTTPS）。草稿和缓存按站点地址区分，切换端口或浏览器不会共享草稿。更新应用资源后应正常联网到本地服务刷新；若修改预缓存文件列表，请更新 `sw.js` 的缓存版本。

## 标注步骤

1. 在模型表面点击创建第一个圆盘，或点击左栏 `＋` 后再拾取表面。按左键拖动旋转、滚轮缩放、右键拖动平移；「重置视图」仅改变相机。
2. 选中抓取方式后，使用「放置圆盘」重新拾取圆心，或拖动圆心/圆盘；右栏可直接输入原始 `_obj` 分量和 `radius_m`。橙色箭头为朝外法向，紫色箭头为切向，白色点为执行锚点。
3. **人工确认橙色箭头朝外**。可拖动橙色箭头端点、翻转方向、输入分量或重新拟合。已有法向的修改记为 `manual_corrected`；「清空手输」后输入记为 `manual`；重新拟合记为 `auto_fitted`。移动圆心时保留人工指定的法向，自动法向则随拾取更新。
4. 设置非平行切向以锁定绕法向的旋转；「自动正交」可生成参考方向。UI 实时提示法向模长和切向投影；导出自动归一化两个向量，零向量、平行向量和未完成输入会阻止导出。
5. 切换「添加候选点」后在表面逐点点击，或将圆心手动加入候选点。蓝点与白色圆心区分，每个候选点可编辑坐标、score 和删除。「查看坐标」只读拾取，不改变标注。
6. 新增、复制、重命名或删除抓取方式；每项的几何、候选点和备注独立。优先级为 ≥1 的整数，数值越小优先级越高；记录 `pending` / `verified` / `deprecated` 和实吸备注。
7. 设置 `object_id`，点击「导出标注」下载 `{object_id}_grasps.json`。重复 `grasp_id` 不能保存；导出前校验失败会显示字段级原因。

「导入 JSON」先完整校验再替换当前标注，非法文件不改变当前模型或编辑内容。JSON 不包含 OBJ，导入时请确认当前模型与 `object_id` 对应。打开另一 OBJ 将开始新模板；有现存抓取方式时会先提示保留标注。

编辑后自动保存草稿（含上传的 OBJ 原文），刷新时通过横幅选择恢复或忽略。支持保存尚未输完的数值草稿。localStorage 容量通常为几 MB，过大的 OBJ 或浏览器存储禁用时会明确提示保存失败，应及时导出 JSON。有未导出更改时关闭/刷新页面会触发浏览器的离开提示。

## 实现进度

- 阶段 1：已完成。v1.0 schema 冻结；标准库 Python 校验器覆盖结构、单位向量、切向投影和 ID 唯一性，示例与六类反例已验证。
- 阶段 2：已完成。两个 OBJ 加载与离原点的已知顶点/射线拾取坐标一致性测试通过；相机取景不改变模型变换，支持圆盘拖动与邻域平面拟合。
- 阶段 3：已完成。多抓取方式、复制独立性、候选点、法向来源、法向/圆盘拖动、重复 ID 拦截已通过浏览器端到端验收；两套含候选点的抓取方式完成导出、导入、再导出，语义一致。
- 阶段 4：已完成。完整校验的 JSON 导入/导出、非法导入不破坏状态、含本地 OBJ 的草稿恢复、未导出离开提示与离线刷新已验证。
- 阶段 5：已完成。[下游接口文档](docs/downstream_interface.md) 与 numpy 参考脚本交付；单位变换、非平凡旋转、四元数、预接近偏移与切向退化测试通过。

## 契约与校验

`schema/grasp_annotation.schema.json` 的 `x-unitVector`、`x-nonParallel`、`x-uniqueBy` 是语义约束扩展，普通 JSON Schema 引擎不会执行它们。完整验收请使用 `python3 validate_annotation.py examples/plug_type_a.json`。所有数值必须有限；法向与切向单位长度容差为 1e-3，切向投影须大于 1e-3。

```bash
python3 validate_annotation.py examples/plug_type_a.json
python3 validate_annotation.py tests/fixtures/invalid/parallel_tangent.json
```

成功退出码为 0，失败为 1，失败输出逐字段原因。Python 使用标准库，前端读取同一冻结 schema 并实现相同语义扩展，测试对两端有效性判断进行交叉比对。`notes` 和 `candidate_points` 可省略；导入合法标注会保留这两个可选字段的原有存在状态。

## 下游使用

1. 过滤 `status == "deprecated"`，按 `priority` 升序处理。
2. 执行点默认取 `center_obj`，也可选本方式中 score 最高的候选点。
3. `T_obj_base = T_cam_base @ T_obj_cam`，用旋转和平移变换执行点，用旋转变换法向和切向。
4. 工具 Z 轴为 `-normal_base`，X 轴为切向在法平面的投影归一化，Y 轴为 Z × X；四元数顺序是 xyzw。
5. 预接近位置沿 `+normal_base` 退开 `pre_offset_m`，然后沿 `-normal_base` 进给。
6. 透传 `grasp_id`、`status` 和本次实例位姿的 `pose_source_confidence`。
7. 执行前围绕变换后的区域圆心，用 `radius_m` 在当前 RGB-D 帧做深度、法向与遮挡一致性校验；失败则换下一种方式，全部失败则跳过实例并记录日志。

```bash
python3 -m pip install -r reference/requirements.txt
python3 reference/transform_grasp.py examples/plug_type_a.json \
  --object-pose examples/T_obj_cam.json \
  --extrinsics examples/T_cam_base.json \
  --pre-offset-m 0.05 --pose-source-confidence 0.92
```

矩阵文件为 JSON 4×4 数组，不传时为单位矩阵。输出 position、quaternion、approach_direction、pre_offset 等字段。切向退化或非刚体矩阵会报错。完整公式、SuctionGrasp 字段映射及在线校验伪代码见 [docs/downstream_interface.md](docs/downstream_interface.md)。

## 开发与测试

```bash
npm ci                         # 仅开发/测试需要，运行网页不需要
npm test                       # 7 项 Node 测试，含坐标一致性与 Python/JS 校验交叉检查
python3 -m unittest discover -s tests -v  # 9 项 Python 测试，变换测试需要 numpy
npm run test:e2e                # 5 项浏览器测试，默认使用 /usr/bin/google-chrome
```

浏览器路径不同可设置 `CHROME_PATH=/path/to/chromium npm run test:e2e`。浏览器测试包括实际画布拾取与拖动、两方式 JSON 往返、非法输入保护、OBJ/草稿恢复以及断网刷新。`npm run vendor` 可从锁定版本的 node_modules 重新复制本地 Three.js 文件，许可证在 `vendor/three/LICENSE`。

## 已知限制

- OBJ 必须使用米，与下游位姿使用同一模型原点；工具不自动检测单位。Three.js 顶点采用 Float32，拾取存在相应浮点误差，但无额外坐标变换。
- 自动拟合只提供法向初值；开放网格、错误绕序与尖锐边缘可能需要人工修正。`verified` 需使用者实吸后回填，工具不自动确认物理可抓取性。
- 使用统一实体/线框材质，当前不读取 MTL 和纹理，不影响几何坐标。大型 OBJ 的解析与邻域拟合在主线程执行。
- 半径仅用于容差/在线验证，不表示吸盘尺寸；圆盘是三维平面标记，不裁剪到实际模型表面。
- 一次只维护一个物体模板；不包含自动抓取规划、位姿估计、RGB-D 校验实现、机器人驱动或 ROS 节点。
