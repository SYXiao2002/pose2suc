const CACHE = "pose2suc-v1.0.0";
const FILES = [
  "./",
  "./index.html",
  "./src/style.css",
  "./src/main.js",
  "./src/viewer.js",
  "./src/obj_loader.js",
  "./src/grasp_model.js",
  "./src/normal_editor.js",
  "./src/ui_sidebar.js",
  "./src/io.js",
  "./src/validation.js",
  "./vendor/three/three.module.js",
  "./vendor/three/three.core.js",
  "./vendor/three/OBJLoader.js",
  "./vendor/three/OrbitControls.js",
  "./schema/grasp_annotation.schema.json",
  "./examples/plug_type_a.json",
  "./demo_data/cube.obj",
  "./demo_data/mesh_eu-plug/TexturedMeshSimplified.obj",
  "./docs/downstream_interface.md",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("pose2suc-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin
  )
    return;
  const path = new URL(event.request.url).pathname;
  // Cache only shipped application assets. Never cache arbitrary files on the same server.
  const known = FILES.some(
    (file) => new URL(file, self.registration.scope).pathname === path,
  );
  if (!known) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE).then((cache) => cache.put(event.request, copy)),
          );
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((cached) => cached || Response.error()),
      ),
  );
});
