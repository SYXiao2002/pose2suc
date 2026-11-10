import { copyFile, mkdir } from "node:fs/promises";

const files = [
  ["build/three.core.js", "three.core.js"],
  ["build/three.module.js", "three.module.js"],
  ["examples/jsm/loaders/OBJLoader.js", "OBJLoader.js"],
  ["examples/jsm/controls/OrbitControls.js", "OrbitControls.js"],
  ["LICENSE", "LICENSE"],
];
await mkdir("vendor/three", { recursive: true });
for (const [source, target] of files) {
  await copyFile(`node_modules/three/${source}`, `vendor/three/${target}`);
}
console.log("Vendored Three.js 0.180.0; no runtime network dependencies.");
