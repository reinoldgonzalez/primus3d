import { FT, IN, UnitSystem, setUnits } from './units';
import { CAT_BY_KEY } from './catalog';

export interface Pt { x: number; y: number }
export interface V3 { x: number; y: number; z: number }
export interface Wall { id: string; a: Pt; b: Pt; thickness: number; height: number; color: string }
export type OpeningKind = 'door' | 'window' | 'opening' | 'slider';
export interface Opening { id: string; kind: OpeningKind; style?: string; wallId: string; t: number; width: number; height: number; sill: number; flip: boolean; hingeRight: boolean }
export interface Room { id: string; name: string; pts: Pt[]; floor: string; ceilingHeight: number; showCeiling: boolean; outdoor?: boolean; smooth?: boolean; curb?: boolean; thickness?: number }
export interface Obj { id: string; kind: string; name: string; x: number; y: number; w: number; d: number; h: number; elev: number; rot: number; color: string; finish?: string }
export interface Measure { id: string; a: V3; b: V3 }
export interface Background { assetId: string; x: number; y: number; mpp: number; rot: number; opacity: number; wpx: number; hpx: number; locked: boolean; visible: boolean; name: string }
export interface ScanRef { assetId: string; name: string; format: string; scale: number; x: number; y: number; z: number; rotY: number; visible: boolean; opacity: number; cutHeight: number; showInPlan: boolean; calibrated: boolean; upZ: boolean; source: string }
export interface PhotoItem { id: string; kind: string; x: number; y: number; s: number; flip?: boolean; pts?: { x: number; y: number }[]; mat?: string }
export interface PhotoDesign { id: string; assetId: string; name: string; wpx: number; hpx: number; horizon: number; items: PhotoItem[] }
export interface Defaults { wallHeight: number; wallThickness: number; doorW: number; doorH: number; winW: number; winH: number; sill: number; ceiling: number }
export interface Project {
  id: string; name: string; client: string; address: string; notes: string; units: UnitSystem;
  walls: Wall[]; openings: Opening[]; rooms: Room[]; objects: Obj[]; measures: Measure[];
  background: Background | null; scan: ScanRef | null; defaults: Defaults; prices: Record<string, number>; markup: number; photos: PhotoDesign[]; created: number; updated: number; version: number;
  lot?: Pt[] | null; geo?: { lat: number; lon: number; address: string; parcel?: string; source?: string } | null;
  lineCfg?: Record<string, { waste?: number; markup?: number }>; tcfg?: Partial<TakeoffCfg>; options?: ProposalOption[];
  setbacks?: { front: number; side: number; rear: number; pool: number } | null; northDeg?: number;
}
export interface TakeoffCfg { palletSf: number; baseIn: number; sandIn: number; baseTonsPerYd: number; slabIn: number; mulchIn: number; rockIn: number; soilIn: number; sodWaste: number; paverWaste: number }
export const TCFG_DEFAULTS: TakeoffCfg = { palletSf: 450, baseIn: 4, sandIn: 1, baseTonsPerYd: 1.4, slabIn: 4, mulchIn: 3, rockIn: 2, soilIn: 4, sodWaste: 5, paverWaste: 5 };
export interface ProposalOption { name: string; desc: string; factor: number; price?: number | null }
export const DEFAULT_OPTIONS: ProposalOption[] = [
  { name: 'Good', desc: 'Standard materials, as drawn.', factor: 1 },
  { name: 'Better', desc: 'Upgraded materials and finishes.', factor: 1.15 },
  { name: 'Best', desc: 'Premium materials, extended warranty.', factor: 1.3 },
];
export type SelKind = 'wall' | 'opening' | 'room' | 'object' | 'measure' | 'background' | 'scan' | 'joint';
export interface Selection { kind: SelKind; id: string; pt?: Pt }

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function defaultDefaults(): Defaults {
  return { wallHeight: 9 * FT, wallThickness: 4.5 * IN, doorW: 32 * IN, doorH: 80 * IN, winW: 36 * IN, winH: 48 * IN, sill: 36 * IN, ceiling: 9 * FT };
}
export function newProject(name = 'Untitled project'): Project {
  const now = Date.now();
  return { id: uid(), name, client: '', address: '', notes: '', units: 'imperial', walls: [], openings: [], rooms: [], objects: [], measures: [], background: null, scan: null, defaults: defaultDefaults(), prices: {}, markup: 0, photos: [], created: now, updated: now, version: 1 };
}

export const FLOORS: Record<string, { label: string; color: string }> = {
  tile: { label: 'Tile', color: '#d9d4c7' },
  wood: { label: 'Wood', color: '#b98a5a' },
  lvp: { label: 'Vinyl plank', color: '#a88f74' },
  carpet: { label: 'Carpet', color: '#8f8a84' },
  concrete: { label: 'Concrete', color: '#a5a5a0' },
  pavers: { label: 'Pavers', color: '#c19a7a' },
  grass: { label: 'Grass / sod', color: '#6e9b4f' },
  pool: { label: 'Pool water', color: '#4fa3d1' },
  mulch: { label: 'Mulch', color: '#6b4a32' },
  rock: { label: 'Rock', color: '#c8c3b8' },
  marble: { label: 'Marble', color: '#ece9e4' },
  darkwood: { label: 'Dark wood', color: '#6b4a32' },
  graytile: { label: 'Gray tile', color: '#9a9a96' },
  soil: { label: 'Topsoil / fill', color: '#5a4636' },
  travertine: { label: 'Travertine', color: '#e3d5bd' },
  stamped: { label: 'Stamped concrete', color: '#a98f7a' },
};

export const OBJECT_PRESETS = CAT_BY_KEY;
export const FLOOR_EXTRA = 0;

type Listener = (what: string) => void;

class Store {
  p: Project = newProject();
  sel: Selection | null = null;
  assets = new Map<string, Blob>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners: Listener[] = [];
  private pending: string | null = null;
  dirty = false;
  /** customer view-only link: every edit is rolled back */
  readOnly = false;

  on(fn: Listener) { this.listeners.push(fn); }
  emit(what = 'change') { for (const l of this.listeners) l(what); }

  load(p: Project) {
    this.p = migrate(p); this.sel = null; this.undoStack = []; this.redoStack = [];
    setUnits(this.p.units); this.emit('load');
  }
  /** One-shot mutation with undo. */
  mutate(fn: (p: Project) => void, what = 'change') {
    if (this.readOnly) return;
    const before = JSON.stringify(this.p);
    fn(this.p);
    this.pushUndo(before); this.emit(what);
  }
  /** For continuous drags: begin() then live edits + emit, then end(). */
  begin() { if (this.pending == null) this.pending = JSON.stringify(this.p); }
  end() {
    if (this.pending == null) return;
    const before = this.pending; this.pending = null;
    if (this.readOnly) { this.p = JSON.parse(before); this.emit('change'); return; }
    if (before !== JSON.stringify(this.p)) this.pushUndo(before);
    this.emit('change');
  }
  private pushUndo(before: string) {
    this.undoStack.push(before); if (this.undoStack.length > 150) this.undoStack.shift();
    this.redoStack = []; this.p.updated = Date.now(); this.dirty = true;
  }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  undo() { const s = this.undoStack.pop(); if (!s) return; this.redoStack.push(JSON.stringify(this.p)); this.p = JSON.parse(s); this.validateSel(); setUnits(this.p.units); this.dirty = true; this.emit('change'); }
  redo() { const s = this.redoStack.pop(); if (!s) return; this.undoStack.push(JSON.stringify(this.p)); this.p = JSON.parse(s); this.validateSel(); setUnits(this.p.units); this.dirty = true; this.emit('change'); }
  select(s: Selection | null) { this.sel = s; this.emit('select'); }
  validateSel() { if (this.sel && !findSel(this.p, this.sel)) this.sel = null; }

  wall(id: string) { return this.p.walls.find(w => w.id === id); }
}
export const store = new Store();

export function findSel(p: Project, s: Selection): any {
  switch (s.kind) {
    case 'wall': return p.walls.find(w => w.id === s.id);
    case 'opening': return p.openings.find(w => w.id === s.id);
    case 'room': return p.rooms.find(w => w.id === s.id);
    case 'object': return p.objects.find(w => w.id === s.id);
    case 'measure': return p.measures.find(w => w.id === s.id);
    case 'background': return p.background;
    case 'scan': return p.scan;
    case 'joint': return p.walls.find(w => w.id === s.id);
  }
}

export function migrate(p: any): Project {
  const base = newProject();
  const out = { ...base, ...p };
  out.defaults = { ...base.defaults, ...(p.defaults || {}) };
  if (!out.prices) out.prices = {}; if (out.markup == null) out.markup = 0; if (!out.lineCfg) out.lineCfg = {}; if (out.lot === undefined) out.lot = null;
  for (const k of ['walls', 'openings', 'rooms', 'objects', 'measures', 'photos']) if (!Array.isArray(out[k])) out[k] = [];
  return out as Project;
}

// ---- geometry helpers ----
export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
export const wallLen = (w: Wall) => dist(w.a, w.b);
export const wallAngle = (w: Wall) => Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
export function wallDir(w: Wall): Pt { const L = wallLen(w) || 1; return { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L }; }
export function pointOnWall(w: Wall, t: number): Pt { const d = wallDir(w); return { x: w.a.x + d.x * t, y: w.a.y + d.y * t }; }
export function projectOnSeg(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y; const L2 = dx * dx + dy * dy || 1e-9;
  let u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2; const uc = Math.max(0, Math.min(1, u));
  const q = { x: a.x + dx * uc, y: a.y + dy * uc };
  return { u, uc, q, d: dist(p, q), t: uc * Math.sqrt(L2) };
}
export function polyArea(pts: Pt[]) { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2; }
export function polyCentroid(pts: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; const f = p.x * q.y - q.x * p.y; a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f; }
  if (Math.abs(a) < 1e-9) { const n = pts.length || 1; return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n }; }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}
export function pointInPoly(p: Pt, pts: Pt[]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function polyPerimeter(pts: Pt[]) { let s = 0; for (let i = 0; i < pts.length; i++) s += dist(pts[i], pts[(i + 1) % pts.length]); return s; }
export function objCorners(o: Obj): Pt[] {
  const c = Math.cos(o.rot), s = Math.sin(o.rot); const hw = o.w / 2, hd = o.d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => ({ x: o.x + x * c - y * s, y: o.y + x * s + y * c }));
}
/** Openings on a wall, clamped. */
export function wallOpenings(p: Project, w: Wall) { return p.openings.filter(o => o.wallId === w.id).sort((a, b) => a.t - b.t); }

/** Room/area outline; smooth=true turns corner points into a closed Catmull-Rom curve (beds, paths, kidney shapes). */
export function roomOutline(r: Room): Pt[] {
  const P = r.pts; if (!r.smooth || P.length < 3) return P;
  const out: Pt[] = []; const n = P.length; const seg = 10;
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    for (let k = 0; k < seg; k++) { const t = k / seg, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) }); }
  }
  return out;
}
