// "Design on a photo": drop plants, materials and curbing onto a photo of the actual yard.
// Perspective is approximated from a horizon line: things lower in the photo (closer) are drawn larger,
// and material textures shrink toward the horizon.
import { store, uid, PhotoDesign, PhotoItem } from './model';

export const PHOTO_MATS: Record<string, { label: string; draw: (c: CanvasRenderingContext2D, s: number) => void; size: number }> = {
  sod: { label: 'Sod / lawn', size: 64, draw: (c, s) => { c.fillStyle = '#5f9442'; c.fillRect(0, 0, s, s); for (let i = 0; i < 220; i++) { c.strokeStyle = ['#4d7f35', '#79ad55', '#68a048'][i % 3]; c.beginPath(); const x = rnd(i) * s, y = rnd(i + 99) * s; c.moveTo(x, y); c.lineTo(x + (rnd(i + 7) - 0.5) * 3, y - 4 - rnd(i + 3) * 4); c.stroke(); } } },
  mulch: { label: 'Brown mulch', size: 64, draw: (c, s) => { c.fillStyle = '#5a3a24'; c.fillRect(0, 0, s, s); for (let i = 0; i < 160; i++) { c.fillStyle = ['#7a4e2e', '#3e2818', '#8d5f3a'][i % 3]; c.save(); c.translate(rnd(i) * s, rnd(i + 50) * s); c.rotate(rnd(i + 9) * 6); c.fillRect(-4, -1, 8, 2.5); c.restore(); } } },
  redmulch: { label: 'Red mulch', size: 64, draw: (c, s) => { c.fillStyle = '#7a2e22'; c.fillRect(0, 0, s, s); for (let i = 0; i < 160; i++) { c.fillStyle = ['#9a3e2e', '#5a2018', '#a8503a'][i % 3]; c.save(); c.translate(rnd(i) * s, rnd(i + 50) * s); c.rotate(rnd(i + 9) * 6); c.fillRect(-4, -1, 8, 2.5); c.restore(); } } },
  rock: { label: 'River rock', size: 64, draw: (c, s) => { c.fillStyle = '#9b958a'; c.fillRect(0, 0, s, s); for (let i = 0; i < 70; i++) { c.fillStyle = ['#c9c3b6', '#8a8478', '#b0a898', '#ddd6c8'][i % 4]; c.beginPath(); c.ellipse(rnd(i) * s, rnd(i + 31) * s, 3 + rnd(i + 2) * 4, 2 + rnd(i + 5) * 3, rnd(i) * 3, 0, 7); c.fill(); } } },
  whiterock: { label: 'White marble chips', size: 64, draw: (c, s) => { c.fillStyle = '#d9d6cf'; c.fillRect(0, 0, s, s); for (let i = 0; i < 120; i++) { c.fillStyle = ['#f4f2ee', '#c4c0b8', '#ffffff'][i % 3]; c.beginPath(); c.ellipse(rnd(i) * s, rnd(i + 31) * s, 1.5 + rnd(i + 2) * 2.5, 1 + rnd(i + 5) * 2, rnd(i) * 3, 0, 7); c.fill(); } } },
  pavers: { label: 'Pavers (tan)', size: 96, draw: (c, s) => brick(c, s, ['#c9a27e', '#b98f6c', '#d6b48f'], '#8d735c') },
  paversgray: { label: 'Pavers (gray)', size: 96, draw: (c, s) => brick(c, s, ['#a8a6a0', '#96948e', '#bab8b2'], '#6f6d68') },
  travertine: { label: 'Travertine', size: 128, draw: (c, s) => { const t = s / 2; for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { c.fillStyle = ['#e6dac4', '#dccfb7', '#efe5d2', '#d8c9ae'][(x + y * 2)]; c.fillRect(x * t, y * t, t, t); } c.strokeStyle = '#bfb29b'; c.lineWidth = 2; c.strokeRect(0, 0, t, t); c.strokeRect(t, t, t, t); c.strokeRect(t, 0, t, t); c.strokeRect(0, t, t, t); } },
  concrete: { label: 'Concrete', size: 96, draw: (c, s) => { c.fillStyle = '#bdbab3'; c.fillRect(0, 0, s, s); for (let i = 0; i < 300; i++) { c.fillStyle = rnd(i) > 0.5 ? '#c9c6bf' : '#aeaba4'; c.fillRect(rnd(i + 3) * s, rnd(i + 8) * s, 1.5, 1.5); } c.strokeStyle = '#9a978f'; c.strokeRect(0, 0, s, s); } },
  stamped: { label: 'Stamped concrete (slate)', size: 128, draw: (c, s) => { c.fillStyle = '#9c8a76'; c.fillRect(0, 0, s, s); c.strokeStyle = '#6b5c4c'; c.lineWidth = 2; for (let i = 0; i < 7; i++) { c.beginPath(); c.moveTo(rnd(i) * s, 0); c.lineTo(rnd(i + 4) * s, s); c.stroke(); c.beginPath(); c.moveTo(0, rnd(i + 11) * s); c.lineTo(s, rnd(i + 17) * s); c.stroke(); } } },
  stampedred: { label: 'Stamped concrete (brick red)', size: 96, draw: (c, s) => brick(c, s, ['#a5523e', '#94473a', '#b4604a'], '#6b3328') },
  turf: { label: 'Artificial turf', size: 64, draw: (c, s) => { c.fillStyle = '#4f9a3a'; c.fillRect(0, 0, s, s); for (let i = 0; i < 300; i++) { c.fillStyle = rnd(i) > 0.5 ? '#5fae48' : '#3f8a30'; c.fillRect(rnd(i + 3) * s, rnd(i + 8) * s, 1, 3); } } },
};
function brick(c: CanvasRenderingContext2D, s: number, cols: string[], joint: string) { c.fillStyle = joint; c.fillRect(0, 0, s, s); const bh = s / 4, bw = s / 2; for (let r = 0; r < 4; r++) for (let k = -1; k < 3; k++) { c.fillStyle = cols[(r * 3 + k + 9) % cols.length]; const x = k * bw + (r % 2) * bw / 2; c.fillRect(x + 1.5, r * bh + 1.5, bw - 3, bh - 3); } }
function rnd(i: number) { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }

// Sprites drawn procedurally at a given pixel height h, anchored at bottom-center (0,0).
export const PHOTO_SPRITES: Record<string, { label: string; ratio: number; draw: (c: CanvasRenderingContext2D, h: number) => void }> = {
  palm: { label: 'Palm', ratio: 0.8, draw: (c, h) => { c.strokeStyle = '#8a6a48'; c.lineWidth = h * 0.05; c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(h * 0.08, -h * 0.5, 0, -h * 0.82); c.stroke(); for (let k = 0; k < 9; k++) { const a = -Math.PI / 2 + (k - 4) * 0.42; c.strokeStyle = k % 2 ? '#3f7a2e' : '#5a9a3c'; c.lineWidth = h * 0.035; c.beginPath(); c.moveTo(0, -h * 0.82); c.quadraticCurveTo(Math.cos(a) * h * 0.3, -h * 0.82 + Math.sin(a) * h * 0.25 - h * 0.05, Math.cos(a) * h * 0.42, -h * 0.82 + Math.sin(a) * h * 0.1 + h * 0.12); c.stroke(); } } },
  tree: { label: 'Shade tree', ratio: 0.9, draw: (c, h) => { c.fillStyle = '#6b4e32'; c.fillRect(-h * 0.035, -h * 0.45, h * 0.07, h * 0.45); for (let k = 0; k < 9; k++) { c.fillStyle = ['#3f6f2a', '#4f8436', '#5c9640'][k % 3]; c.beginPath(); c.arc((rnd(k) - 0.5) * h * 0.5, -h * 0.62 - (rnd(k + 5) - 0.5) * h * 0.35, h * 0.2, 0, 7); c.fill(); } } },
  shrub: { label: 'Shrub', ratio: 1.4, draw: (c, h) => { for (let k = 0; k < 7; k++) { c.fillStyle = ['#3f7a30', '#4f8f3a', '#5fa046'][k % 3]; c.beginPath(); c.arc((rnd(k) - 0.5) * h * 0.8, -h * 0.45 - (rnd(k + 3) - 0.5) * h * 0.4, h * 0.36, 0, 7); c.fill(); } } },
  flowers: { label: 'Flowering shrub', ratio: 1.3, draw: (c, h) => { PHOTO_SPRITES.shrub.draw(c, h); for (let k = 0; k < 22; k++) { c.fillStyle = ['#e64980', '#f783ac', '#fff0f6'][k % 3]; c.beginPath(); c.arc((rnd(k + 40) - 0.5) * h * 1.1, -h * 0.15 - rnd(k + 60) * h * 0.75, h * 0.05, 0, 7); c.fill(); } } },
  grass: { label: 'Ornamental grass', ratio: 1, draw: (c, h) => { for (let k = 0; k < 26; k++) { c.strokeStyle = k % 2 ? '#a8b86a' : '#7d9450'; c.lineWidth = Math.max(1, h * 0.02); c.beginPath(); c.moveTo(0, 0); const a = (k / 25 - 0.5) * 1.6; c.quadraticCurveTo(Math.sin(a) * h * 0.3, -h * 0.6, Math.sin(a) * h * 0.55, -h * (0.75 + rnd(k) * 0.25)); c.stroke(); } } },
  boulder: { label: 'Boulder', ratio: 1.6, draw: (c, h) => { c.fillStyle = '#8f8a80'; c.beginPath(); c.moveTo(-h * 0.8, 0); c.quadraticCurveTo(-h * 0.8, -h, 0, -h); c.quadraticCurveTo(h * 0.8, -h * 0.9, h * 0.8, 0); c.fill(); c.fillStyle = '#ffffff22'; c.beginPath(); c.ellipse(-h * 0.2, -h * 0.7, h * 0.3, h * 0.15, -0.3, 0, 7); c.fill(); } },
  pot: { label: 'Planter pot', ratio: 0.8, draw: (c, h) => { PHOTO_SPRITES.shrub.draw(c, h * 0.55); c.translate(0, 0); c.fillStyle = '#b5653d'; c.beginPath(); c.moveTo(-h * 0.3, -h * 0.5); c.lineTo(h * 0.3, -h * 0.5); c.lineTo(h * 0.22, 0); c.lineTo(-h * 0.22, 0); c.fill(); } },
  light: { label: 'Path light', ratio: 0.25, draw: (c, h) => { c.fillStyle = '#222'; c.fillRect(-h * 0.03, -h * 0.85, h * 0.06, h * 0.85); c.fillStyle = '#ffe8a3'; c.beginPath(); c.arc(0, -h * 0.9, h * 0.1, 0, 7); c.fill(); c.fillStyle = '#222'; c.fillRect(-h * 0.14, -h * 1.02, h * 0.28, h * 0.06); } },
  person: { label: 'Person (6\' for scale)', ratio: 0.32, draw: (c, h) => { c.fillStyle = '#44505c'; c.beginPath(); c.arc(0, -h * 0.92, h * 0.075, 0, 7); c.fill(); c.fillRect(-h * 0.1, -h * 0.82, h * 0.2, h * 0.4); c.fillRect(-h * 0.09, -h * 0.45, h * 0.075, h * 0.45); c.fillRect(h * 0.015, -h * 0.45, h * 0.075, h * 0.45); } },
};
const BASE_H: Record<string, number> = { palm: 0.55, tree: 0.6, shrub: 0.12, flowers: 0.12, grass: 0.13, boulder: 0.07, pot: 0.14, light: 0.08, person: 0.3 };

const patCache = new Map<string, HTMLCanvasElement>();
function patCanvas(k: string) { let cv = patCache.get(k); if (!cv) { const m = PHOTO_MATS[k]; cv = document.createElement('canvas'); cv.width = cv.height = m.size; m.draw(cv.getContext('2d')!, m.size); patCache.set(k, cv); } return cv; }

export type PhotoTool = 'select' | 'area' | 'curb' | 'horizon' | 'sprite';

export class PhotoView {
  ctx: CanvasRenderingContext2D; img: HTMLImageElement | null = null; design: PhotoDesign | null = null;
  tool: PhotoTool = 'select'; sprite = 'palm'; mat = 'mulch'; draft: { x: number; y: number }[] = []; selId: string | null = null; before = false;
  private xf = { s: 1, ox: 0, oy: 0 }; private drag: any = null; private pointers = new Map<number, any>(); private pinch: any = null;
  onChange: () => void = () => {};
  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!; new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', e => this.down(e)); canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e)); canvas.addEventListener('pointercancel', e => this.up(e));
    canvas.addEventListener('dblclick', () => this.finishDraft());
  }
  resize() { const r = this.canvas.getBoundingClientRect(); if (!r.width) return; const dpr = Math.min(devicePixelRatio || 1, 2.5); this.canvas.width = r.width * dpr; this.canvas.height = r.height * dpr; this.fit(); }
  async open(d: PhotoDesign | null) {
    this.design = d; this.selId = null; this.draft = []; this.img = null;
    if (d) { const b = store.assets.get(d.assetId); if (b) { const im = new Image(); im.src = URL.createObjectURL(b); await im.decode().catch(() => {}); this.img = im; } }
    this.fit();
  }
  fit() { const W = this.canvas.width, H = this.canvas.height; if (this.img) { const s = Math.min(W / this.img.naturalWidth, H / this.img.naturalHeight); this.xf = { s, ox: (W - this.img.naturalWidth * s) / 2, oy: (H - this.img.naturalHeight * s) / 2 }; } this.draw(); }
  private toImg(e: PointerEvent) { const r = this.canvas.getBoundingClientRect(); const k = this.canvas.width / r.width; return { x: ((e.clientX - r.left) * k - this.xf.ox) / this.xf.s, y: ((e.clientY - r.top) * k - this.xf.oy) / this.xf.s }; }
  depth(y: number) { const d = this.design!; const hz = d.horizon * d.hpx; return Math.max(0.04, (y - hz) / (d.hpx - hz)); }
  hitItem(p: { x: number; y: number }): PhotoItem | null {
    const d = this.design!; for (let i = d.items.length - 1; i >= 0; i--) { const it = d.items[i];
      if (it.pts) { if (inPoly(p, it.pts) || it.pts.some((q, k) => k && segD(p, it.pts![k - 1], q) < 14 / this.xf.s)) return it; continue; }
      const sp = PHOTO_SPRITES[it.kind]; if (!sp) continue; const h = this.spriteH(it); const w = h * sp.ratio; if (p.x > it.x - w / 2 && p.x < it.x + w / 2 && p.y > it.y - h && p.y < it.y + 6) return it; }
    return null;
  }
  spriteH(it: PhotoItem) { const d = this.design!; return (BASE_H[it.kind] || 0.1) * d.hpx * this.depth(it.y) * it.s; }
  down(e: PointerEvent) {
    if (!this.design) return; this.canvas.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = this.toImg(e);
    if (this.pointers.size === 2 && this.selId) { const it = this.design.items.find(i => i.id === this.selId); const [a, b] = [...this.pointers.values()]; if (it && !it.pts) { this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: it.s, it }; this.drag = null; } return; }
    if (this.tool === 'horizon') { this.drag = { kind: 'horizon' }; this.setHorizon(p.y); return; }
    if (this.tool === 'area' || this.tool === 'curb') { if (this.draft.length > 2 && this.tool === 'area' && Math.hypot(p.x - this.draft[0].x, p.y - this.draft[0].y) < 20 / this.xf.s) { this.finishDraft(); return; } this.draft.push(p); this.draw(); return; }
    if (this.tool === 'sprite') { const it: PhotoItem = { id: uid(), kind: this.sprite, x: p.x, y: p.y, s: 1 }; store.mutate(() => this.design!.items.push(it)); this.selId = it.id; this.tool = 'select'; this.onChange(); this.draw(); return; }
    const it = this.hitItem(p); this.selId = it?.id || null; this.onChange();
    if (it) { store.begin(); this.drag = { kind: 'move', it, last: p }; }
    this.draw();
  }
  move(e: PointerEvent) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch) { const [a, b] = [...this.pointers.values()]; if (a && b) { this.pinch.it.s = Math.max(0.2, Math.min(6, this.pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.d)); this.draw(); } return; }
    if (!this.drag) return; const p = this.toImg(e);
    if (this.drag.kind === 'horizon') { this.setHorizon(p.y); return; }
    const it = this.drag.it as PhotoItem; const dx = p.x - this.drag.last.x, dy = p.y - this.drag.last.y; this.drag.last = p;
    if (it.pts) it.pts = it.pts.map(q => ({ x: q.x + dx, y: q.y + dy })); else { it.x += dx; it.y += dy; }
    this.draw();
  }
  up(e: PointerEvent) { this.pointers.delete(e.pointerId); if (this.pinch) { if (this.pointers.size < 2) { store.mutate(() => {}); this.pinch = null; } return; } if (this.drag?.kind === 'move') store.end(); if (this.drag?.kind === 'horizon') store.mutate(() => {}); this.drag = null; }
  setHorizon(y: number) { const d = this.design!; d.horizon = Math.max(0.02, Math.min(0.95, y / d.hpx)); this.draw(); }
  finishDraft() {
    if (!this.design) return; const need = this.tool === 'area' ? 3 : 2;
    if (this.draft.length >= need) { const it: PhotoItem = { id: uid(), kind: this.tool, x: 0, y: 0, s: 1, pts: this.draft, mat: this.tool === 'area' ? this.mat : 'curb' }; store.mutate(() => this.design!.items.push(it)); this.selId = it.id; }
    this.draft = []; this.tool = 'select'; this.onChange(); this.draw();
  }
  deleteSel() { if (!this.selId || !this.design) return; const id = this.selId; store.mutate(() => { this.design!.items = this.design!.items.filter(i => i.id !== id); }); this.selId = null; this.onChange(); this.draw(); }
  scaleSel(k: number) { const it = this.design?.items.find(i => i.id === this.selId); if (!it || it.pts) return; store.mutate(() => { it.s = Math.max(0.2, Math.min(6, it.s * k)); }); this.draw(); }
  flipSel() { const it = this.design?.items.find(i => i.id === this.selId); if (!it) return; store.mutate(() => { it.flip = !it.flip; }); this.draw(); }
  draw(target?: CanvasRenderingContext2D, exportScale?: number) {
    const c = target || this.ctx; const W = target ? c.canvas.width : this.canvas.width, H = target ? c.canvas.height : this.canvas.height;
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#1e1e1e'; c.fillRect(0, 0, W, H);
    if (!this.img || !this.design) { c.fillStyle = '#aaa'; c.font = `${16 * (devicePixelRatio || 1)}px system-ui`; c.textAlign = 'center'; c.fillText('Add a photo of the yard to start', W / 2, H / 2); return; }
    const xf = target ? { s: exportScale!, ox: 0, oy: 0 } : this.xf; const d = this.design;
    c.setTransform(xf.s, 0, 0, xf.s, xf.ox, xf.oy); c.drawImage(this.img, 0, 0);
    if (this.before) return;
    const hz = d.horizon * d.hpx; c.save(); c.beginPath(); c.rect(0, 0, d.wpx, d.hpx); c.clip();
    // areas first, then curbs, then sprites sorted by depth
    for (const it of d.items.filter(i => i.kind === 'area' && i.pts)) {
      const pts = it.pts!; let y0 = Infinity, y1 = -Infinity; for (const q of pts) { y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
      c.save(); c.beginPath(); pts.forEach((q, k) => k ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); c.closePath(); c.clip();
      const pc = patCanvas(it.mat || 'mulch'); const pat = c.createPattern(pc, 'repeat')!; const base = d.wpx / 1400;
      const step = Math.max(2, (y1 - y0) / 80);
      for (let y = Math.max(y0, hz); y < y1; y += step) { const k = Math.max(0.03, (y + step / 2 - hz) / (d.hpx - hz)) * base * 1.6; pat.setTransform(new DOMMatrix().translate(d.wpx / 2, hz).scale(k, k * 0.55)); c.fillStyle = pat; c.fillRect(0, y, d.wpx, step + 1); }
      // soft edge shading
      c.restore(); c.save(); c.beginPath(); pts.forEach((q, k) => k ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); c.closePath(); c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 2 / xf.s; c.stroke(); c.restore();
    }
    for (const it of d.items.filter(i => i.kind === 'curb' && i.pts)) {
      const pts = it.pts!; for (let k = 1; k < pts.length; k++) { const a = pts[k - 1], b = pts[k]; const wdt = 0.012 * d.hpx * this.depth((a.y + b.y) / 2) * 1.5;
        c.strokeStyle = '#d8d2c4'; c.lineWidth = wdt; c.lineCap = 'round'; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = wdt * 0.25; c.beginPath(); c.moveTo(a.x, a.y + wdt * 0.45); c.lineTo(b.x, b.y + wdt * 0.45); c.stroke(); }
    }
    const sprites = d.items.filter(i => !i.pts).sort((a, b) => a.y - b.y);
    for (const it of sprites) { const sp = PHOTO_SPRITES[it.kind]; if (!sp) continue; const h = this.spriteH(it);
      c.save(); c.translate(it.x, it.y); c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(0, 0, h * sp.ratio * 0.45, h * 0.06, 0, 0, 7); c.fill(); if (it.flip) c.scale(-1, 1); sp.draw(c, h); c.restore(); }
    c.restore(); if (target) return;
    // overlays
    c.setTransform(xf.s, 0, 0, xf.s, xf.ox, xf.oy); const px = 1 / xf.s;
    if (this.tool === 'horizon' || this.drag?.kind === 'horizon') { c.strokeStyle = '#ffd43b'; c.lineWidth = 2 * px; c.setLineDash([10 * px, 6 * px]); c.beginPath(); c.moveTo(0, hz); c.lineTo(d.wpx, hz); c.stroke(); c.setLineDash([]); }
    if (this.draft.length) { c.strokeStyle = '#ffd43b'; c.lineWidth = 3 * px; c.beginPath(); this.draft.forEach((q, k) => k ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); c.stroke(); for (const q of this.draft) { c.fillStyle = '#ffd43b'; c.beginPath(); c.arc(q.x, q.y, 6 * px, 0, 7); c.fill(); } }
    const sel = d.items.find(i => i.id === this.selId);
    if (sel) { c.strokeStyle = '#4dabf7'; c.lineWidth = 2 * px; c.setLineDash([6 * px, 4 * px]);
      if (sel.pts) { c.beginPath(); sel.pts.forEach((q, k) => k ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); if (sel.kind === 'area') c.closePath(); c.stroke(); }
      else { const h = this.spriteH(sel), w = h * (PHOTO_SPRITES[sel.kind]?.ratio || 1); c.strokeRect(sel.x - w / 2, sel.y - h, w, h); } c.setLineDash([]); }
  }
  async exportBlob(): Promise<Blob | null> {
    if (!this.img || !this.design) return null; const k = Math.min(1, 3000 / Math.max(this.design.wpx, this.design.hpx));
    const cv = document.createElement('canvas'); cv.width = Math.round(this.design.wpx * k); cv.height = Math.round(this.design.hpx * k);
    this.draw(cv.getContext('2d')!, k); return new Promise(r => cv.toBlob(b => r(b), 'image/jpeg', 0.92));
  }
}
function inPoly(p: { x: number; y: number }, pts: { x: number; y: number }[]) { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside; } return inside; }
function segD(p: any, a: any, b: any) { const dx = b.x - a.x, dy = b.y - a.y; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t); }
