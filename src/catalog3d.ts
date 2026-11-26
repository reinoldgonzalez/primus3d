// Procedural 3D builders for catalog items. Each returns a Group in local space:
// centered on x/z, from y=0 up to h, front facing +z (plan "front" edge).
import * as THREE from 'three';
import { FINISHES } from './catalog';

type B = (w: number, d: number, h: number, m: THREE.Material, col: string) => THREE.Object3D[];
const mat = (color: string, rough = 0.7, metal = 0, opacity = 1) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, transparent: opacity < 1, opacity });
const bx = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 1e-3), Math.max(h, 1e-3), Math.max(d, 1e-3)), m); o.position.set(x, y + h / 2, z); return o; };
const cyl = (r: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 20, r2?: number) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r2 ?? r, h, seg), m); o.position.set(x, y + h / 2, z); return o; };
const sph = (r: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m); o.position.set(x, y, z); return o; };
const glow = (c: string, e: string, k: number) => new THREE.MeshStandardMaterial({ color: c, emissive: new THREE.Color(e), emissiveIntensity: k, roughness: 0.4 });
const keep = (...ms: THREE.Material[]) => ms.forEach(m => m.userData.keep = true);
const dark = mat('#2d2d2d', 0.6), white = mat('#fafafa', 0.3), chrome = mat('#cfd3d6', 0.25, 0.9), counterTop = mat('#d8d4cc', 0.5), water = mat('#3fa6dc', 0.1, 0, 0.85), glassM = mat('#bfe0f0', 0.05, 0, 0.3), trunk = mat('#7a5a3a', 0.9), screenM = mat('#9aa0a6', 0.8, 0, 0.12), frameM = mat('#f2f2f2', 0.5);
keep(dark, white, chrome, counterTop, water, glassM, trunk, screenM, frameM);

const S: Record<string, B> = {
  box: (w, d, h, m) => [bx(w, h, d, m)],
  slab: (w, d, h, m) => [bx(w, h, d, m)],
  baseCab: (w, d, h, m) => [bx(w, i(4), d - i(3), dark, 0, 0, -i(1.5)), bx(w, h - i(5.5), d, m, 0, i(4)), bx(w + i(1), i(1.5), d + i(1), counterTop, 0, h - i(1.5), i(0.5)), bx(w * 0.9, i(0.3), i(0.6), dark, 0, h - i(8), d / 2)],
  sinkCab: (w, d, h, m) => [...S.baseCab(w, d, h, m, ''), bx(w * 0.6, i(0.4), d * 0.55, chrome, 0, h + 0.001, 0), cyl(i(0.6), i(12), chrome, 0, h, -d * 0.35)],
  upperCab: (w, d, h, m) => [bx(w, h, d, m), bx(i(0.6), h * 0.3, i(0.6), dark, w * 0.05, h * 0.05, d / 2)],
  tallCab: (w, d, h, m) => [bx(w, h, d, m), bx(i(0.6), i(10), i(0.6), dark, w * 0.35, h * 0.45, d / 2)],
  island: (w, d, h, m) => [bx(w - i(2), i(4), d - i(14), dark), bx(w - i(1), h - i(5.5), d - i(12), m, 0, i(4), -i(6) + i(0)), bx(w + i(1), i(1.5), d, counterTop, 0, h - i(1.5))],
  fridge: (w, d, h, m) => [bx(w, h, d, m), bx(i(0.3), h * 0.6, i(1), dark, -i(1), h * 0.3, d / 2), bx(i(0.3), h * 0.6, i(1), dark, i(1), h * 0.3, d / 2), bx(w, i(0.3), i(0.2), dark, 0, h * 0.28, d / 2)],
  range: (w, d, h, m) => [bx(w, h, d, m), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => cyl(w * 0.14, i(0.3), dark, a * w * 0.22, h, b * d * 0.2)), bx(w * 0.8, h * 0.45, i(0.3), dark, 0, h * 0.2, d / 2)],
  appliance: (w, d, h, m) => [bx(w, h, d, m), bx(w * 0.8, i(0.4), i(0.5), dark, 0, h * 0.85, d / 2)],
  washer: (w, d, h, m) => [bx(w, h, d, m), cyl(w * 0.3, i(0.5), dark, 0, h * 0.45, d / 2 + 0.001, 24).rotateX(Math.PI / 2), bx(w, i(5), i(1), mat('#dcdcdc'), 0, h - i(5), -d / 2 + i(1))],
  cylinder: (w, d, h, m) => [cyl(Math.min(w, d) / 2, h, m, 0, 0, 0, 24)],
  toilet: (w, d, h, m) => [bx(w * 0.9, h * 0.55, i(8), m, 0, h * 0.45, -d / 2 + i(4)), (() => { const o = cyl(w * 0.45, i(15), m, 0, 0, d * 0.12, 20, w * 0.3); o.scale.set(1, 1, 1.25); return o; })(), cyl(w * 0.47, i(1), white, 0, i(15), d * 0.12)],
  vanity: (w, d, h, m) => [bx(w, h - i(1.5), d, m), bx(w + i(1), i(1.5), d + i(1), counterTop, 0, h - i(1.5)), ...(w > i(55) ? [-w / 4, w / 4] : [0]).map(x => bx(i(16), i(0.5), i(12), white, x, h + 0.001, 0))],
  tub: (w, d, h, m) => [bx(w, h * 0.9, d, m), bx(w - i(5), i(0.5), d - i(5), water, 0, h * 0.9 - i(0.5), 0), bx(w, h * 0.1, i(2.5), m, 0, h * 0.9, d / 2 - i(1.25)), bx(w, h * 0.1, i(2.5), m, 0, h * 0.9, -d / 2 + i(1.25)), bx(i(2.5), h * 0.1, d, m, w / 2 - i(1.25), h * 0.9), bx(i(2.5), h * 0.1, d, m, -w / 2 + i(1.25), h * 0.9)],
  glassPanel: (w, d, h, m) => [bx(w, h, Math.max(d, i(0.4)), m)],
  bed: (w, d, h, m) => [bx(w, h * 0.45, d, mat('#6b5038')), bx(w - i(1), h * 0.55, d - i(2), mat('#f3f1ec'), 0, h * 0.45, i(1)), bx(w, i(18), i(3), mat('#6b5038'), 0, h, -d / 2 + i(1.5)), bx(w * 0.4, i(5), i(16), white, -w * 0.22, h, -d / 2 + i(12)), bx(w * 0.4, i(5), i(16), white, w * 0.22, h, -d / 2 + i(12)), bx(w - i(1), i(2), d * 0.55, m, 0, h, d * 0.2)],
  dresser: (w, d, h, m) => [bx(w, h, d, m), ...[0.25, 0.5, 0.75].map(k => bx(w * 0.9, i(0.3), i(0.3), dark, 0, h * k, d / 2))],
  sofa: (w, d, h, m) => [bx(w, h * 0.45, d, m), bx(w, h, d * 0.25, m, 0, 0, -d * 0.375), bx(w * 0.1, h * 0.7, d, m, -w * 0.45), bx(w * 0.1, h * 0.7, d, m, w * 0.45)],
  sectional: (w, d, h, m) => [bx(w, h * 0.45, i(36), m, 0, 0, -d / 2 + i(18)), bx(w, h, i(9), m, 0, 0, -d / 2 + i(4.5)), bx(i(36), h * 0.45, d - i(36), m, w / 2 - i(18), 0, i(18)), bx(i(9), h, d, m, w / 2 - i(4.5))],
  table: (w, d, h, m) => [bx(w, i(1.5), d, m, 0, h - i(1.5)), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => bx(i(2.5), h - i(1.5), i(2.5), m, a * (w / 2 - i(3)), 0, b * (d / 2 - i(3))))],
  roundTable: (w, d, h, m) => [cyl(w / 2, i(1.5), m, 0, h - i(1.5), 0, 32), cyl(i(2), h - i(1.5), m), cyl(w * 0.2, i(1), m)],
  chair: (w, d, h, m) => [bx(w, i(2), d, m, 0, i(17)), bx(w, h - i(19), i(1.5), m, 0, i(19), -d / 2 + i(0.75)), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => bx(i(1.5), i(17), i(1.5), m, a * (w / 2 - i(1)), 0, b * (d / 2 - i(1))))],
  tvConsole: (w, d, h, m) => [bx(w, h, d, m), bx(i(57), i(33), i(2), dark, 0, h + i(4), 0), bx(i(10), i(4), i(6), dark, 0, h, 0)],
  stairs: (w, d, h, m) => { const n = Math.max(1, Math.round(h / i(7.5))); const rise = h / n, run = d / n; const out: THREE.Object3D[] = []; for (let k = 0; k < n; k++) out.push(bx(w, rise * (k + 1), run, m, 0, 0, d / 2 - run * (k + 0.5))); return out; },
  closet: (w, d, h, m) => [bx(w, i(0.75), d, m, 0, h - i(0.75)), cyl(i(0.6), w, chrome, 0, 0, 0).rotateZ(Math.PI / 2).translateX(-(h - i(3))).translateY(0)],
  shelving: (w, d, h, m) => [bx(i(0.75), h, d, m, -w / 2 + i(0.375)), bx(i(0.75), h, d, m, w / 2 - i(0.375)), ...[0, 0.25, 0.5, 0.75, 0.99].map(k => bx(w, i(0.75), d, m, 0, h * k))],
  fireplace: (w, d, h, m) => [bx(w, h, d, m), bx(w * 0.6, h * 0.5, i(1), dark, 0, h * 0.12, d / 2), bx(w + i(4), i(2), d + i(3), mat('#6b4a32'), 0, h)],
  canLight: (w, d, h) => [cyl(w / 2, h, glow('#fffbe6', '#fff6cc', 0.8))],
  fan: (w, d, h, m) => { const out: THREE.Object3D[] = [cyl(i(0.6), h, dark, 0, 0), cyl(i(4), i(4), m, 0, 0)]; for (let k = 0; k < 5; k++) { const b = bx(w / 2 - i(4), i(0.4), i(5), m, 0, i(2)); b.position.x = 0; const g = new THREE.Group(); b.position.set((w / 2) / 2 + i(2), i(2), 0); g.add(b); g.rotation.y = k * Math.PI * 2 / 5; out.push(g); } return out; },
  pendant: (w, d, h, m) => [cyl(i(0.3), h * 0.6, dark, 0, h * 0.4), cyl(w * 0.15, h * 0.4, m, 0, 0, 0, 20, w / 2)],
  poolRect: (w, d, h, m) => [bx(w + i(24), i(2), d + i(24), mat('#e8e0d0', 0.9), 0, 0), bx(w, i(2.2), d, mat('#3fa6dc', 0.1, 0, 0.9), 0, 0)],
  poolOval: (w, d, h) => { const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, i(2), 40), mat('#e8e0d0', 0.9)); c1.scale.set(w + i(24), 1, d + i(24)); c1.position.y = i(1); const c2 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, i(2.2), 40), water); c2.scale.set(w, 1, d); c2.position.y = i(1.1); return [c1, c2]; },
  spa: (w, d, h, m) => [cyl(w / 2 + i(6), h, mat('#e8e0d0', 0.9), 0, 0, 0, 32), cyl(w / 2, i(0.5), water, 0, h, 0, 32)],
  cage: (w, d, h) => { const out: THREE.Object3D[] = []; const nx = Math.max(1, Math.round(w / 2)), nz = Math.max(1, Math.round(d / 2)); const p = i(2);
    for (let k = 0; k <= nx; k++) for (const z of [-d / 2, d / 2]) out.push(bx(p, h, p, frameM, -w / 2 + w * k / nx, 0, z));
    for (let k = 1; k < nz; k++) for (const x of [-w / 2, w / 2]) out.push(bx(p, h, p, frameM, x, 0, -d / 2 + d * k / nz));
    out.push(bx(w, p, p, frameM, 0, h, -d / 2), bx(w, p, p, frameM, 0, h, d / 2), bx(p, p, d, frameM, -w / 2, h), bx(p, p, d, frameM, w / 2, h));
    for (let k = 1; k < nx; k++) out.push(bx(p, p, d, frameM, -w / 2 + w * k / nx, h + i(18) * Math.sin(Math.PI * k / nx)));
    out.push(bx(w, h, i(0.2), screenM, 0, 0, -d / 2), bx(w, h, i(0.2), screenM, 0, 0, d / 2), bx(i(0.2), h, d, screenM, -w / 2), bx(i(0.2), h, d, screenM, w / 2), bx(w, i(0.2), d, screenM, 0, h + i(10)));
    return out; },
  pergola: (w, d, h, m) => { const out: THREE.Object3D[] = []; const p = i(6); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) out.push(bx(p, h, p, m, a * (w / 2 - p), 0, b * (d / 2 - p)));
    out.push(bx(w + i(12), i(10), i(3), m, 0, h, -d / 2 + p), bx(w + i(12), i(10), i(3), m, 0, h, d / 2 - p)); const n = Math.round(w / i(16)); for (let k = 0; k <= n; k++) out.push(bx(i(2), i(8), d + i(12), m, -w / 2 + w * k / n, h + i(10))); return out; },
  pergolaSolid: (w, d, h, m) => { const out: THREE.Object3D[] = []; const p = i(8); for (const a of [-1, 1]) out.push(bx(p, h, p, m, a * (w / 2 - p), 0, d / 2 - p)); out.push(bx(w + i(12), i(8), d + i(12), m, 0, h)); return out; },
  deck: (w, d, h, m) => [bx(w, h, d, m), ...Array.from({ length: Math.max(1, Math.round(d / i(6))) }, (_, k) => bx(w, i(0.2), i(0.3), dark, 0, h, -d / 2 + i(6) * k))],
  dock: (w, d, h, m) => [bx(w, i(2), d, m, 0, h - i(2)), ...Array.from({ length: Math.max(2, Math.round(d / f(8)) + 1) }, (_, k) => [-1, 1].map(a => cyl(i(5), h + f(2), trunk, a * (w / 2 - i(3)), -f(2), -d / 2 + (d / Math.max(1, Math.round(d / f(8)))) * k))).flat()],
  fence: (w, d, h, m) => { const out: THREE.Object3D[] = [bx(i(4), h, i(4), m, -w / 2 + i(2)), bx(i(4), h, i(4), m, w / 2 - i(2))]; out.push(bx(w, h - i(2), i(0.75), m, 0, i(2))); return out; },
  fenceRail: (w, d, h, m) => { const out: THREE.Object3D[] = [bx(i(2), h, i(2), m, -w / 2 + i(1)), bx(i(2), h, i(2), m, w / 2 - i(1)), bx(w, i(1), i(1), m, 0, h - i(3)), bx(w, i(1), i(1), m, 0, i(4))]; for (let x = -w / 2 + i(4); x < w / 2 - i(2); x += i(4)) out.push(bx(i(0.75), h - i(4), i(0.75), m, x, i(2))); return out; },
  shed: (w, d, h, m) => { const wall = h * 0.7; const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 3), mat('#6d5f55')); roof.rotation.set(0, 0, Math.PI / 2); roof.rotation.order = 'ZXY'; roof.scale.set(h - wall, w + i(8), d + i(8)); roof.rotateX(Math.PI / 2); roof.position.y = wall + (h - wall) * 0.25;
    const g = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) * 0.5, 1, 4, 1), mat('#6d5f55')); g.rotation.y = Math.PI / 4; g.scale.set(w / Math.hypot(w, d) * 1.45, h - wall, d / Math.hypot(w, d) * 1.45); g.position.y = wall + (h - wall) / 2; void roof;
    return [bx(w, wall, d, m), g, bx(i(36), i(72), i(1), mat('#8a6a4a'), 0, 0, d / 2)]; },
  acUnit: (w, d, h, m) => [bx(w, h, d, m), cyl(w * 0.4, i(1), dark, 0, h, 0, 24), bx(w + i(6), i(3), d + i(6), mat('#b7b5ae'), 0, 0)],
  grill: (w, d, h, m) => [bx(w, h * 0.35, d, m, 0, h * 0.5), cyl(d / 2, w * 0.7, m, 0, 0, 0, 16).rotateZ(Math.PI / 2).translateX(-(h * 0.85)), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => bx(i(1.5), h * 0.5, i(1.5), dark, a * w * 0.4, 0, b * d * 0.4))],
  lounger: (w, d, h, m) => [bx(w, h, d * 0.65, m, 0, 0, d * 0.175), (() => { const b = bx(w, i(2), d * 0.35, m, 0, 0, 0); const g = new THREE.Group(); b.position.set(0, 0, -d * 0.175); g.add(b); g.position.set(0, h, -d * 0.325); g.rotation.x = 0.7; return g; })()],
  umbrella: (w, d, h, m) => [cyl(i(1), h, dark), (() => { const c = new THREE.Mesh(new THREE.ConeGeometry(w / 2, i(18), 8, 1, true), m); c.position.y = h - i(9); return c; })()],
  mailbox: (w, d, h, m) => [bx(i(4), h - i(8), i(4), mat('#f2f2f2')), bx(w, i(8), d, m, 0, h - i(8))],
  postLight: (w, d, h, m) => [cyl(i(1.5), h - i(14), m), bx(w, i(14), d, glow('#fff3c4', '#ffe9a0', 0.6), 0, h - i(14))],
  car: (w, d, h, m) => [bx(w, h * 0.5, d, m, 0, i(8)), bx(w * 0.9, h * 0.4, d * 0.5, glassM, 0, h * 0.5 + i(8) - i(8), -d * 0.05), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => cyl(i(13), i(8), dark, a * w * 0.42, i(13) - i(4), b * d * 0.32).rotateZ(Math.PI / 2))],
  palm: (w, d, h) => { const out: THREE.Object3D[] = [cyl(i(6), h * 0.9, trunk, 0, 0, 0, 10, i(9))]; const fr = mat('#5f8f3e', 0.8); for (let k = 0; k < 9; k++) { const g = new THREE.Group(); const leaf = new THREE.Mesh(new THREE.ConeGeometry(i(10), w / 2, 4), fr); leaf.rotation.z = -Math.PI / 2; leaf.position.x = w / 4; leaf.scale.set(1, 1, 0.25); g.add(leaf); g.rotation.set(0, k * Math.PI * 2 / 9, -0.35); g.position.y = h * 0.9; out.push(g); } return out; },
  tree: (w, d, h, m) => [cyl(i(6), h * 0.45, trunk, 0, 0, 0, 10, i(8)), (() => { const s = sph(0.5, m); s.scale.set(w, h * 0.6, d); s.position.y = h * 0.68; return s; })()],
  shrub: (w, d, h, m) => [(() => { const s = sph(0.5, m); s.scale.set(w, h, d); s.position.y = h * 0.5; return s; })()],
};
function i(n: number) { return n * 0.0254; } function f(n: number) { return n * 0.3048; }

export function buildItem(shape: string, w: number, d: number, h: number, color: string, finish = 'satin'): THREE.Group {
  const F = FINISHES[finish] || FINISHES.satin; const m = mat(color, F.rough, F.metal, F.opacity ?? 1);
  const g = new THREE.Group(); const fn = S[shape] || S.box;
  for (const o of fn(w, d, h, m, color)) g.add(o);
  return g;
}
