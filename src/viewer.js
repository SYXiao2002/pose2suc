import * as THREE from "../vendor/three/three.module.js";
import { OrbitControls } from "../vendor/three/OrbitControls.js";
import { parseOBJ, surfaceHit } from "./obj_loader.js";
import { fitSurfaceNormal, tangentFor } from "./normal_editor.js";

const vector = (a) => new THREE.Vector3(...a);
const usable = (a) =>
  Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);

function disposeTree(root) {
  root?.traverse((child) => {
    child.geometry?.dispose();
    for (const material of [child.material].flat()) material?.dispose();
  });
  root?.removeFromParent();
}

export class Viewer {
  constructor(container, callbacks = {}) {
    this.callbacks = callbacks;
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.00001, 1000);
    this.camera.up.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute("aria-label", "OBJ 物体坐标系三维视图");
    container.append(this.canvas);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xdcefff, 0x59606e, 2.8));
    const light = new THREE.DirectionalLight(0xffffff, 3.2);
    light.position.set(2, -3, 5);
    this.camera.add(light);
    this.scene.add(this.camera);
    this.raycaster = new THREE.Raycaster();
    this.markers = new THREE.Group();
    this.scene.add(this.markers);
    this.span = 0.1;
    this.wireframe = false;
    this.grasps = [];
    this.activeId = null;
    // Capture runs before OrbitControls: dragging a marker must not orbit the camera.
    this.canvas.addEventListener(
      "pointerdown",
      (event) => this.pointerDown(event),
      true,
    );
    this.canvas.addEventListener("pointermove", (event) =>
      this.pointerMove(event),
    );
    this.canvas.addEventListener("pointerup", (event) => this.pointerUp(event));
    this.canvas.addEventListener("pointercancel", () => this.cancelDrag());
    this.canvas.addEventListener("lostpointercapture", () => {
      if (this.drag) this.cancelDrag();
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  load(text) {
    const loaded = parseOBJ(text); // Parse first: a failed load leaves the previous model intact.
    disposeTree(this.model);
    disposeTree(this.axes);
    disposeTree(this.grid);
    this.model = loaded.object;
    this.bounds = loaded.bounds;
    this.span = Math.max(
      loaded.bounds.getSize(new THREE.Vector3()).length(),
      0.000001,
    );
    this.scene.add(this.model);
    this.axes = new THREE.AxesHelper(this.span * 0.45);
    this.axes.material.depthTest = false;
    this.axes.renderOrder = 5;
    this.scene.add(this.axes);
    this.grid = new THREE.GridHelper(this.span * 2, 20, 0x32444f, 0x1f2c36);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.position.z = loaded.bounds.min.z - this.span * 0.03;
    this.scene.add(this.grid);
    this.setWireframe(this.wireframe);
    this.fitCamera();
    this.setGrasps(this.grasps, this.activeId);
    return loaded;
  }

  fitCamera() {
    if (!this.bounds) return;
    const center = this.bounds.getCenter(new THREE.Vector3());
    this.controls.target.copy(center);
    this.camera.position
      .copy(center)
      .add(new THREE.Vector3(1.1, -1.5, 1.0).multiplyScalar(this.span));
    this.camera.near = this.span / 10000;
    this.camera.far = this.span * 10000;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = this.span * 0.015;
    this.controls.maxDistance = this.span * 100;
    this.controls.update();
    this.camera.updateMatrixWorld(true);
  }

  setWireframe(value) {
    this.wireframe = value;
    this.model?.traverse((child) => {
      if (child.isMesh) child.material.wireframe = value;
    });
  }

  setGrasps(grasps, activeId) {
    this.grasps = grasps;
    this.activeId = activeId;
    for (const child of [...this.markers.children]) disposeTree(child);
    for (const grasp of grasps) {
      const region = grasp.contact_region;
      if (!usable(region.center_obj)) continue;
      const selected = grasp.grasp_id === activeId;
      const center = vector(region.center_obj);
      const normal =
        usable(region.normal_obj) && vector(region.normal_obj).length() > 1e-12
          ? vector(region.normal_obj).normalize()
          : new THREE.Vector3(0, 0, 1);
      const radius =
        Number.isFinite(region.radius_m) && region.radius_m > 0
          ? region.radius_m
          : this.span * 0.05;
      const color = selected ? 0x58e2bc : 0x6c8ba5;
      const group = new THREE.Group();
      group.position.copy(center);
      const disk = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 64),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: selected ? 0.23 : 0.09,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      disk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      disk.userData = { kind: "center", id: grasp.grasp_id };
      group.add(disk);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(
          radius,
          this.span * (selected ? 0.0018 : 0.001),
          6,
          72,
        ),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      rim.quaternion.copy(disk.quaternion);
      rim.renderOrder = 6;
      rim.userData = { kind: "center", id: grasp.grasp_id };
      group.add(rim);
      const dot = this.sphere(
        Math.max(this.span * 0.004, radius * 0.045),
        0xffffff,
      );
      dot.userData = { kind: "center", id: grasp.grasp_id };
      group.add(dot);
      const length = Math.max(this.span * 0.14, radius * 1.5);
      const arrow = new THREE.ArrowHelper(
        normal,
        new THREE.Vector3(),
        length,
        selected ? 0xffba69 : 0xaf8e70,
        this.span * 0.024,
        this.span * 0.014,
      );
      for (const part of [arrow.line, arrow.cone]) {
        part.material.depthTest = false;
        part.renderOrder = 10;
      }
      group.add(arrow);
      if (selected) {
        const handle = this.sphere(this.span * 0.009, 0xffba69);
        handle.position.copy(normal).multiplyScalar(length);
        handle.userData = { kind: "normal", id: grasp.grasp_id, length };
        group.add(handle);
        const tangent = usable(region.tangent_ref_obj)
          ? vector(region.tangent_ref_obj)
          : vector(tangentFor(normal.toArray()));
        if (tangent.length() > 1e-12) {
          const tangentArrow = new THREE.ArrowHelper(
            tangent.normalize(),
            new THREE.Vector3(),
            length * 0.8,
            0x9b9bff,
            this.span * 0.02,
            this.span * 0.012,
          );
          for (const part of [tangentArrow.line, tangentArrow.cone]) {
            part.material.depthTest = false;
            part.renderOrder = 9;
          }
          group.add(tangentArrow);
        }
      }
      this.markers.add(group);
      for (const candidate of grasp.candidate_points ?? []) {
        if (!usable(candidate.point_obj)) continue;
        const point = this.sphere(
          this.span * (selected ? 0.0065 : 0.004),
          selected ? 0x75b7ff : 0x436281,
        );
        point.position.copy(vector(candidate.point_obj));
        point.userData = { kind: "candidate", id: grasp.grasp_id };
        this.markers.add(point);
      }
    }
    this.markers.updateMatrixWorld(true);
  }

  sphere(radius, color) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 12, 8),
      new THREE.MeshBasicMaterial({ color, depthTest: false }),
    );
    mesh.renderOrder = 12;
    return mesh;
  }

  aim(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
  }

  pick(event, fit = true) {
    if (!this.model) return null;
    this.aim(event);
    const hit = this.raycaster.intersectObject(this.model, true)[0];
    if (!hit) return null;
    const result = surfaceHit(hit, this.model);
    if (fit) {
      const active = this.grasps.find(
        (grasp) => grasp.grasp_id === this.activeId,
      );
      const radius = active?.contact_region.radius_m || this.span * 0.04;
      result.normal_obj = fitSurfaceNormal(
        this.model,
        result.point_obj,
        radius,
        result.normal_obj,
      );
    }
    return result;
  }

  pointerDown(event) {
    if (event.button !== 0 || !this.model) return;
    this.aim(event);
    this.pointerStart = { x: event.clientX, y: event.clientY };
    if (this.mode && this.mode !== "center") return;
    const hits = this.raycaster
      .intersectObject(this.markers, true)
      .filter((hit) => hit.object.userData.kind);
    const handle =
      hits.find((hit) => hit.object.userData.kind === "normal") ?? hits[0];
    if (!handle) return;
    const data = handle.object.userData;
    this.callbacks.onSelect?.(data.id);
    if (data.kind === "candidate") return;
    this.controls.enabled = false;
    const grasp = this.grasps.find((item) => item.grasp_id === data.id);
    const center = vector(grasp.contact_region.center_obj);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      this.camera.getWorldDirection(new THREE.Vector3()),
      center,
    );
    this.drag = {
      ...data,
      center,
      plane,
      normal: vector(grasp.contact_region.normal_obj).normalize(),
      start: this.raycaster.ray.intersectPlane(plane, new THREE.Vector3()),
    };
    this.canvas.setPointerCapture(event.pointerId);
    event.stopImmediatePropagation();
    event.preventDefault();
  }

  pointerMove(event) {
    if (!this.drag) return;
    if (this.drag.kind === "center") {
      const picked = this.pick(event);
      if (picked) this.callbacks.onMove?.(this.drag.id, picked);
    } else {
      this.aim(event);
      const hit = this.raycaster.ray.intersectPlane(
        this.drag.plane,
        new THREE.Vector3(),
      );
      if (hit && this.drag.start) {
        const normal = this.drag.normal
          .clone()
          .multiplyScalar(this.drag.length)
          .add(hit.sub(this.drag.start));
        if (normal.length() > 1e-10)
          this.callbacks.onNormal?.(this.drag.id, normal.normalize().toArray());
      }
    }
  }

  pointerUp(event) {
    if (this.drag) {
      this.cancelDrag();
      return;
    }
    if (
      !this.pointerStart ||
      Math.hypot(
        event.clientX - this.pointerStart.x,
        event.clientY - this.pointerStart.y,
      ) > 5
    )
      return;
    const picked = this.pick(event);
    if (picked) this.callbacks.onPick?.(picked);
    this.pointerStart = null;
  }

  cancelDrag() {
    this.drag = null;
    this.controls.enabled = true;
    this.pointerStart = null;
  }
}
