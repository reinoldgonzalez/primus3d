import { roomOutline } from './model';
import { store, Pt, Wall, Opening, Obj, Project, uid, dist, wallLen, wallDir, pointOnWall, projectOnSeg, polyArea, polyCentroid, pointInPoly, objCorners, wallOpenings, FLOORS, OBJECT_PRESETS, Selection, OpeningKind } from './model';
import { fmtLen, fmtArea, getUnits, FT, IN } from './units';
import { OPENING_BY_KEY } from './catalog';

export type Tool = 'select' | 'wall' | 'room' | 'door' | 'window' | 'opening' | 'slider' | 'object' | 'measure' | 'calibrate' | 'pan';
export interface PlanHooks {
  askDistance(measuredM: number): Promise<number | null>;
  onDraftChange(): void;
  toast(msg: string): void;
}
export interface ViewXf { cx: number; cy: number; scale: number }
export interface Underlay { img: CanvasImageSource; x: number; y: number; w: number; h: number; opacity: number }

const images = new Map<string, HTMLImageElement>();
export function assetImage(id: string, onload: () => void): HTMLImageElement | null {
  let im = images.get(id);
  if (im) return im.complete && im.naturalWidth ? im : null;
  const b = store.assets.get(id); if (!b) return null;
  im = new Image(); im.onload = onload; im.src = URL.createObjectURL(b); images.set(id, im); return null;
}

export class PlanView {
  ctx: CanvasRenderingContext2D;
  v: ViewXf = { cx: 0, cy: 0, scale: 40 };
  tool: Tool = 'select';
  objectPreset = 'base';
  snap = true; showDims = true;
  wallStart: Pt | null = null; cursor: Pt | null = null; chainCount = 0;
  roomPts: Pt[] = [];
  measA: Pt | null = null;
  calA: Pt | null = null; calB: Pt | null = null;
  scanUnderlay: Underlay | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; mid: { x: number; y: number }; scale: number; world: Pt } | null = null;
  private drag: null | { kind: string; start: Pt; last: Pt; data?: any; moved: boolean; screen: { x: number; y: number } } = null;
  private raf = 0; private visible = true;
  lastDir = 0;

  constructor(public canvas: HTMLCanvasElement, public hooks: PlanHooks) {
    this.ctx = canvas.getContext('2d')!;
    store.on(() => this.redraw());
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', e => this.onDown(e));
    canvas.addEventListener('pointermove', e => this.onMove(e));
    canvas.addEventListener('pointerup', e => this.onUp(e));
    canvas.addEventListener('pointercancel', e => this.onUp(e, true));
    canvas.addEventListener('wheel', e => { e.preventDefault(); const f = Math.exp(-e.deltaY * 0.0015); this.zoomAt(e.offsetX, e.offsetY, f); }, { passive: false });
    canvas.addEventListener('dblclick', e => { if (this.tool === 'wall') this.finishWall(); if (this.tool === 'room') this.finishRoom(); e.preventDefault(); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }
  setVisible(v: boolean) { this.visible = v; if (v) { this.resize(); } }
  resize() {
    const r = this.canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (!r.width) return;
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr); this.redraw();
  }
  get w() { return this.canvas.clientWidth; } get h() { return this.canvas.clientHeight; }
  toWorld(sx: number, sy: number): Pt { return { x: this.v.cx + (sx - this.w / 2) / this.v.scale, y: this.v.cy + (sy - this.h / 2) / this.v.scale }; }
  toScreen(p: Pt) { return { x: (p.x - this.v.cx) * this.v.scale + this.w / 2, y: (p.y - this.v.cy) * this.v.scale + this.h / 2 }; }
  zoomAt(sx: number, sy: number, f: number) {
    const before = this.toWorld(sx, sy); this.v.scale = Math.max(2, Math.min(2000, this.v.scale * f));
    const after = this.toWorld(sx, sy); this.v.cx += before.x - after.x; this.v.cy += before.y - after.y; this.redraw();
  }
  setTool(t: Tool) {
    this.tool = t; this.wallStart = null; this.roomPts = []; this.measA = null; this.calA = this.calB = null; this.chainCount = 0;
    this.canvas.style.cursor = t === 'select' || t === 'pan' ? 'default' : 'crosshair'; this.hooks.onDraftChange(); this.redraw();
  }
  fit(p = store.p) {
    const pts: Pt[] = [];
    p.walls.forEach(w => pts.push(w.a, w.b)); p.rooms.forEach(r => pts.push(...r.pts)); p.objects.forEach(o => pts.push(...objCorners(o)));
    const bg = p.background; if (bg && bg.visible) { pts.push({ x: bg.x, y: bg.y }, { x: bg.x + bg.wpx * bg.mpp, y: bg.y + bg.hpx * bg.mpp }); }
    if (this.scanUnderlay) { const u = this.scanUnderlay; pts.push({ x: u.x, y: u.y }, { x: u.x + u.w, y: u.y + u.h }); }
    if (!pts.length) { this.v = { cx: 3, cy: 2, scale: Math.min(this.w, this.h) / 12 || 40 }; this.redraw(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    const bw = Math.max(x1 - x0, 1), bh = Math.max(y1 - y0, 1);
    this.v = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale: Math.min(this.w / (bw * 1.25), this.h / (bh * 1.35)) };
    this.redraw();
  }
  redraw() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.visible) this.draw(); }); }

  // ---------- snapping ----------
  gridStep() { return getUnits() === 'metric' ? 0.05 : 3 * IN; }
  snapPoint(p: Pt, from?: Pt | null, excludeWall?: string): Pt {
    if (!this.snap) return p;
    const tol = 14 / this.v.scale; let best: Pt | null = null, bd = tol;
    for (const w of store.p.walls) { if (w.id === excludeWall) continue; for (const q of [w.a, w.b]) { const d = dist(p, q); if (d < bd) { bd = d; best = q; } } }
    for (const r of store.p.rooms) for (const q of r.pts) { const d = dist(p, q); if (d < bd) { bd = d; best = q; } }
    if (best) return { ...best };
    if (from) {
      // angle snap to 15deg, length to grid
      const dx = p.x - from.x, dy = p.y - from.y; let L = Math.hypot(dx, dy); let a = Math.atan2(dy, dx);
      const step = Math.PI / 12; const as = Math.round(a / step) * step;
      if (Math.abs(as - a) < 0.06) a = as;
      const g = this.gridStep(); L = Math.round(L / g) * g;
      let q = { x: from.x + Math.cos(a) * L, y: from.y + Math.sin(a) * L };
      // snap onto wall line
      for (const w of store.p.walls) { if (w.id === excludeWall) continue; const pr = projectOnSeg(p, w.a, w.b); if (pr.d < tol * 0.6 && pr.u > 0 && pr.u < 1) { q = pr.q; break; } }
      return q;
    }
    for (const w of store.p.walls) { if (w.id === excludeWall) continue; const pr = projectOnSeg(p, w.a, w.b); if (pr.d < tol * 0.6) return pr.q; }
    const g = this.gridStep(); return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  }

  // ---------- hit testing ----------
  hit(p: Pt): Selection | null {
    const tol = 10 / this.v.scale; const P = store.p; const sel = store.sel;
    // handles of current selection
    if (sel) {
      if (sel.kind === 'wall' || sel.kind === 'joint') { const w = store.wall(sel.id); if (w) for (const q of [w.a, w.b]) if (dist(p, q) < tol * 1.6) return { kind: 'joint', id: w.id, pt: { ...q } }; }
      if (sel.kind === 'object') { const o = P.objects.find(o => o.id === sel.id); if (o) {
        const rh = this.objRotHandle(o); if (dist(p, rh) < tol * 1.6) return { kind: 'object', id: o.id, pt: { x: -1, y: -1 } };
        const c = objCorners(o)[2]; if (dist(p, c) < tol * 1.6) return { kind: 'object', id: o.id, pt: { x: -2, y: -2 } };
      } }
      if (sel.kind === 'room') { const r = P.rooms.find(r => r.id === sel.id); if (r) { for (let i = 0; i < r.pts.length; i++) if (dist(p, r.pts[i]) < tol * 1.6) return { kind: 'room', id: r.id, pt: { x: i, y: -9 } };
        for (let i = 0; i < r.pts.length; i++) { const a = r.pts[i], b = r.pts[(i + 1) % r.pts.length]; if (dist(p, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) < tol * 1.6) return { kind: 'room', id: r.id, pt: { x: i, y: -8 } }; } } }
      if (sel.kind === 'measure') { const m = P.measures.find(m => m.id === sel.id); if (m) { if (dist(p, { x: m.a.x, y: m.a.z }) < tol * 1.6) return { kind: 'measure', id: m.id, pt: { x: 0, y: -9 } }; if (dist(p, { x: m.b.x, y: m.b.z }) < tol * 1.6) return { kind: 'measure', id: m.id, pt: { x: 1, y: -9 } }; } }
    }
    for (const o of P.openings) { const w = store.wall(o.wallId); if (!w) continue; const c = pointOnWall(w, o.t); const pr = projectOnSeg(p, w.a, w.b); if (pr.d < w.thickness / 2 + tol && Math.abs(pr.t - o.t) < o.width / 2) return { kind: 'opening', id: o.id }; void c; }
    for (const m of P.measures) { const pr = projectOnSeg(p, { x: m.a.x, y: m.a.z }, { x: m.b.x, y: m.b.z }); if (pr.d < tol) return { kind: 'measure', id: m.id }; }
    for (let i = P.objects.length - 1; i >= 0; i--) { const o = P.objects[i]; if (pointInPoly(p, objCorners(o))) return { kind: 'object', id: o.id }; }
    for (const w of P.walls) { const pr = projectOnSeg(p, w.a, w.b); if (pr.d < w.thickness / 2 + tol) return { kind: 'wall', id: w.id }; }
    for (let i = P.rooms.length - 1; i >= 0; i--) { const r = P.rooms[i]; if (pointInPoly(p, roomOutline(r))) return { kind: 'room', id: r.id }; }
    return null;
  }
  objRotHandle(o: Obj): Pt { const off = o.d / 2 + 18 / this.v.scale; return { x: o.x + Math.sin(o.rot) * off, y: o.y - Math.cos(o.rot) * off }; }

  // ---------- pointer ----------
  private sp(e: PointerEvent) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  onDown(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    const s = this.sp(e); this.pointers.set(e.pointerId, s);
    if (this.pointers.size === 2) {
      // start pinch; cancel single-finger drag
      if (this.drag && this.drag.moved && this.drag.kind !== 'pan') store.end();
      this.drag = null;
      const [a, b] = [...this.pointers.values()]; const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mid, scale: this.v.scale, world: this.toWorld(mid.x, mid.y) }; return;
    }
    if (this.pointers.size > 2) return;
    const p = this.toWorld(s.x, s.y);
    if (e.button === 1 || e.button === 2 || this.tool === 'pan') { this.drag = { kind: 'pan', start: p, last: p, moved: false, screen: s }; return; }
    if (this.tool === 'select') {
      const h = this.hit(p);
      if (h) {
        // keep selection kind for handles
        if (h.kind === 'joint') store.select({ kind: 'wall', id: h.id }); else if (!(store.sel && store.sel.id === h.id && h.pt)) store.select({ kind: h.kind, id: h.id });
        this.drag = { kind: h.kind, start: p, last: p, data: h, moved: false, screen: s };
      } else if (store.p.background && store.sel?.kind === 'background' && !store.p.background.locked) {
        this.drag = { kind: 'background', start: p, last: p, moved: false, screen: s };
      } else { this.drag = { kind: 'pan-select', start: p, last: p, moved: false, screen: s }; }
      return;
    }
    // drawing tools: track for tap
    this.drag = { kind: 'tap', start: p, last: p, moved: false, screen: s };
    this.cursor = this.toolSnap(p); this.redraw();
  }
  private toolSnap(p: Pt): Pt {
    if (this.tool === 'wall') return this.snapPoint(p, this.wallStart);
    if (this.tool === 'room') return this.snapPoint(p, this.roomPts[this.roomPts.length - 1] || null);
    if (this.tool === 'measure') return this.snapPoint(p, this.measA);
    if (this.tool === 'calibrate') return p;
    if (this.tool === 'object') return this.snapPoint(p);
    return p;
  }
  onMove(e: PointerEvent) {
    const s = this.sp(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, s);
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.v.scale = Math.max(2, Math.min(2000, this.pinch.scale * d / (this.pinch.d || 1)));
      this.v.cx = this.pinch.world.x - (mid.x - this.w / 2) / this.v.scale; this.v.cy = this.pinch.world.y - (mid.y - this.h / 2) / this.v.scale;
      this.redraw(); return;
    }
    const p = this.toWorld(s.x, s.y);
    const d = this.drag;
    if (!d) { // hover preview (mouse)
      if (this.tool !== 'select' && this.tool !== 'pan') { this.cursor = this.toolSnap(p); if (this.wallStart && this.cursor) this.lastDir = Math.atan2(this.cursor.y - this.wallStart.y, this.cursor.x - this.wallStart.x); this.hooks.onDraftChange(); this.redraw(); }
      return;
    }
    if (!d.moved && Math.hypot(s.x - d.screen.x, s.y - d.screen.y) < 6) return;
    if (!d.moved) { d.moved = true; if (!['pan', 'pan-select', 'tap'].includes(d.kind)) store.begin(); }
    const P = store.p;
    switch (d.kind) {
      case 'pan': case 'pan-select': { this.v.cx -= (s.x - d.screen.x) / this.v.scale; this.v.cy -= (s.y - d.screen.y) / this.v.scale; d.screen = s; this.redraw(); return; }
      case 'tap': { this.cursor = this.toolSnap(p); if (this.wallStart && this.cursor) this.lastDir = Math.atan2(this.cursor.y - this.wallStart.y, this.cursor.x - this.wallStart.x); this.hooks.onDraftChange(); this.redraw(); return; }
      case 'joint': {
        const pt0 = d.data.pt as Pt; const q = this.snapPoint(p, null, d.data.id);
        for (const w of P.walls) { if (dist(w.a, pt0) < 1e-4) w.a = { ...q }; if (dist(w.b, pt0) < 1e-4) w.b = { ...q }; }
        d.data.pt = { ...q }; break;
      }
      case 'wall': {
        const w = store.wall(d.data.id)!; const g = this.snap ? this.gridStep() : 0;
        let dx = p.x - d.start.x, dy = p.y - d.start.y; if (g) { dx = Math.round(dx / g) * g; dy = Math.round(dy / g) * g; }
        const ddx = dx - (d.data.ox || 0), ddy = dy - (d.data.oy || 0); d.data.ox = dx; d.data.oy = dy;
        const ends = [{ ...w.a }, { ...w.b }];
        for (const o of P.walls) for (const k of ['a', 'b'] as const) for (const e0 of ends) if (dist(o[k], e0) < 1e-4) o[k] = { x: o[k].x + ddx, y: o[k].y + ddy };
        break;
      }
      case 'opening': {
        const o = P.openings.find(o => o.id === d.data.id)!; let w = store.wall(o.wallId)!;
        // allow moving to another wall
        let best = w, bd = projectOnSeg(p, w.a, w.b).d;
        for (const ww of P.walls) { const pr = projectOnSeg(p, ww.a, ww.b); if (pr.d < bd - 0.05) { bd = pr.d; best = ww; } }
        if (best !== w && bd < 0.6) { o.wallId = best.id; w = best; }
        const L = wallLen(w); let t = projectOnSeg(p, w.a, w.b).t; if (this.snap) t = Math.round(t / IN) * IN;
        o.t = Math.max(o.width / 2, Math.min(L - o.width / 2, t)); break;
      }
      case 'object': {
        const o = P.objects.find(o => o.id === d.data.id)!;
        if (d.data.pt?.x === -1) { let a = Math.atan2(p.x - o.x, -(p.y - o.y)); if (this.snap) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12); o.rot = a; }
        else if (d.data.pt?.x === -2) { // resize from corner (local)
          const c = Math.cos(o.rot), sn = Math.sin(o.rot); const lx = (p.x - o.x) * c + (p.y - o.y) * sn, ly = -(p.x - o.x) * sn + (p.y - o.y) * c;
          const g = this.snap ? IN : 0; let w2 = Math.max(2 * IN, lx * 2), d2 = Math.max(2 * IN, ly * 2); if (g) { w2 = Math.round(w2 / g) * g; d2 = Math.round(d2 / g) * g; } o.w = w2; o.d = d2;
        } else {
          const g = this.snap ? IN : 0; if (!d.data.o0) d.data.o0 = { x: o.x, y: o.y };
          let nx = d.data.o0.x + p.x - d.start.x, ny = d.data.o0.y + p.y - d.start.y; if (g) { nx = Math.round(nx / g) * g; ny = Math.round(ny / g) * g; } o.x = nx; o.y = ny;
        }
        break;
      }
      case 'room': {
        const r = P.rooms.find(r => r.id === d.data.id)!;
        if (d.data.pt && d.data.pt.y === -8) { r.pts.splice(d.data.pt.x + 1, 0, this.snapPoint(p)); d.data.pt = { x: d.data.pt.x + 1, y: -9 }; }
        else if (d.data.pt && d.data.pt.y === -9) { r.pts[d.data.pt.x] = this.snapPoint(p); }
        else { if (!d.data.p0) d.data.p0 = r.pts.map((q: Pt) => ({ ...q })); const g = this.snap ? this.gridStep() : 0; let dx = p.x - d.start.x, dy = p.y - d.start.y; if (g) { dx = Math.round(dx / g) * g; dy = Math.round(dy / g) * g; } r.pts = d.data.p0.map((q: Pt) => ({ x: q.x + dx, y: q.y + dy })); }
        break;
      }
      case 'measure': {
        const m = P.measures.find(m => m.id === d.data.id)!; const q = this.snapPoint(p);
        if (d.data.pt && d.data.pt.y === -9) { const k = d.data.pt.x === 0 ? 'a' : 'b'; m[k] = { x: q.x, y: m[k].y, z: q.y }; }
        else { const dx = p.x - d.last.x, dy = p.y - d.last.y; m.a = { ...m.a, x: m.a.x + dx, z: m.a.z + dy }; m.b = { ...m.b, x: m.b.x + dx, z: m.b.z + dy }; }
        break;
      }
      case 'background': { const bg = P.background!; bg.x += p.x - d.last.x; bg.y += p.y - d.last.y; break; }
    }
    d.last = p; store.emit('live');
  }
  onUp(e: PointerEvent, cancel = false) {
    this.pointers.delete(e.pointerId);
    if (this.pinch) { if (this.pointers.size < 2) { this.pinch = null; this.drag = null; } return; }
    const d = this.drag; this.drag = null; if (!d) return;
    if (d.moved) { if (!['pan', 'pan-select', 'tap'].includes(d.kind)) store.end(); if (d.kind !== 'tap') return; }
    if (cancel) return;
    if (d.kind === 'pan-select' && !d.moved) { store.select(null); return; }
    if (d.kind === 'tap') { const s = this.sp(e); this.onTap(this.toolSnap(this.toWorld(s.x, s.y)), this.toWorld(s.x, s.y)); }
  }

  // ---------- tool actions ----------
  onTap(p: Pt, raw: Pt) {
    const P = store.p;
    switch (this.tool) {
      case 'wall': {
        if (!this.wallStart) { this.wallStart = p; this.chainCount = 0; }
        else {
          if (dist(p, this.wallStart) < 0.02) { this.finishWall(); break; }
          this.addWall(this.wallStart, p);
          // close chain if returned to a previous joint
          const closed = this.chainCount > 1 && P.walls.some(w => dist(w.a, p) < 1e-4 && w.id !== P.walls[P.walls.length - 1].id);
          if (closed) { this.wallStart = null; this.chainCount = 0; } else this.wallStart = p;
        }
        break;
      }
      case 'room': {
        if (this.roomPts.length >= 3 && dist(p, this.roomPts[0]) < 14 / this.v.scale) { this.finishRoom(); break; }
        this.roomPts.push(p); break;
      }
      case 'door': case 'window': case 'opening': case 'slider': this.placeOpening(this.tool, raw); break;
      case 'object': { this.placeObject(this.objectPreset, p); this.setTool('select'); break; }
      case 'measure': {
        if (!this.measA) this.measA = p; else { const a = this.measA; store.mutate(pp => pp.measures.push({ id: uid(), a: { x: a.x, y: 0, z: a.y }, b: { x: p.x, y: 0, z: p.y } })); this.measA = null; this.hooks.toast(`Measured ${fmtLen(dist(a, p))}`); }
        break;
      }
      case 'calibrate': {
        if (!this.calA) { this.calA = raw; this.calB = null; }
        else {
          this.calB = raw; const a = this.calA, b = raw; const measured = dist(a, b); this.redraw();
          this.hooks.askDistance(measured).then(real => {
            if (real && real > 0 && measured > 0) {
              const k = real / measured; const P2 = store.p; const bg = P2.background;
              if (bg) store.mutate(pp => { const b2 = pp.background!; // scale about point a
                b2.x = a.x + (b2.x - a.x) * k; b2.y = a.y + (b2.y - a.y) * k; b2.mpp *= k; });
              this.hooks.toast('Blueprint scale set. Now trace walls with the Wall tool.'); this.fitBackground();
            }
            this.calA = this.calB = null; this.setTool('wall');
          });
        }
        break;
      }
    }
    this.hooks.onDraftChange(); this.redraw();
  }
  placeObject(key: string, p: Pt) {
    const P = store.p; const pr = OBJECT_PRESETS[key] || OBJECT_PRESETS.box;
    const o: Obj = { id: uid(), kind: key, name: pr.name, x: p.x, y: p.y, w: pr.w, d: pr.d, h: pr.h, elev: pr.ceiling ? Math.max(0, P.defaults.ceiling - pr.h) : (pr.elev || 0), rot: 0, color: pr.color, finish: pr.finish || 'satin' };
    if (key === 'column' || key === 'column-rnd') o.h = P.defaults.wallHeight;
    if (pr.wallAlign) { // back against nearest wall, facing into room
      let best: Wall | null = null, bd = 1.2; for (const w of P.walls) { const q = projectOnSeg(p, w.a, w.b); if (q.d < bd) { bd = q.d; best = w; } }
      if (best) { const q = projectOnSeg(p, best.a, best.b); const dir = wallDir(best); let nx = -dir.y, ny = dir.x; if ((p.x - q.q.x) * nx + (p.y - q.q.y) * ny < 0) { nx = -nx; ny = -ny; }
        o.rot = Math.atan2(nx, -ny) + Math.PI; const off = best.thickness / 2 + o.d / 2; o.x = q.q.x + nx * off; o.y = q.q.y + ny * off; }
    }
    store.mutate(pp => pp.objects.push(o)); store.select({ kind: 'object', id: o.id }); return o;
  }
  fitBackground() { const bg = store.p.background; if (!bg) return; this.fit(); }
  addWall(a: Pt, b: Pt) {
    const D = store.p.defaults; const w: Wall = { id: uid(), a: { ...a }, b: { ...b }, thickness: D.wallThickness, height: D.wallHeight, color: '#f4f1ea' };
    store.mutate(p => p.walls.push(w)); this.chainCount++; this.lastDir = Math.atan2(b.y - a.y, b.x - a.x); return w;
  }
  /** Add wall of exact length/angle from the current start point. */
  addWallExact(len: number, angleRad: number) {
    if (!this.wallStart) return; const a = this.wallStart; const b = { x: a.x + Math.cos(angleRad) * len, y: a.y + Math.sin(angleRad) * len };
    this.addWall(a, b); this.wallStart = b; this.hooks.onDraftChange(); this.redraw();
  }
  finishWall() { this.wallStart = null; this.chainCount = 0; this.hooks.onDraftChange(); this.redraw(); }
  finishRoom() {
    if (this.roomPts.length >= 3) { const pts = this.roomPts; const n = store.p.rooms.length + 1; const r = { id: uid(), name: `Room ${n}`, pts, floor: 'tile', ceilingHeight: store.p.defaults.ceiling, showCeiling: true };
      store.mutate(p => p.rooms.push(r)); store.select({ kind: 'room', id: r.id }); }
    this.roomPts = []; this.hooks.onDraftChange(); this.redraw();
  }
  /** Detect room from walls enclosing the tapped point (uses wall graph cycle). */
  autoRoomAt(p: Pt): boolean {
    const poly = findEnclosure(store.p, p); if (!poly) return false;
    const r = { id: uid(), name: `Room ${store.p.rooms.length + 1}`, pts: poly, floor: 'tile', ceilingHeight: store.p.defaults.ceiling, showCeiling: true };
    store.mutate(pp => pp.rooms.push(r)); store.select({ kind: 'room', id: r.id }); return true;
  }
  openingPreset = 'door-int';
  placeOpening(kind: OpeningKind, p: Pt) {
    const it = OPENING_BY_KEY[this.openingPreset];
    const P = store.p; let best: Wall | null = null, bd = 0.6; for (const w of P.walls) { const q = projectOnSeg(p, w.a, w.b); if (q.d < bd) { bd = q.d; best = w; } }
    if (!best) { this.hooks.toast('Tap on a wall to place it'); return; }
    const D = P.defaults; if (it) kind = it.kind; const isWin = kind === 'window';
    const width = it ? it.width : kind === 'slider' ? 72 * IN : isWin ? D.winW : kind === 'opening' ? 36 * IN : D.doorW;
    const L = wallLen(best); if (L < width) { this.hooks.toast('Wall is too short for that'); return; }
    let t = projectOnSeg(p, best.a, best.b).t; t = Math.round(t / IN) * IN; t = Math.max(width / 2, Math.min(L - width / 2, t));
    const o: Opening = { id: uid(), kind, style: it?.style, wallId: best.id, t, width, height: it ? it.height : isWin ? D.winH : D.doorH, sill: it ? it.sill : isWin ? D.sill : 0, flip: false, hingeRight: false };
    // swing door into the side that was tapped
    const pr = projectOnSeg(p, best.a, best.b); const dd = wallDir(best); if ((p.x - pr.q.x) * -dd.y + (p.y - pr.q.y) * dd.x < 0) o.flip = true;
    store.mutate(pp => pp.openings.push(o)); store.select({ kind: 'opening', id: o.id });
  }

  // ---------- drawing ----------
  draw() {
    const c = this.ctx; const dpr = this.canvas.width / (this.w || 1);
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = '#fbfaf7'; c.fillRect(0, 0, this.w, this.h);
    drawPlan(c, store.p, this.v, this.w, this.h, { grid: true, dims: this.showDims, sel: store.sel, underlay: this.scanUnderlay, redraw: () => this.redraw(), handles: true });
    // drafts
    c.save(); this.applyXf(c);
    const px = 1 / this.v.scale;
    if (this.tool === 'wall' && this.wallStart && this.cursor) {
      const a = this.wallStart, b = this.cursor; c.strokeStyle = '#d9480f'; c.lineWidth = store.p.defaults.wallThickness; c.globalAlpha = 0.55; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.globalAlpha = 1;
      c.restore(); c.save();
      const m = this.toScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); label(c, m.x, m.y - 16, fmtLen(dist(a, b)), '#d9480f');
      c.restore(); c.save(); this.applyXf(c);
    }
    if (this.tool === 'room' && this.roomPts.length) {
      c.strokeStyle = '#1971c2'; c.lineWidth = 2 * px; c.setLineDash([6 * px, 4 * px]); c.beginPath(); this.roomPts.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); if (this.cursor) c.lineTo(this.cursor.x, this.cursor.y); c.stroke(); c.setLineDash([]);
      for (const q of this.roomPts) dot(c, q, 4 * px, '#1971c2');
    }
    if (this.tool === 'measure' && this.measA && this.cursor) {
      c.strokeStyle = '#7048e8'; c.lineWidth = 2 * px; c.beginPath(); c.moveTo(this.measA.x, this.measA.y); c.lineTo(this.cursor.x, this.cursor.y); c.stroke();
      c.restore(); c.save(); const m = this.toScreen({ x: (this.measA.x + this.cursor.x) / 2, y: (this.measA.y + this.cursor.y) / 2 }); label(c, m.x, m.y - 14, fmtLen(dist(this.measA, this.cursor)), '#7048e8'); c.restore(); c.save(); this.applyXf(c);
    }
    if (this.tool === 'calibrate' && this.calA) {
      const b = this.calB || this.cursor; dot(c, this.calA, 5 * px, '#e03131');
      if (b) { c.strokeStyle = '#e03131'; c.lineWidth = 2 * px; c.beginPath(); c.moveTo(this.calA.x, this.calA.y); c.lineTo(b.x, b.y); c.stroke(); dot(c, b, 5 * px, '#e03131'); }
    }
    if (this.cursor && this.tool !== 'select' && this.tool !== 'pan') { c.strokeStyle = '#d9480f'; c.lineWidth = 1.5 * px; c.beginPath(); c.arc(this.cursor.x, this.cursor.y, 6 * px, 0, Math.PI * 2); c.stroke(); }
    c.restore();
    // scale bar
    drawScaleBar(c, this.v, this.w, this.h);
  }
  applyXf(c: CanvasRenderingContext2D) { c.translate(this.w / 2, this.h / 2); c.scale(this.v.scale, this.v.scale); c.translate(-this.v.cx, -this.v.cy); }
}

function dot(c: CanvasRenderingContext2D, p: Pt, r: number, col: string) { c.fillStyle = col; c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill(); }
export function label(c: CanvasRenderingContext2D, x: number, y: number, text: string, col = '#222', size = 12, rot = 0, bg = 'rgba(255,255,255,0.88)') {
  c.save(); c.translate(x, y); c.rotate(rot); c.font = `600 ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  const w = c.measureText(text).width + 8; if (bg) { c.fillStyle = bg; c.fillRect(-w / 2, -size * 0.75, w, size * 1.5); }
  c.fillStyle = col; c.fillText(text, 0, 0); c.restore();
}
function niceStep(m: number) { const units = getUnits() === 'metric' ? [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50] : [1, 2, 5, 10, 20, 25, 50, 100].map(f => f * FT); for (const u of units) if (u >= m) return u; return units[units.length - 1]; }
function drawScaleBar(c: CanvasRenderingContext2D, v: ViewXf, w: number, h: number) {
  const L = niceStep(90 / v.scale); const px = L * v.scale; const x = 14, y = h - 18;
  c.save(); c.strokeStyle = '#333'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y - 5); c.lineTo(x, y); c.lineTo(x + px, y); c.lineTo(x + px, y - 5); c.stroke();
  c.font = '600 11px system-ui, sans-serif'; c.fillStyle = '#333'; c.fillText(fmtLen(L, { short: true }), x + px + 6, y + 2); c.restore();
}

export interface DrawOpts { grid: boolean; dims: boolean; sel: Selection | null; underlay?: Underlay | null; redraw?: () => void; handles?: boolean; print?: boolean; bg?: boolean }

/** Shared plan renderer (screen + export). */
export function drawPlan(c: CanvasRenderingContext2D, P: Project, v: ViewXf, W: number, H: number, o: DrawOpts) {
  const px = 1 / v.scale;
  const toS = (p: Pt) => ({ x: (p.x - v.cx) * v.scale + W / 2, y: (p.y - v.cy) * v.scale + H / 2 });
  c.save(); c.translate(W / 2, H / 2); c.scale(v.scale, v.scale); c.translate(-v.cx, -v.cy);
  // grid
  if (o.grid) {
    const step = getUnits() === 'metric' ? (v.scale > 60 ? 0.1 : 1) : (v.scale > 60 ? FT : 5 * FT); const major = getUnits() === 'metric' ? 1 : 5 * FT;
    const x0 = v.cx - W / 2 / v.scale, x1 = v.cx + W / 2 / v.scale, y0 = v.cy - H / 2 / v.scale, y1 = v.cy + H / 2 / v.scale;
    if ((x1 - x0) / step < 400) {
      c.lineWidth = px; c.beginPath(); c.strokeStyle = '#ebe8e1';
      for (let x = Math.floor(x0 / step) * step; x < x1; x += step) { c.moveTo(x, y0); c.lineTo(x, y1); }
      for (let y = Math.floor(y0 / step) * step; y < y1; y += step) { c.moveTo(x0, y); c.lineTo(x1, y); }
      c.stroke(); c.beginPath(); c.strokeStyle = '#ddd8cd';
      for (let x = Math.floor(x0 / major) * major; x < x1; x += major) { c.moveTo(x, y0); c.lineTo(x, y1); }
      for (let y = Math.floor(y0 / major) * major; y < y1; y += major) { c.moveTo(x0, y); c.lineTo(x1, y); }
      c.stroke();
    }
  }
  // blueprint background
  const bg = P.background;
  if (bg && bg.visible && o.bg !== false) {
    const im = assetImage(bg.assetId, () => o.redraw?.());
    if (im) { c.save(); c.globalAlpha = bg.opacity; c.translate(bg.x, bg.y); c.rotate(bg.rot); c.drawImage(im, 0, 0, bg.wpx * bg.mpp, bg.hpx * bg.mpp); c.restore();
      if (o.sel?.kind === 'background') { c.strokeStyle = '#1971c2'; c.lineWidth = 2 * px; c.setLineDash([8 * px, 6 * px]); c.strokeRect(bg.x, bg.y, bg.wpx * bg.mpp, bg.hpx * bg.mpp); c.setLineDash([]); } }
  }
  const u = o.underlay; if (u && o.bg !== false) { c.save(); c.globalAlpha = u.opacity; c.drawImage(u.img, u.x, u.y, u.w, u.h); c.restore(); }
  // rooms
  for (const r of P.rooms) {
    if (r.pts.length < 3) continue; const col = FLOORS[r.floor]?.color || '#ddd';
    const ol = roomOutline(r); c.beginPath(); ol.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); c.closePath();
    c.fillStyle = col + (r.outdoor ? 'aa' : '55'); c.fill();
    if (r.outdoor) { c.strokeStyle = '#00000040'; c.lineWidth = 1 * px; c.stroke(); }
    if (r.curb) { c.strokeStyle = '#bdb6a8'; c.lineWidth = Math.max(0.15, 3 * px); c.stroke(); }
    if (o.sel?.kind === 'room' && o.sel.id === r.id) { c.strokeStyle = '#1971c2'; c.lineWidth = 2.5 * px; c.stroke(); if (o.handles) { if (r.smooth) { c.setLineDash([4 * px, 4 * px]); c.lineWidth = 1 * px; c.beginPath(); r.pts.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); c.closePath(); c.stroke(); c.setLineDash([]); }
      for (let k = 0; k < r.pts.length; k++) { const q = r.pts[k], q2 = r.pts[(k + 1) % r.pts.length]; c.fillStyle = '#1971c2'; c.beginPath(); c.arc((q.x + q2.x) / 2, (q.y + q2.y) / 2, 4 * px, 0, 7); c.fill(); }
      for (const q of r.pts) { c.fillStyle = '#fff'; c.strokeStyle = '#1971c2'; c.lineWidth = 2 * px; c.beginPath(); c.arc(q.x, q.y, 7 * px, 0, 7); c.fill(); c.stroke(); } } }
  }
  // walls
  const selWall = o.sel && (o.sel.kind === 'wall' || o.sel.kind === 'joint') ? o.sel.id : null;
  for (const w of P.walls) {
    const L = wallLen(w); if (L < 1e-6) continue; const d = wallDir(w); const n = { x: -d.y, y: d.x }; const h = w.thickness / 2;
    // extend ends that connect to other walls (for clean corners)
    const ext = (pt: Pt) => P.walls.some(o2 => o2 !== w && (dist(o2.a, pt) < 1e-3 || dist(o2.b, pt) < 1e-3)) ? h : 0;
    const ea = ext(w.a), eb = ext(w.b);
    const ops = wallOpenings(P, w);
    // solid segments
    const segs: [number, number][] = []; let s0 = -ea;
    for (const op of ops) { const a = op.t - op.width / 2, b = op.t + op.width / 2; if (a > s0) segs.push([s0, a]); s0 = Math.max(s0, b); }
    if (L + eb > s0) segs.push([s0, L + eb]);
    c.fillStyle = selWall === w.id ? '#1c7ed6' : (o.print ? '#2b2b2b' : '#3d3a35');
    for (const [s1, s2] of segs) {
      const p1 = { x: w.a.x + d.x * s1, y: w.a.y + d.y * s1 }, p2 = { x: w.a.x + d.x * s2, y: w.a.y + d.y * s2 };
      c.beginPath(); c.moveTo(p1.x + n.x * h, p1.y + n.y * h); c.lineTo(p2.x + n.x * h, p2.y + n.y * h); c.lineTo(p2.x - n.x * h, p2.y - n.y * h); c.lineTo(p1.x - n.x * h, p1.y - n.y * h); c.closePath(); c.fill();
    }
    // openings symbols
    for (const op of ops) {
      const ctr = pointOnWall(w, op.t); const a = { x: ctr.x - d.x * op.width / 2, y: ctr.y - d.y * op.width / 2 }, b = { x: ctr.x + d.x * op.width / 2, y: ctr.y + d.y * op.width / 2 };
      const isSel = o.sel?.kind === 'opening' && o.sel.id === op.id; const col = isSel ? '#1c7ed6' : '#444';
      c.strokeStyle = col; c.lineWidth = 1.5 * px;
      // jamb lines
      c.beginPath(); for (const q of [a, b]) { c.moveTo(q.x + n.x * h, q.y + n.y * h); c.lineTo(q.x - n.x * h, q.y - n.y * h); } c.stroke();
      if (op.kind === 'window' && op.style === 'bay') {
        const sg = op.flip ? -1 : 1; const dep = 0.45 * sg; const e = h * sg; c.beginPath();
        c.moveTo(a.x + n.x * e, a.y + n.y * e); c.lineTo(a.x + d.x * op.width * 0.25 + n.x * (e + dep), a.y + d.y * op.width * 0.25 + n.y * (e + dep)); c.lineTo(b.x - d.x * op.width * 0.25 + n.x * (e + dep), b.y - d.y * op.width * 0.25 + n.y * (e + dep)); c.lineTo(b.x + n.x * e, b.y + n.y * e); c.stroke();
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      } else if (op.kind === 'window') {
        c.beginPath(); for (const f of [-h, 0, h]) { c.moveTo(a.x + n.x * f, a.y + n.y * f); c.lineTo(b.x + n.x * f, b.y + n.y * f); } c.stroke();
      } else if (op.kind === 'door' && (op.style === 'pocket' || op.style === 'garage' || op.style === 'bifold')) {
        c.setLineDash([5 * px, 3 * px]); c.beginPath();
        if (op.style === 'pocket') { c.moveTo(a.x, a.y); c.lineTo(a.x - d.x * op.width, a.y - d.y * op.width); }
        else if (op.style === 'garage') { const sg = op.flip ? -1 : 1; const dep = Math.min(op.height, 2.2) * sg; c.moveTo(a.x, a.y); c.lineTo(a.x + n.x * dep, a.y + n.y * dep); c.lineTo(b.x + n.x * dep, b.y + n.y * dep); c.lineTo(b.x, b.y); }
        else { const sg = op.flip ? -1 : 1; const k = 4; for (let j = 0; j <= k; j++) { const t = j / k; const z = (j % 2) * 0.12 * sg; const q = { x: a.x + (b.x - a.x) * t + n.x * z, y: a.y + (b.y - a.y) * t + n.y * z }; j ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); } }
        c.stroke(); c.setLineDash([]);
      } else if (op.kind === 'door' && op.style === 'french') {
        const sgn = op.flip ? -1 : 1; const hw = op.width / 2;
        for (const [hinge, other] of [[a, ctr], [b, ctr]] as [Pt, Pt][]) {
          const open = { x: hinge.x + n.x * sgn * hw, y: hinge.y + n.y * sgn * hw }; c.beginPath(); c.moveTo(hinge.x, hinge.y); c.lineTo(open.x, open.y); c.stroke();
          const a0 = Math.atan2(other.y - hinge.y, other.x - hinge.x), a1 = Math.atan2(open.y - hinge.y, open.x - hinge.x); let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
          c.setLineDash([4 * px, 3 * px]); c.beginPath(); c.arc(hinge.x, hinge.y, hw, a0, a1, da < 0); c.stroke(); c.setLineDash([]);
        }
      } else if (op.kind === 'door') {
        const sgn = op.flip ? -1 : 1; const hinge = op.hingeRight ? b : a; const other = op.hingeRight ? a : b;
        const open = { x: hinge.x + n.x * sgn * op.width, y: hinge.y + n.y * sgn * op.width };
        c.beginPath(); c.moveTo(hinge.x, hinge.y); c.lineTo(open.x, open.y); c.stroke();
        const a0 = Math.atan2(other.y - hinge.y, other.x - hinge.x), a1 = Math.atan2(open.y - hinge.y, open.x - hinge.x);
        let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        c.setLineDash([4 * px, 3 * px]); c.beginPath(); c.arc(hinge.x, hinge.y, op.width, a0, a1, da < 0); c.stroke(); c.setLineDash([]);
      } else if (op.kind === 'slider') {
        c.beginPath(); const m = { x: ctr.x, y: ctr.y }; const q = h * 0.4;
        c.moveTo(a.x + n.x * q, a.y + n.y * q); c.lineTo(m.x + d.x * op.width * 0.08 + n.x * q, m.y + d.y * op.width * 0.08 + n.y * q);
        c.moveTo(m.x - d.x * op.width * 0.08 - n.x * q, m.y - d.y * op.width * 0.08 - n.y * q); c.lineTo(b.x - n.x * q, b.y - n.y * q); c.stroke();
      } else { c.setLineDash([3 * px, 3 * px]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]); }
    }
    if (selWall === w.id && o.handles) for (const q of [w.a, w.b]) { c.fillStyle = '#fff'; c.strokeStyle = '#1c7ed6'; c.lineWidth = 2 * px; c.beginPath(); c.arc(q.x, q.y, 7 * px, 0, 7); c.fill(); c.stroke(); }
  }
  // objects
  for (const ob of P.objects) {
    const cs = objCorners(ob); c.beginPath(); const fp = OBJECT_PRESETS[ob.kind]?.fp;
    if (fp === 'circle') c.ellipse(ob.x, ob.y, ob.w / 2, ob.d / 2, ob.rot, 0, Math.PI * 2); else cs.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); c.closePath();
    c.fillStyle = ob.color + 'cc'; c.fill(); const isSel = o.sel?.kind === 'object' && o.sel.id === ob.id; c.strokeStyle = isSel ? '#1c7ed6' : '#555'; c.lineWidth = (isSel ? 2.5 : 1) * px; c.stroke();
    // front marker
    c.beginPath(); c.moveTo(cs[2].x, cs[2].y); c.lineTo(cs[3].x, cs[3].y); c.lineWidth = 3 * px; c.stroke();
    if (isSel && o.handles) {
      const off = ob.d / 2 + 18 * px; const rh = { x: ob.x + Math.sin(ob.rot) * off, y: ob.y - Math.cos(ob.rot) * off };
      c.lineWidth = 1.5 * px; c.beginPath(); c.moveTo(ob.x, ob.y); c.lineTo(rh.x, rh.y); c.stroke();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(rh.x, rh.y, 7 * px, 0, 7); c.fill(); c.stroke();
      c.fillStyle = '#1c7ed6'; c.fillRect(cs[2].x - 6 * px, cs[2].y - 6 * px, 12 * px, 12 * px);
    }
  }
  // measures
  for (const m of P.measures) {
    const isSel = o.sel?.kind === 'measure' && o.sel.id === m.id; c.strokeStyle = isSel ? '#1c7ed6' : '#7048e8'; c.lineWidth = 2 * px; c.setLineDash([6 * px, 4 * px]);
    c.beginPath(); c.moveTo(m.a.x, m.a.z); c.lineTo(m.b.x, m.b.z); c.stroke(); c.setLineDash([]);
    for (const q of [m.a, m.b]) { c.fillStyle = c.strokeStyle as string; c.beginPath(); c.arc(q.x, q.z, 4 * px, 0, 7); c.fill(); }
  }
  c.restore();
  // ---- screen-space labels ----
  for (const r of P.rooms) {
    if (r.pts.length < 3) continue; const ol = roomOutline(r); const ctr = toS(polyCentroid(ol));
    label(c, ctr.x, ctr.y - 8, r.name, '#222', o.print ? 14 : 13, 0, '');
    label(c, ctr.x, ctr.y + 9, fmtArea(polyArea(ol)), '#555', 11, 0, '');
  }
  let gcx = 0, gcy = 0; for (const w of P.walls) { gcx += w.a.x + w.b.x; gcy += w.a.y + w.b.y; } gcx /= (2 * P.walls.length || 1); gcy /= (2 * P.walls.length || 1);
  if (o.dims) for (const w of P.walls) {
    const L = wallLen(w); if (L * v.scale < 45) continue; const d = wallDir(w); const n = { x: -d.y, y: d.x };
    if (((w.a.x + w.b.x) / 2 - gcx) * n.x + ((w.a.y + w.b.y) / 2 - gcy) * n.y < 0) { n.x = -n.x; n.y = -n.y; }
    const off = w.thickness / 2 + 14 / v.scale; const m = { x: (w.a.x + w.b.x) / 2 + n.x * off, y: (w.a.y + w.b.y) / 2 + n.y * off };
    const s = toS(m); let ang = Math.atan2(d.y, d.x); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
    // dimension line
    const a = toS({ x: w.a.x + n.x * off, y: w.a.y + n.y * off }), b = toS({ x: w.b.x + n.x * off, y: w.b.y + n.y * off });
    c.save(); c.strokeStyle = '#868e96'; c.lineWidth = 1; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);
    for (const q of [a, b]) { c.moveTo(q.x - n.x * 5 + d.x * 4, q.y - n.y * 5 + d.y * 4); c.lineTo(q.x + n.x * 5 - d.x * 4, q.y + n.y * 5 - d.y * 4); } c.stroke(); c.restore();
    label(c, s.x, s.y, fmtLen(L, { short: v.scale < 25 }), '#212529', 11, ang);
  }
  // inside dimensions along each straight room edge (what the customer measures with a tape)
  if (o.dims) for (const r of P.rooms) {
    if (r.smooth || r.pts.length < 3) continue; if (!(o.sel?.kind === 'room' && o.sel.id === r.id) && !(o.print && P.rooms.length <= 3) && P.rooms.length > 1) continue; const ctr = polyCentroid(r.pts);
    for (let i = 0; i < r.pts.length; i++) { const a = r.pts[i], b = r.pts[(i + 1) % r.pts.length]; const L = dist(a, b); if (L * v.scale < 60) continue;
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; const dx = (b.x - a.x) / L, dy = (b.y - a.y) / L; let nx = -dy, ny = dx; if ((ctr.x - m.x) * nx + (ctr.y - m.y) * ny < 0) { nx = -nx; ny = -ny; }
      const s = toS({ x: m.x + nx * 16 / v.scale, y: m.y + ny * 16 / v.scale }); let ang = Math.atan2(dy, dx); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
      label(c, s.x, s.y, fmtLen(L, { short: v.scale < 25 }), r.outdoor ? '#2b8a3e' : '#1864ab', 10, ang, 'rgba(255,255,255,0.6)'); }
  }
  for (const ob of P.objects) { if (Math.min(ob.w, ob.d) * v.scale < 40) continue; const s = toS(ob); label(c, s.x, s.y, ob.name, '#333', 10, 0, ''); }
  for (const m of P.measures) { const s = toS({ x: (m.a.x + m.b.x) / 2, y: (m.a.z + m.b.z) / 2 }); const L = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y, m.b.z - m.a.z); label(c, s.x, s.y - 12, fmtLen(L), '#7048e8', 11); }
}

/** Find smallest enclosing polygon formed by wall centerlines around point p. */
export function findEnclosure(P: Project, p: Pt): Pt[] | null {
  // Build planar graph from walls (split walls at junctions where endpoints touch other walls).
  const key = (q: Pt) => `${Math.round(q.x * 200)},${Math.round(q.y * 200)}`;
  const nodes = new Map<string, Pt>(); const adj = new Map<string, Set<string>>();
  const pts: Pt[] = []; P.walls.forEach(w => pts.push(w.a, w.b));
  const add = (a: Pt, b: Pt) => { const ka = key(a), kb = key(b); if (ka === kb) return; nodes.set(ka, a); nodes.set(kb, b); if (!adj.has(ka)) adj.set(ka, new Set()); if (!adj.has(kb)) adj.set(kb, new Set()); adj.get(ka)!.add(kb); adj.get(kb)!.add(ka); };
  for (const w of P.walls) {
    const L = wallLen(w); const cuts = [0, L];
    for (const q of pts) { const pr = projectOnSeg(q, w.a, w.b); if (pr.d < 0.01 && pr.t > 0.01 && pr.t < L - 0.01) cuts.push(pr.t); }
    cuts.sort((a, b) => a - b); for (let i = 0; i < cuts.length - 1; i++) add(pointOnWall(w, cuts[i]), pointOnWall(w, cuts[i + 1]));
  }
  // Traverse faces: for each directed edge, follow next edge turning most to the right (smallest CCW angle).
  let best: Pt[] | null = null, bestA = Infinity;
  const used = new Set<string>();
  for (const [ka, set] of adj) for (const kb of set) {
    const ek = ka + '>' + kb; if (used.has(ek)) continue;
    const face: string[] = [ka]; let prev = ka, cur = kb; let guard = 0; used.add(ek);
    while (cur !== ka && guard++ < 500) {
      face.push(cur); const pc = nodes.get(cur)!, pp = nodes.get(prev)!; const inAng = Math.atan2(pp.y - pc.y, pp.x - pc.x);
      let bestN: string | null = null, bestTurn = Infinity;
      for (const nk of adj.get(cur)!) { if (nk === prev && adj.get(cur)!.size > 1) continue; const pn = nodes.get(nk)!; let a = Math.atan2(pn.y - pc.y, pn.x - pc.x) - inAng; while (a <= 0) a += 2 * Math.PI; if (a < bestTurn) { bestTurn = a; bestN = nk; } }
      if (!bestN) break; used.add(cur + '>' + bestN); prev = cur; cur = bestN;
    }
    if (cur !== ka) continue;
    const poly = face.map(k => nodes.get(k)!); if (poly.length < 3) continue;
    if (pointInPoly(p, poly)) { const A = polyArea(poly); if (A < bestA) { bestA = A; best = poly.map(q => ({ ...q })); } }
  }
  return best;
}
