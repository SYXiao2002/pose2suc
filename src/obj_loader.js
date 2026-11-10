import * as THREE from "../vendor/three/three.module.js";
import { OBJLoader } from "../vendor/three/OBJLoader.js";

// Camera framing is deliberately separate: never center(), scale or rotate this object.
export function parseOBJ(text) {
  const object = new OBJLoader().parse(text);
  let triangles = 0;
  object.traverse((child) => {
    if (!child.isMesh) return;
    const positions = child.geometry.getAttribute("position");
    triangles += (child.geometry.index?.count ?? positions.count) / 3;
    if (!child.geometry.getAttribute("normal"))
      child.geometry.computeVertexNormals();
    child.material = new THREE.MeshStandardMaterial({
      color: 0xb4c8cc,
      roughness: 0.7,
      metalness: 0.08,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
  });
  if (!triangles) throw new Error("OBJ 中没有可显示的三角面。");
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  if (
    bounds.isEmpty() ||
    ![...bounds.min, ...bounds.max].every(Number.isFinite)
  ) {
    throw new Error("OBJ 包含非法顶点坐标。");
  }
  return { object, bounds, triangles };
}

export async function fetchOBJ(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`OBJ 读取失败 (${response.status})`);
  return parseOBJ(await response.text());
}

export function surfaceHit(intersection, root) {
  const point = root.worldToLocal(intersection.point.clone());
  // Geometric winding, independent of camera-facing interpolated shading normals.
  const normal = intersection.face.normal
    .clone()
    .applyNormalMatrix(
      new THREE.Matrix3().getNormalMatrix(intersection.object.matrixWorld),
    );
  normal.transformDirection(root.matrixWorld.clone().invert()).normalize();
  return { point_obj: point.toArray(), normal_obj: normal.toArray() };
}
