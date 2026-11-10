import * as THREE from "../vendor/three/three.module.js";

export function tangentFor(normal) {
  const n = new THREE.Vector3(...normal).normalize();
  const axis =
    Math.abs(n.x) < 0.8
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
  return axis.addScaledVector(n, -axis.dot(n)).normalize().toArray();
}

// Small symmetric 3x3 Jacobi eigensolver: the least eigenvector is a plane normal.
export function fitPlaneNormal(points, orientation) {
  if (points.length < 3) return [...orientation];
  const mean = [0, 0, 0];
  for (const p of points)
    for (let i = 0; i < 3; i++) mean[i] += p[i] / points.length;
  const matrix = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (const p of points)
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        matrix[i][j] += (p[i] - mean[i]) * (p[j] - mean[j]);
      }
  const vectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let iteration = 0; iteration < 24; iteration++) {
    let p = 0,
      q = 1;
    for (const [i, j] of [
      [0, 2],
      [1, 2],
    ])
      if (Math.abs(matrix[i][j]) > Math.abs(matrix[p][q])) {
        p = i;
        q = j;
      }
    if (
      Math.abs(matrix[p][q]) <=
      1e-14 * Math.max(1e-20, ...matrix.map((row, i) => Math.abs(row[i])))
    )
      break;
    const angle =
      0.5 * Math.atan2(2 * matrix[p][q], matrix[q][q] - matrix[p][p]);
    const c = Math.cos(angle),
      s = Math.sin(angle);
    const app = matrix[p][p],
      aqq = matrix[q][q],
      apq = matrix[p][q];
    for (let k = 0; k < 3; k++) {
      if (k !== p && k !== q) {
        const akp = matrix[k][p],
          akq = matrix[k][q];
        matrix[k][p] = matrix[p][k] = c * akp - s * akq;
        matrix[k][q] = matrix[q][k] = s * akp + c * akq;
      }
      const vkp = vectors[k][p],
        vkq = vectors[k][q];
      vectors[k][p] = c * vkp - s * vkq;
      vectors[k][q] = s * vkp + c * vkq;
    }
    matrix[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    matrix[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    matrix[p][q] = matrix[q][p] = 0;
  }
  const ordered = [0, 1, 2].sort((a, b) => matrix[a][a] - matrix[b][b]);
  // Collinear points do not determine a plane.
  if (
    matrix[ordered[1]][ordered[1]] <
    Math.max(1e-24, matrix[ordered[2]][ordered[2]] * 1e-10)
  )
    return [...orientation];
  const n = new THREE.Vector3(
    ...vectors.map((row) => row[ordered[0]]),
  ).normalize();
  if (n.dot(new THREE.Vector3(...orientation)) < 0) n.negate();
  return n.toArray();
}

export function fitSurfaceNormal(root, center, radius, faceNormal) {
  const candidates = new Map();
  const point = new THREE.Vector3();
  const centerVector = new THREE.Vector3(...center);
  root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const positions = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.index;
    for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
      const vertices = [0, 1, 2].map((j) =>
        new THREE.Vector3().fromBufferAttribute(
          positions,
          index ? index.getX(i + j) : i + j,
        ),
      );
      const normal = vertices[1]
        .clone()
        .sub(vertices[0])
        .cross(vertices[2].clone().sub(vertices[0]))
        .normalize();
      if (normal.dot(new THREE.Vector3(...faceNormal)) < 0.6) continue;
      for (const vertex of vertices) {
        point.copy(vertex).applyMatrix4(mesh.matrixWorld);
        root.worldToLocal(point);
        if (point.distanceToSquared(centerVector) <= radius * radius) {
          candidates.set(point.toArray().join(","), point.toArray());
        }
      }
    }
  });
  return fitPlaneNormal([...candidates.values()], faceNormal);
}
