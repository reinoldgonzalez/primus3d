import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { store, Project, Wall, wallLen, wallDir, wallOpenings, FLOORS, dist, projectOnSeg, polyArea, polyCentroid, V3, uid } from './model';
import { fmtLen, fmtArea } from './units';
import { loadScanObject } from './importers';
import { CAT_BY_KEY } from './catalog';
import { roomOutline } from './model';
let catalog3d: typeof import('./catalog3d') | null = null; let catalogLoading = false;
import type { Underlay } from './plan';

export type Mode3D = 'orbit' | 'walk';
export type Tool3D = 'select' | 'measure' | 'calScan' | 'floorScan';
export interface Hooks3D { askDistance(m: number): Promise<number | null>; toast(msg: string): void; onScanUnderlay(u: Underlay | null): void }

export class View3D {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera: THREE.PerspectiveCamera;
  controls: OrbitControls; labels: CSS2DRenderer;
  model = new THREE.Group(); scanHolder = new THREE.Group(); scanObj: THREE.Object3D | null = null; scanKey = ''; marks = new THREE.Group();
  mode: Mode3D = 'orbit'; lowWalls = false; tool: Tool3D = 'select'; active = false; showCeilings = false; showDims = true; cutScan = false;
  private ray = new THREE.Raycaster(); private needsBuild = true; private pendA: THREE.Vector3 | null = null;
  // walk state
  private yaw = 0; private pitch = 0; private keys = new Set<string>(); private joy = { x: 0, y: 0 }; private lastT = 0;
  private drag: any = null;
  clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 2.4);

  constructor(public host: HTMLElement, public hooks: Hooks3D) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement); this.renderer.domElement.style.touchAction = 'none';
    this.labels = new CSS2DRenderer(); this.labels.domElement.className = 'labels3d'; host.appendChild(this.labels.domElement);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 2000); this.camera.position.set(8, 9, 12);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.target.set(0, 0, 0);
    this.scene.background = new THREE.Color('#dfe7ee');
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8a80, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(10, 20, 8); this.scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#cfd6c4', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.005; ground.name = 'ground'; this.scene.add(ground);
    const grid = new THREE.GridHelper(200, 200 / 0.3048 | 0, 0xb7bfae, 0xc5ccbb); (grid.material as any).opacity = 0.35; (grid.material as any).transparent = true; grid.position.y = -0.003; this.scene.add(grid);
    this.scene.add(this.model, this.scanHolder, this.marks);
    store.on(w => { if (w !== 'select') this.needsBuild = true; else this.highlight(); });
    new ResizeObserver(() => this.resize()).observe(host);
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', e => this.onDown(e)); el.addEventListener('pointermove', e => this.onMove(e)); el.addEventListener('pointerup', e => this.onUp(e));
    window.addEventListener('keydown', e => { if (this.active && this.mode === 'walk' && !(e.target as any)?.closest?.('input,textarea,select')) this.keys.add(e.key.toLowerCase()); });
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    this.renderer.setAnimationLoop(t => this.loop(t));
  }
  resize() { const r = this.host.getBoundingClientRect(); if (!r.width) return; this.renderer.setSize(r.width, r.height); this.labels.setSize(r.width, r.height); this.camera.aspect = r.width / r.height; this.camera.updateProjectionMatrix(); }
  setActive(a: boolean) { this.active = a; if (a) { this.resize(); this.needsBuild = true; } }

  // ------------- build model -------------
  build() {
    this.needsBuild = false; const P = store.p;
    disposeGroup(this.model); this.model.clear();
    const wallMat = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.85 });
    const wallMats = new Map<string, THREE.Material>(); const wm = (c: string) => { if (!wallMats.has(c)) { const m = wallMat.clone(); (m as any).color.set(c); wallMats.set(c, m); } return wallMats.get(c)!; };
    for (const w of P.walls) { const ww = this.lowWalls && this.mode === 'orbit' ? { ...w, height: Math.min(w.height, 1.0) } : w; this.model.add(buildWall(P, ww as Wall, wm(w.color || '#f4f1ea'))); }
    for (const r of P.rooms) {
      if (r.pts.length < 3) continue; const outl = roomOutline(r); const shape = new THREE.Shape(outl.map(p => new THREE.Vector2(p.x, -p.y)));
      const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: FLOORS[r.floor]?.color || '#ccc', roughness: 0.8, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }));
      m.position.y = 0.002; m.userData = { kind: 'room', id: r.id }; this.model.add(m);
      if (r.curb) { const pts = outl.map(p => new THREE.Vector3(p.x, 0.06, p.y)); pts.push(pts[0].clone()); const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0), Math.max(16, pts.length * 3), 0.07, 6, false), new THREE.MeshStandardMaterial({ color: '#cfc9bd', roughness: 0.95 })); tube.userData = { kind: 'room', id: r.id }; this.model.add(tube); }
      if (!r.outdoor && r.showCeiling && (this.showCeilings || this.mode === 'walk')) { const c = new THREE.Mesh(g.clone(), new THREE.MeshStandardMaterial({ color: '#fbfaf6', side: THREE.DoubleSide })); c.position.y = r.ceilingHeight; c.userData = { kind: 'room', id: r.id }; this.model.add(c); }
      if (this.showDims) { const c = polyCentroid(outl); this.model.add(lbl(`${r.name}<br><small>${fmtArea(polyArea(outl))}</small>`, c.x, 0.05, c.y, 'room')); }
    }
    if (P.objects.length && !catalog3d && !catalogLoading) { catalogLoading = true; import('./catalog3d').then(m => { catalog3d = m; this.needsBuild = true; }); }
    for (const o of P.objects) {
      const it = CAT_BY_KEY[o.kind]; let g: THREE.Object3D;
      if (catalog3d) g = catalog3d.buildItem(it?.shape || 'box', o.w, o.d, o.h, o.color, o.finish || it?.finish);
      else g = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), new THREE.MeshStandardMaterial({ color: o.color })), g.position.y = o.h / 2;
      const holder = new THREE.Group(); holder.add(g); holder.position.set(o.x, o.elev, o.y); holder.rotation.y = -o.rot;
      holder.traverse((m: any) => { if (m.isMesh) m.userData = { kind: 'object', id: o.id }; }); this.model.add(holder);
    }
    if (this.showDims) for (const w of P.walls) { const L = wallLen(w); if (L < 0.3) continue; this.model.add(lbl(fmtLen(L, { short: true }), (w.a.x + w.b.x) / 2, w.height + 0.15, (w.a.y + w.b.y) / 2, 'dim')); }
    for (const ms of P.measures) {
      const a = new THREE.Vector3(ms.a.x, ms.a.y, ms.a.z), b = new THREE.Vector3(ms.b.x, ms.b.y, ms.b.z);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: '#7048e8', depthTest: false }));
      line.renderOrder = 10; line.userData = { kind: 'measure', id: ms.id }; this.model.add(line);
      for (const q of [a, b]) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.03), new THREE.MeshBasicMaterial({ color: '#7048e8', depthTest: false })); s.position.copy(q); s.renderOrder = 10; this.model.add(s); }
      const mid = a.clone().add(b).multiplyScalar(0.5); this.model.add(lbl(fmtLen(a.distanceTo(b)), mid.x, mid.y + 0.1, mid.z, 'meas'));
    }
    this.highlight(); this.syncScan();
  }
  highlight() {
    const s = store.sel;
    this.model.traverse((m: any) => {
      if (!m.isMesh || !m.userData?.kind) return; const on = !!s && (m.userData.id === s.id);
      const mat = m.material as THREE.MeshStandardMaterial; if (mat.userData?.keep) return; if (mat.emissive) mat.emissive.set(on ? '#1c5fd6' : '#000000'); if (mat.emissive) mat.emissiveIntensity = on ? 0.35 : 0;
    });
  }

  // ------------- scan -------------
  async syncScan() {
    const sc = store.p.scan;
    if (!sc) { if (this.scanObj) { this.scanHolder.remove(this.scanObj); disposeGroup(this.scanObj); this.scanObj = null; this.scanKey = ''; this.hooks.onScanUnderlay(null); } return; }
    if (this.scanKey !== sc.assetId) {
      this.scanKey = sc.assetId; const blob = store.assets.get(sc.assetId); if (!blob) return;
      try { const o = await loadScanObject(blob, sc.format); if (this.scanObj) { this.scanHolder.remove(this.scanObj); disposeGroup(this.scanObj); } this.scanObj = o; this.scanHolder.add(o); }
      catch (e: any) { this.hooks.toast('Could not load scan: ' + e.message); return; }
    }
    this.applyScanXf();
  }
  applyScanXf() {
    const sc = store.p.scan; if (!sc || !this.scanObj) return;
    this.scanHolder.visible = sc.visible; this.scanHolder.scale.setScalar(sc.scale); this.scanHolder.position.set(sc.x, sc.y, sc.z); this.scanHolder.rotation.set(0, sc.rotY, 0);
    this.scanObj.rotation.set(sc.upZ ? -Math.PI / 2 : 0, 0, 0);
    this.scanObj.traverse((m: any) => { if (m.material) { const mats = Array.isArray(m.material) ? m.material : [m.material]; for (const mm of mats) { mm.transparent = sc.opacity < 1; mm.opacity = sc.opacity; mm.clippingPlanes = this.cutScan ? [this.clipPlane] : null; mm.needsUpdate = true; } } });
    this.clipPlane.constant = sc.cutHeight;
    this.scheduleUnderlay();
  }
  private ulTimer: any = 0;
  scheduleUnderlay() { clearTimeout(this.ulTimer); this.ulTimer = setTimeout(() => this.renderUnderlay(), 250); }
  /** Top-down render of the scan for tracing in the plan view: textured floor below the cut + dark slice of everything near cut height. */
  renderUnderlay() {
    const sc = store.p.scan; if (!sc || !this.scanObj || !sc.showInPlan || !sc.visible) { this.hooks.onScanUnderlay(null); return; }
    this.scanHolder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.scanHolder); if (box.isEmpty()) return;
    const pad = 0.2; box.min.x -= pad; box.min.z -= pad; box.max.x += pad; box.max.z += pad;
    const wM = box.max.x - box.min.x, hM = box.max.z - box.min.z; const res = Math.min(2048 / Math.max(wM, hM), 200);
    const W = Math.max(16, Math.round(wM * res)), H = Math.max(16, Math.round(hM * res));
    const cam = new THREE.OrthographicCamera(box.min.x, box.max.x, -box.min.z, -box.max.z, 0.01, 1000);
    cam.position.set(0, box.max.y + 10, 0); cam.up.set(0, 0, -1); cam.lookAt(0, -1000, 0); cam.updateMatrixWorld();
    // camera looks down -Y with up -Z: screen right=+X, screen up=-Z
    cam.left = box.min.x; cam.right = box.max.x; cam.top = -box.min.z; cam.bottom = -box.max.z; cam.updateProjectionMatrix();
    const tmp = new THREE.Scene(); tmp.background = new THREE.Color('#ffffff'); tmp.add(new THREE.AmbientLight(0xffffff, 2.5));
    const parent = this.scanHolder.parent!; tmp.add(this.scanHolder);
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), sc.cutHeight);
    const saved: any[] = [];
    this.scanObj.traverse((m: any) => { if (m.material) { const mats = Array.isArray(m.material) ? m.material : [m.material]; for (const mm of mats) { saved.push([mm, mm.clippingPlanes, mm.opacity]); mm.clippingPlanes = [plane]; mm.opacity = 0.3; mm.transparent = true; mm.needsUpdate = true; } } });
    // slice points band
    const band = new THREE.Group(); const lo = sc.cutHeight - 0.35, hi = sc.cutHeight + 0.05; const v = new THREE.Vector3();
    this.scanObj.traverse((m: any) => {
      if (!(m.isMesh || m.isPoints) || !m.geometry?.attributes?.position) return; const pos = m.geometry.attributes.position; const arr: number[] = [];
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); if (v.y > lo && v.y < hi) arr.push(v.x, 0, v.z); }
      if (arr.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); band.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#111111', size: Math.max(2, res * 0.03), sizeAttenuation: false }))); }
    });
    band.position.y = box.max.y + 1; tmp.add(band);
    const rt = new THREE.WebGLRenderTarget(W, H); const r = this.renderer; const prevRT = r.getRenderTarget();
    r.setRenderTarget(rt); r.render(tmp, cam); const px = new Uint8Array(W * H * 4); r.readRenderTargetPixels(rt, 0, 0, W, H, px); r.setRenderTarget(prevRT);
    for (const [mm, cp, op] of saved) { mm.clippingPlanes = cp; mm.opacity = op; mm.transparent = op < 1; mm.needsUpdate = true; }
    parent.add(this.scanHolder); band.traverse((m: any) => { m.geometry?.dispose(); m.material?.dispose(); }); rt.dispose();
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d')!; const id = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) id.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    ctx.putImageData(id, 0, 0);
    this.hooks.onScanUnderlay({ img: cv, x: box.min.x, y: box.min.z, w: wM, h: hM, opacity: 0.85 });
  }

  // ------------- camera / modes -------------
  setMode(m: Mode3D) {
    this.mode = m; this.needsBuild = true;
    if (m === 'walk') {
      this.controls.enabled = false; const t = this.controls.target; const c = this.modelCenter();
      this.camera.position.set(c.x, 1.65, c.z); this.yaw = Math.atan2(-(t.x - this.camera.position.x), -(t.z - this.camera.position.z)) || 0; this.pitch = 0; this.camera.fov = 70;
    } else { this.controls.enabled = true; this.camera.fov = 55; this.fitView(); }
    this.camera.updateProjectionMatrix();
  }
  modelCenter() { const b = new THREE.Box3().setFromObject(this.model); if (this.scanObj && store.p.scan?.visible) b.union(new THREE.Box3().setFromObject(this.scanHolder)); return b.isEmpty() ? new THREE.Vector3() : b.getCenter(new THREE.Vector3()); }
  fitView() {
    if (this.needsBuild) this.build();
    const b = new THREE.Box3().setFromObject(this.model); if (this.scanObj && store.p.scan?.visible) b.union(new THREE.Box3().setFromObject(this.scanHolder));
    if (b.isEmpty()) b.set(new THREE.Vector3(-3, 0, -3), new THREE.Vector3(3, 2.7, 3));
    const c = b.getCenter(new THREE.Vector3()); const s = b.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(c); this.camera.position.set(c.x + s * 0.55, c.y + s * 0.75, c.z + s * 0.75); this.controls.update();
  }
  setJoy(x: number, y: number) { this.joy.x = x; this.joy.y = y; }
  loop(t: number) {
    if (!this.active) { this.lastT = t; return; }
    const dt = Math.min(0.1, (t - this.lastT) / 1000 || 0); this.lastT = t;
    if (this.needsBuild) this.build();
    if (this.mode === 'walk') {
      const sp = (this.keys.has('shift') ? 3 : 1.4) * dt; let f = -this.joy.y, s = this.joy.x;
      if (this.keys.has('w') || this.keys.has('arrowup')) f += 1; if (this.keys.has('s') || this.keys.has('arrowdown')) f -= 1;
      if (this.keys.has('a')) s -= 1; if (this.keys.has('d')) s += 1;
      if (this.keys.has('arrowleft')) this.yaw += dt * 1.5; if (this.keys.has('arrowright')) this.yaw -= dt * 1.5;
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      this.camera.position.x += (fx * f + -fz * s) * sp; this.camera.position.z += (fz * f + fx * s) * sp; this.camera.position.y = 1.65;
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    } else this.controls.update();
    this.renderer.render(this.scene, this.camera); this.labels.render(this.scene, this.camera);
  }

  // ------------- picking / tools -------------
  private ndc(e: PointerEvent) { const r = this.renderer.domElement.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); }
  pick(e: PointerEvent, targets: THREE.Object3D[]) { this.ray.setFromCamera(this.ndc(e), this.camera); (this.ray.params as any).Points = { threshold: 0.03 }; return this.ray.intersectObjects(targets, true).filter(h => h.object.visible && (h.object as any).isMesh || (h.object as any).isPoints); }
  private pointers = new Map<number, any>();
  onDown(e: PointerEvent) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now() });
    if (this.pointers.size > 1) { this.cancelDrag(); return; }
    if (this.mode === 'walk') { this.renderer.domElement.setPointerCapture(e.pointerId); return; }
    if (this.tool === 'select' && store.sel && ['object', 'wall', 'opening'].includes(store.sel.kind)) {
      const hits = this.pick(e, [this.model]); const h = hits.find(h => h.object.userData?.kind);
      if (h && h.object.userData.id === store.sel.id) {
        this.controls.enabled = false; this.renderer.domElement.setPointerCapture(e.pointerId);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); const p0 = this.ray.ray.intersectPlane(plane, new THREE.Vector3());
        if (p0) { this.drag = { id: store.sel.id, kind: store.sel.kind, p0, last: p0.clone(), started: false }; }
      }
    }
  }
  cancelDrag() { if (this.drag?.started) store.end(); this.drag = null; this.controls.enabled = this.mode === 'orbit'; }
  onMove(e: PointerEvent) {
    const pt = this.pointers.get(e.pointerId); if (!pt) return; const dx = e.clientX - pt.x, dy = e.clientY - pt.y; pt.x = e.clientX; pt.y = e.clientY;
    if (this.mode === 'walk') { this.yaw -= dx * 0.005; this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch - dy * 0.005)); return; }
    if (!this.drag) return;
    this.ray.setFromCamera(this.ndc(e), this.camera); const p = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()); if (!p) return;
    if (!this.drag.started) { this.drag.started = true; store.begin(); }
    const ddx = p.x - this.drag.last.x, ddz = p.z - this.drag.last.z; this.drag.last.copy(p); const P = store.p;
    if (this.drag.kind === 'object') { const o = P.objects.find(o => o.id === this.drag.id); if (o) { o.x += ddx; o.y += ddz; } }
    else if (this.drag.kind === 'wall') { const w = P.walls.find(w => w.id === this.drag.id); if (w) { const ends = [{ ...w.a }, { ...w.b }]; for (const o of P.walls) for (const k of ['a', 'b'] as const) for (const e0 of ends) if (dist(o[k], e0) < 1e-4) o[k] = { x: o[k].x + ddx, y: o[k].y + ddz }; } }
    else if (this.drag.kind === 'opening') { const o = P.openings.find(o => o.id === this.drag.id); const w = o && store.wall(o.wallId); if (o && w) { const t = projectOnSeg({ x: p.x, y: p.z }, w.a, w.b).t; o.t = Math.max(o.width / 2, Math.min(wallLen(w) - o.width / 2, t)); } }
    store.emit('live');
  }
  onUp(e: PointerEvent) {
    const pt = this.pointers.get(e.pointerId); this.pointers.delete(e.pointerId);
    if (this.drag) { const moved = this.drag.started; this.cancelDrag(); if (moved) return; }
    if (!pt || this.mode === 'walk') return;
    const moved = Math.hypot(e.clientX - pt.x0, e.clientY - pt.y0) > 6 || performance.now() - pt.t > 600; if (moved) return;
    this.onTap(e);
  }
  onTap(e: PointerEvent) {
    const scanT = this.scanObj && store.p.scan?.visible ? [this.scanHolder] : [];
    if (this.tool === 'select') {
      const h = this.pick(e, [this.model]).find(h => h.object.userData?.kind);
      store.select(h ? { kind: h.object.userData.kind, id: h.object.userData.id } : null); return;
    }
    const targets = this.tool === 'measure' ? [this.model, ...scanT] : scanT;
    const h = this.pick(e, targets)[0]; let p = h?.point.clone();
    if (!p && this.tool === 'measure') p = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()) || undefined;
    if (!p) { this.hooks.toast(scanT.length || this.tool === 'measure' ? 'Tap on the model' : 'Load a 3D scan first'); return; }
    this.addMark(p);
    if (this.tool === 'floorScan') { const y = p.y; store.mutate(P => { P.scan!.y -= y; }); this.clearMarks(); this.hooks.toast('Floor level set to 0'); this.tool = 'select'; return; }
    if (!this.pendA) { this.pendA = p; return; }
    const a = this.pendA, b = p; this.pendA = null; const d = a.distanceTo(b);
    if (this.tool === 'measure') {
      const m: V3[] = [{ x: a.x, y: a.y, z: a.z }, { x: b.x, y: b.y, z: b.z }]; store.mutate(P => P.measures.push({ id: uid(), a: m[0], b: m[1] }));
      this.clearMarks(); this.hooks.toast(`Measured ${fmtLen(d)}`);
    } else if (this.tool === 'calScan') {
      this.hooks.askDistance(d).then(real => {
        this.clearMarks(); if (!real || !d) return; const k = real / d;
        store.mutate(P => { const s = P.scan!; s.scale *= k; s.x = a.x + (s.x - a.x) * k; s.z = a.z + (s.z - a.z) * k; s.y = s.y * k; s.calibrated = true; });
        this.hooks.toast('Scan scale calibrated'); this.tool = 'select';
      });
    }
  }
  addMark(p: THREE.Vector3) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.04), new THREE.MeshBasicMaterial({ color: '#e03131', depthTest: false })); s.renderOrder = 11; s.position.copy(p); this.marks.add(s); }
  clearMarks() { disposeGroup(this.marks); this.marks.clear(); this.pendA = null; }
  setTool(t: Tool3D) { this.tool = t; this.clearMarks(); }
  screenshot(): string { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }
}

function lbl(html: string, x: number, y: number, z: number, cls: string) { const d = document.createElement('div'); d.className = 'l3 ' + cls; d.innerHTML = html; const o = new CSS2DObject(d); o.position.set(x, y, z); return o; }
export function disposeGroup(g: THREE.Object3D) {
  g.traverse((m: any) => { if (m.geometry) m.geometry.dispose(); if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x: any) => { if (x.userData?.keep) return; for (const k in x) if (x[k]?.isTexture) x[k].dispose(); x.dispose(); }); if (m.isCSS2DObject) m.element.remove(); });
}

/** Wall mesh with holes for openings, built from boxes (no CSG needed). */
function buildWall(P: Project, w: Wall, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group(); const L = wallLen(w); if (L < 1e-4) return g; const d = wallDir(w); const ang = Math.atan2(d.y, d.x);
  const ext = (pt: any) => P.walls.some(o => o !== w && (dist(o.a, pt) < 1e-3 || dist(o.b, pt) < 1e-3)) ? w.thickness / 2 : 0;
  const ea = ext(w.a), eb = ext(w.b);
  const box = (s0: number, s1: number, y0: number, y1: number) => {
    if (s1 - s0 < 1e-4 || y1 - y0 < 1e-4) return; const m = new THREE.Mesh(new THREE.BoxGeometry(s1 - s0, y1 - y0, w.thickness), mat);
    const c = (s0 + s1) / 2; m.position.set(w.a.x + d.x * c, (y0 + y1) / 2, w.a.y + d.y * c); m.rotation.y = -ang; m.userData = { kind: 'wall', id: w.id }; g.add(m);
  };
  const ops = wallOpenings(P, w); let s = -ea;
  for (const o of ops) {
    const a = Math.max(0, o.t - o.width / 2), b = Math.min(L, o.t + o.width / 2); const top = Math.min(w.height, o.sill + o.height);
    box(s, a, 0, w.height); box(a, b, top, w.height); if (o.sill > 0) box(a, b, 0, o.sill); s = Math.max(s, b);
    const c = o.t; const cx = w.a.x + d.x * c, cz = w.a.y + d.y * c;
    if (o.kind === 'window' || o.kind === 'slider') {
      const glass = new THREE.Mesh(new THREE.BoxGeometry(o.width, top - o.sill, 0.01), new THREE.MeshStandardMaterial({ color: '#9ec9e6', transparent: true, opacity: 0.35, roughness: 0.1 }));
      glass.position.set(cx, (o.sill + top) / 2, cz); glass.rotation.y = -ang; glass.userData = { kind: 'opening', id: o.id }; g.add(glass);
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: '#ffffff' })); frame.position.copy(glass.position); frame.rotation.copy(glass.rotation); g.add(frame);
      if (o.kind === 'slider') { const mull = new THREE.Mesh(new THREE.BoxGeometry(0.05, top - o.sill, 0.06), new THREE.MeshStandardMaterial({ color: '#ffffff' })); mull.position.copy(glass.position); mull.rotation.y = -ang; g.add(mull); }
    } else if (o.kind === 'door') {
      const leafW = o.width - 0.02; const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, top - 0.01, 0.04), new THREE.MeshStandardMaterial({ color: '#a47148', roughness: 0.6 }));
      // open ~30 degrees around hinge
      const hingeT = o.hingeRight ? c + o.width / 2 : c - o.width / 2; const hx = w.a.x + d.x * hingeT, hz = w.a.y + d.y * hingeT;
      const pivot = new THREE.Group(); pivot.position.set(hx, 0, hz); pivot.rotation.y = -ang + (o.hingeRight ? Math.PI : 0); leaf.position.set(leafW / 2, (top - 0.01) / 2, 0);
      const open = new THREE.Group(); open.rotation.y = (o.flip ? 1 : -1) * (o.hingeRight ? -1 : 1) * 0.5; open.add(leaf); pivot.add(open); leaf.userData = { kind: 'opening', id: o.id }; g.add(pivot);
    }
  }
  box(s, L + eb, 0, w.height);
  return g;
}
