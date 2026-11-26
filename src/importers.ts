import * as THREE from 'three';
import { Pt, Wall, Opening, Obj, uid, store, projectOnSeg, wallLen, OBJECT_PRESETS } from './model';

// ---------- Blueprint (image / PDF) ----------
export async function blueprintToImageBlob(file: File, page = 1): Promise<{ blob: Blob; w: number; h: number; pages?: number }> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    const pdfjs: any = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pg = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
    const vp0 = pg.getViewport({ scale: 1 });
    const scale = Math.min(4, 4096 / Math.max(vp0.width, vp0.height)); // iOS canvas limits
    const vp = pg.getViewport({ scale });
    const cv = document.createElement('canvas'); cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
    const ctx = cv.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: ctx, viewport: vp, canvas: cv }).promise;
    const blob: Blob = await new Promise(r => cv.toBlob(b => r(b!), 'image/jpeg', 0.9));
    return { blob, w: cv.width, h: cv.height, pages: doc.numPages };
  }
  // image: downscale very large photos for memory (phones)
  const bmp = await loadImage(file);
  const max = 4096; const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob: Blob = await new Promise(r => cv.toBlob(b => r(b!), 'image/jpeg', 0.9));
  return { blob, w: cv.width, h: cv.height };
}
function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Could not read that image (HEIC? try JPG/PNG/screenshot)')); im.src = URL.createObjectURL(file); });
}

// ---------- 3D scan loading ----------
export function scanFormat(name: string): string { const m = name.toLowerCase().match(/\.(glb|gltf|obj|ply|usdz|usdc|usda|usd|json|stl)$/); return m ? m[1] : ''; }

export async function loadScanObject(blob: Blob, format: string): Promise<THREE.Object3D> {
  const buf = await blob.arrayBuffer();
  let obj: THREE.Object3D;
  switch (format) {
    case 'glb': case 'gltf': {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const g: any = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej)); obj = g.scene; break;
    }
    case 'obj': {
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
      obj = new OBJLoader().parse(new TextDecoder().decode(buf));
      obj.traverse((m: any) => { if (m.isMesh) { const hasColor = !!m.geometry.attributes.color; m.material = new THREE.MeshStandardMaterial({ color: hasColor ? 0xffffff : 0xcfc8bb, vertexColors: hasColor, side: THREE.DoubleSide, roughness: 0.9 }); } });
      break;
    }
    case 'ply': {
      const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
      const geo = new PLYLoader().parse(buf); const hasColor = !!geo.attributes.color;
      if (geo.index || (geo.attributes.position.count % 3 === 0 && geo.attributes.normal)) {
        if (!geo.attributes.normal) geo.computeVertexNormals();
        obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: hasColor ? 0xffffff : 0xcfc8bb, vertexColors: hasColor, side: THREE.DoubleSide, roughness: 0.9 }));
      } else {
        obj = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.01, vertexColors: hasColor, color: hasColor ? 0xffffff : 0x777777 }));
      }
      break;
    }
    case 'stl': {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
      const geo = new STLLoader().parse(buf); geo.computeVertexNormals();
      obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xcfc8bb, side: THREE.DoubleSide })); break;
    }
    case 'usdz': case 'usdc': case 'usda': case 'usd': {
      const { USDLoader } = await import('three/examples/jsm/loaders/USDLoader.js') as any;
      obj = new USDLoader().parse(buf); break;
    }
    default: throw new Error('Unsupported 3D format: ' + format);
  }
  obj.traverse((m: any) => { if (m.isMesh && m.material) { const mats = Array.isArray(m.material) ? m.material : [m.material]; mats.forEach((mm: any) => { mm.side = THREE.DoubleSide; }); } });
  return obj;
}

// ---------- RoomPlan ----------
export interface ArchResult { walls: Wall[]; openings: Opening[]; objects: Obj[]; floorY: number; source: string; floors?: Pt[][] }

/** Apple RoomPlan CapturedRoom JSON (from apps that export RoomPlan data). Units: meters, Y up. */
export function parseRoomPlanJSON(j: any): ArchResult | null {
  const room = j.walls ? j : (j.rooms?.[0] || j.capturedRoom || j.room);
  if (!room || !Array.isArray(room.walls)) return null;
  type Item = { w: number; h: number; d: number; m: number[]; cat: string };
  const items = (arr: any[], cat: string): Item[] => (arr || []).map(x => {
    const dim = x.dimensions || x.dimension || [0, 0, 0]; let m = x.transform;
    if (m && !Array.isArray(m) && m.columns) m = [].concat(...m.columns);
    if (Array.isArray(m) && Array.isArray(m[0])) m = [].concat(...m);
    const c = typeof x.category === 'object' && x.category ? Object.keys(x.category)[0] : (x.category || cat);
    return { w: +dim[0], h: +dim[1], d: +dim[2], m: m as number[], cat: c };
  }).filter(x => x.m && x.m.length === 16);
  const walls = items(room.walls, 'wall'); const doors = items(room.doors, 'door'); const windows = items(room.windows, 'window'); const openings = items(room.openings, 'opening'); const objs = items(room.objects, 'object');
  let floorY = Infinity; for (const w of walls) floorY = Math.min(floorY, w.m[13] - w.h / 2); if (!isFinite(floorY)) floorY = 0;
  const res: ArchResult = { walls: [], openings: [], objects: [], floorY, source: 'RoomPlan JSON' };
  const T = 0.1; // RoomPlan walls are planes; use a typical 4" thickness
  for (const w of walls) {
    const cx = w.m[12], cz = w.m[14]; const ax = w.m[0], az = w.m[2]; const L = Math.hypot(ax, az) || 1;
    const ux = ax / L, uz = az / L;
    res.walls.push({ id: uid(), a: { x: cx - ux * w.w / 2, y: cz - uz * w.w / 2 }, b: { x: cx + ux * w.w / 2, y: cz + uz * w.w / 2 }, thickness: T, height: w.h, color: '#f4f1ea' });
  }
  const place = (it: Item, kind: Opening['kind']) => {
    const p: Pt = { x: it.m[12], y: it.m[14] }; let best: Wall | null = null, bd = 0.5;
    for (const w of res.walls) { const q = projectOnSeg(p, w.a, w.b); if (q.d < bd) { bd = q.d; best = w; } }
    if (!best) return; const t = projectOnSeg(p, best.a, best.b).t;
    const sill = Math.max(0, it.m[13] - it.h / 2 - floorY);
    res.openings.push({ id: uid(), kind, wallId: best.id, t: Math.max(it.w / 2, Math.min(wallLen(best) - it.w / 2, t)), width: it.w, height: it.h, sill: kind === 'window' ? sill : 0, flip: false, hingeRight: false });
  };
  doors.forEach(d => place(d, 'door')); windows.forEach(d => place(d, 'window')); openings.forEach(d => place(d, 'opening'));
  for (const o of objs) {
    const ax = o.m[0], az = o.m[2]; const rot = Math.atan2(az, ax);
    const k = catKey(o.cat); res.objects.push({ id: uid(), kind: k, name: niceCat(o.cat), x: o.m[12], y: o.m[14], w: o.w, d: o.d, h: o.h, elev: Math.max(0, o.m[13] - o.h / 2 - floorY), rot, color: (OBJECT_PRESETS[k] || OBJECT_PRESETS.box).color });
  }
  // floor polygon (iOS 17+): polygonCorners are local x/y in the floor's transform
  for (const f of room.floors || []) {
    const m = f.transform; if (!Array.isArray(m) || m.length !== 16 || !Array.isArray(f.polygonCorners) || f.polygonCorners.length < 3) continue;
    const pts = f.polygonCorners.map((c: number[]) => ({ x: m[12] + c[0] * m[0] + c[1] * m[4], y: m[14] + c[0] * m[2] + c[1] * m[6] }));
    res.floors = res.floors || []; res.floors.push(pts);
  }
  return res;
}
const CAT_MAP: Record<string, string> = { storage: 'base', table: 'table-din', sink: 'sinkbase', fireplace: 'fireplace', bed: 'bed-q', sofa: 'sofa', chair: 'chair', refrigerator: 'fridge', stove: 'range', oven: 'range', toilet: 'toilet', bathtub: 'tub', washerdryer: 'washer', dishwasher: 'dishwasher', television: 'tv', stairs: 'stairs' };
function catKey(c: string) { return CAT_MAP[(c || '').toLowerCase()] || 'box'; }
function niceCat(c: string) { return (c || 'Object').replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim(); }

/** Detect RoomPlan-style named nodes (Wall0, Door1, Window2, Opening0) inside a loaded USDZ/GLB. */
export function detectArchFromScene(root: THREE.Object3D): ArchResult | null {
  root.updateMatrixWorld(true);
  const groups: { kind: string; node: THREE.Object3D; name: string }[] = [];
  const RX = /^(wall|door|window|opening|storage|refrigerator|stove|bed|sink|washerdryer|washer|toilet|bathtub|oven|dishwasher|table|sofa|chair|fireplace|television|stairs)(?:[_\s-]?\d+)?(?:_grp)?$/i;
  const match = (n: THREE.Object3D) => (n.name || '').match(RX);
  root.traverse(n => {
    const m = match(n); if (!m) return;
    let inner = false; n.traverse(c => { if (c !== n && match(c)) inner = true; });
    if (inner) return; // a *_grp that wraps more specific items (e.g. Wall_6_grp holds Wall6 + Door1)
    if (!groups.some(g => isAncestor(g.node, n))) groups.push({ kind: m[1].toLowerCase(), node: n, name: n.name });
  });
  const walls0 = groups.filter(g => g.kind === 'wall'); if (walls0.length < 2) return null;
  const v = new THREE.Vector3();
  const pca = (node: THREE.Object3D) => {
    const pts: THREE.Vector3[] = [];
    node.traverse((m: any) => { if (m.isMesh) { const pos = m.geometry.attributes.position; const step = Math.max(1, Math.floor(pos.count / 2000)); for (let i = 0; i < pos.count; i += step) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).clone()); } });
    if (!pts.length) return null;
    let mx = 0, mz = 0, y0 = Infinity, y1 = -Infinity; for (const p of pts) { mx += p.x; mz += p.z; y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); } mx /= pts.length; mz /= pts.length;
    let sxx = 0, szz = 0, sxz = 0; for (const p of pts) { const dx = p.x - mx, dz = p.z - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz); const ux = Math.cos(ang), uz = Math.sin(ang);
    let t0 = Infinity, t1 = -Infinity, n0 = Infinity, n1 = -Infinity; for (const p of pts) { const t = (p.x - mx) * ux + (p.z - mz) * uz, n = -(p.x - mx) * uz + (p.z - mz) * ux; t0 = Math.min(t0, t); t1 = Math.max(t1, t); n0 = Math.min(n0, n); n1 = Math.max(n1, n); }
    const tc = (t0 + t1) / 2, nc = (n0 + n1) / 2; const cx = mx + ux * tc - uz * nc, cz = mz + uz * tc + ux * nc;
    return { cx, cz, ux, uz, len: t1 - t0, depth: n1 - n0, y0, y1, ang };
  };
  const res: ArchResult = { walls: [], openings: [], objects: [], floorY: 0, source: 'RoomPlan USDZ' };
  let floorY = Infinity; const wb = walls0.map(g => pca(g.node)).filter(Boolean) as any[];
  for (const b of wb) floorY = Math.min(floorY, b.y0); res.floorY = isFinite(floorY) ? floorY : 0;
  for (const b of wb) res.walls.push({ id: uid(), a: { x: b.cx - b.ux * b.len / 2, y: b.cz - b.uz * b.len / 2 }, b: { x: b.cx + b.ux * b.len / 2, y: b.cz + b.uz * b.len / 2 }, thickness: Math.max(0.08, Math.min(0.3, b.depth || 0.1)), height: b.y1 - b.y0, color: '#f4f1ea' });
  for (const g of groups) {
    if (g.kind === 'wall') continue; const b = pca(g.node); if (!b) continue;
    if (['door', 'window', 'opening'].includes(g.kind)) {
      const p = { x: b.cx, y: b.cz }; let best: Wall | null = null, bd = 0.5; for (const w of res.walls) { const q = projectOnSeg(p, w.a, w.b); if (q.d < bd) { bd = q.d; best = w; } }
      if (!best) continue; const t = projectOnSeg(p, best.a, best.b).t;
      res.openings.push({ id: uid(), kind: g.kind as any, wallId: best.id, t, width: b.len, height: b.y1 - b.y0, sill: g.kind === 'window' ? Math.max(0, b.y0 - res.floorY) : 0, flip: false, hingeRight: false });
    } else {
      const k = catKey(g.kind); res.objects.push({ id: uid(), kind: k, name: niceCat(g.kind), x: b.cx, y: b.cz, w: b.len, d: b.depth, h: b.y1 - b.y0, elev: Math.max(0, b.y0 - res.floorY), rot: b.ang, color: (OBJECT_PRESETS[k] || OBJECT_PRESETS.box).color });
    }
  }
  return res;
}
function isAncestor(a: THREE.Object3D, b: THREE.Object3D) { let p = b.parent; while (p) { if (p === a) return true; p = p.parent; } return false; }

/** Merge detected architecture into the current project (with undo). */
export function applyArch(r: ArchResult, offset = { x: 0, y: 0 }) {
  store.mutate(p => {
    const sh = (q: Pt) => ({ x: q.x + offset.x, y: q.y + offset.y });
    for (const w of r.walls) { w.a = sh(w.a); w.b = sh(w.b); }
    weld(r.walls, 0.12);
    for (const w of r.walls) p.walls.push(w);
    p.openings.push(...r.openings);
    for (const o of r.objects) { o.x += offset.x; o.y += offset.y; p.objects.push(o); }
    for (const f of r.floors || []) p.rooms.push({ id: uid(), name: 'Scanned floor', pts: f.map(q => sh(q)), floor: 'wood', ceilingHeight: Math.max(...r.walls.map(w => w.height), 2.4), showCeiling: true });
  });
  void store.assets;
}

/** Join wall endpoints that are within tol meters (corners from scans rarely meet exactly). */
export function weld(walls: Wall[], tol: number) {
  const ends: Pt[] = []; walls.forEach(w => ends.push(w.a, w.b));
  const used = new Set<Pt>();
  for (const e of ends) {
    if (used.has(e)) continue; const cl = ends.filter(f => !used.has(f) && Math.hypot(f.x - e.x, f.y - e.y) < tol);
    if (cl.length < 2) continue; const x = cl.reduce((s, q) => s + q.x, 0) / cl.length, y = cl.reduce((s, q) => s + q.y, 0) / cl.length;
    for (const q of cl) { q.x = x; q.y = y; used.add(q); }
  }
}
