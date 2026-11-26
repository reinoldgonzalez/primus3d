import { store, polyArea, polyPerimeter, wallLen, roomOutline, FLOORS, Project, TCFG_DEFAULTS, TakeoffCfg, DEFAULT_OPTIONS } from './model';
import { CAT_BY_KEY, OPENINGS } from './catalog';
import { FT, IN } from './units';

export type Unit = 'sq ft' | 'lf' | 'ea' | 'cu yd' | 'tons' | 'pallets';
export interface Line { key: string; label: string; qty: number; unit: Unit; price: number; waste: number; markup: number; note: string; total: number }
const SQFT = FT * FT;
const CUYD = 27; // cu ft per cu yd

export function cfg(P: Project = store.p): TakeoffCfg { return { ...TCFG_DEFAULTS, ...(P.tcfg || {}) }; }
const DEFAULT_WASTE: Record<string, number> = { pavers: 5, travertine: 7, tile: 10, graytile: 10, marble: 10, wood: 8, darkwood: 8, lvp: 7, carpet: 10, sod: 5 };

/** Quantities straight from the drawing + the user's own unit prices. No invented prices: everything defaults to $0. */
export function takeoff(P: Project = store.p) {
  const prices = P.prices || {}; const lc = P.lineCfg || {}; const C = cfg(P); const lines: Line[] = []; const gm = +P.markup || 0;
  const add = (key: string, label: string, qty: number, unit: Unit, note = '', waste0 = 0) => {
    if (!(qty > 0)) return; const ex = lines.find(l => l.key === key);
    if (ex) { ex.qty += qty; return ex; }
    const l: Line = { key, label, qty, unit, price: +prices[key] || 0, waste: lc[key]?.waste ?? waste0, markup: lc[key]?.markup ?? gm, note, total: 0 }; lines.push(l); return l;
  };
  const cy = (sf: number, inches: number) => sf * inches / 12 / CUYD;
  let wallLf = 0, wallSf = 0;
  for (const w of P.walls) { const L = wallLen(w); wallLf += L / FT; let a = L * w.height; for (const o of P.openings) if (o.wallId === w.id) a -= o.width * o.height; wallSf += a / SQFT; }
  add('walls', 'Wall framing (length)', wallLf, 'lf'); add('drywall', 'Wall surface, both sides (drywall/paint)', wallSf * 2, 'sq ft');
  let floorSf = 0, outdoorSf = 0, curbLf = 0, imperviousSf = 0;
  const hardscape = (mat: string, A: number, perim: number, label: string) => {
    if (mat === 'grass') { add('sod', 'Sod (St. Augustine/Floratam)', A, 'sq ft', '', DEFAULT_WASTE.sod); return; }
    if (mat === 'pavers' || mat === 'travertine') {
      add('area:' + mat, label, A, 'sq ft', '', DEFAULT_WASTE[mat]); imperviousSf += A;
      add('paverbase', `Paver base (${C.baseIn}" compacted)`, cy(A, C.baseIn) * C.baseTonsPerYd, 'tons');
      add('paversand', `Bedding sand (${C.sandIn}")`, cy(A, C.sandIn), 'cu yd');
      add('edge', 'Paver edge restraint', perim, 'lf'); return;
    }
    if (mat === 'concrete' || mat === 'stamped') { add('area:' + mat, label, A, 'sq ft'); add('concrete', `Concrete (${C.slabIn}" slab)`, cy(A, C.slabIn), 'cu yd', '', 5); imperviousSf += A; return; }
    if (mat === 'mulch') { add('mulch', `Mulch (${C.mulchIn}" deep)`, cy(A, C.mulchIn), 'cu yd', '', 5); return; }
    if (mat === 'rock') { add('rock', `Landscape rock (${C.rockIn}" deep)`, cy(A, C.rockIn), 'cu yd', '', 5); return; }
    if (mat === 'soil') { add('soil', `Topsoil / fill (${C.soilIn}" deep)`, cy(A, C.soilIn), 'cu yd', '', 10); return; }
    if (mat === 'pool') { add('area:pool', 'Pool surface area', A, 'sq ft'); imperviousSf += A; return; }
    add('area:' + mat, label, A, 'sq ft', '', DEFAULT_WASTE[mat] || 0); imperviousSf += A;
  };
  // pool, spa and equipment pad sit IN the deck: the deck is bought for what is left
  const inPoly = (p: { x: number; y: number }, L: { x: number; y: number }[]) => { let c = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) { const a = L[i], b = L[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
  const cutters = P.objects.filter(o => /^(pool|spa|pad$|slab$)/.test(o.kind));
  let wallFoot = 0; for (const w of P.walls) wallFoot += wallLen(w) * w.thickness / SQFT;
  for (const r of P.rooms) {
    const ol = roomOutline(r); let A = polyArea(ol) / SQFT; if (r.outdoor) for (const o of cutters) if (inPoly(o, ol)) A = Math.max(0, A - (o.w * o.d) / SQFT); const per = polyPerimeter(ol) / FT; const mat = FLOORS[r.floor]?.label || r.floor;
    if (r.outdoor) { outdoorSf += A; hardscape(r.floor, A, per, `${mat} (outdoor)`); }
    else { floorSf += A; add('floor:' + r.floor, `${mat} flooring`, A, 'sq ft', '', DEFAULT_WASTE[r.floor] || 0); }
    if (r.curb) { curbLf += per; add('curb', 'Concrete curbing', per, 'lf'); }
  }
  for (const o of P.openings) { const it = OPENINGS.find(x => x.style === (o.style || '') && x.kind === o.kind); const nm = (it?.name.replace(/\s*\d.*$/, '') || o.kind) + ` ${Math.round(o.width / IN)}"x${Math.round(o.height / IN)}"`; add('op:' + nm, nm, 1, 'ea'); }
  for (const o of P.objects) {
    const it = CAT_BY_KEY[o.kind]; const A = (o.w * o.d) / SQFT; const per = 2 * (o.w + o.d) / FT;
    if (o.kind === 'sod') hardscape('grass', A, per, 'Sod');
    else if (o.kind === 'pavers' || o.kind === 'walkway') hardscape('pavers', A, per, 'Pavers');
    else if (o.kind === 'slab' || o.kind === 'driveway' || o.kind === 'pad') hardscape('concrete', A, per, 'Concrete flatwork');
    else if (o.kind === 'mulch') hardscape('mulch', A, per, 'Mulch');
    else if (o.kind === 'rock') hardscape('rock', A, per, 'Rock');
    else if (o.kind === 'cage') { add('cage-lf', 'Screen cage perimeter', per, 'lf'); add('cage-sf', 'Screen cage area (walls + roof)', (per * FT * o.h + o.w * o.d) / SQFT, 'sq ft'); imperviousSf += 0; }
    else if (it && it.shape === 'slab' && o.h < 0.15) { add('obj:' + o.kind, o.name, A, 'sq ft'); imperviousSf += A; }
    else if (it && ['fence', 'fenceRail', 'hedge'].includes(it.shape) || o.kind === 'hedge' || o.kind === 'seawall') add('obj:' + o.kind, o.name.replace(/\s*\d+'.*$/, ''), o.w / FT, 'lf');
    else { add('obj:' + o.name, o.name, 1, 'ea'); if (/^(pool|spa)/.test(o.kind)) imperviousSf += A;
      if (/^pool/.test(o.kind)) { const q: any = o; const k = q.shape === 'free' || (!q.shape && o.kind !== 'pool-rect') ? 0.85 : q.shape === 'kidney' ? 0.8 : q.shape === 'L' ? 0.75 : 1; const Lf = o.w / FT, Wf = o.d / FT; const avg = ((q.depth1 ?? 3.5 * FT) + (q.depth2 ?? 6 * FT)) / 2 / FT; const sf = Lf * Wf * k;
        const ex = add('poolexc', 'Pool excavation (1 ft over-dig)', ((Lf + 2) * (Wf + 2) * k * (avg + 1)) / 27 + (q.spa ? 3 : 0), 'cu yd'); if (ex) ex.note = `≈ ${Math.round(sf * avg * 7.48 + (q.spa ? 600 : 0)).toLocaleString()} gallons`;
        add('poolint', 'Pool interior finish (floor + walls)', sf + 2 * (Lf + Wf) * k * avg, 'sq ft'); add('poolcoping', 'Pool coping', 2 * (Lf + Wf) * Math.sqrt(k), 'lf'); if (q.steps) add('poolsteps', 'Pool step sets', q.steps, 'ea'); if (q.spa) add('spa', 'Attached spa', 1, 'ea'); } }
  }
  // building footprint = rooms + the walls themselves (outside face); with no rooms drawn, the area inside the walls
  let foot = floorSf + wallFoot; if (!floorSf && P.walls.length) foot = wallFoot; imperviousSf += foot;
  // sod is bought by the pallet
  const sod = lines.find(l => l.key === 'sod'); if (sod) { const pallets = Math.ceil(sod.qty * (1 + sod.waste / 100) / C.palletSf); sod.note = `${Math.round(sod.qty)} sq ft + ${sod.waste}% waste ÷ ${C.palletSf} sq ft/pallet`; sod.key = 'sod'; sod.label = 'Sod pallets'; sod.unit = 'pallets'; sod.qty = pallets; sod.waste = 0; }
  for (const l of lines) {
    if (l.unit === 'cu yd' || l.unit === 'tons') l.qty = Math.round(l.qty * 100) / 100; else l.qty = Math.round(l.qty * 10) / 10;
    if (l.waste && !l.note) l.note = `+${l.waste}% waste → ${Math.round(l.qty * (1 + l.waste / 100) * 10) / 10} ${l.unit}`;
    l.total = l.qty * (1 + l.waste / 100) * l.price * (1 + l.markup / 100);
  }
  const total = lines.reduce((s, l) => s + l.total, 0);
  return { lines, total, wallLf, floorSf, outdoorSf, curbLf, imperviousSf, footprintSf: foot };
}
export function options(P: Project = store.p) { return (P.options && P.options.length ? P.options : DEFAULT_OPTIONS); }
export function optionPrice(o: { factor: number; price?: number | null }, base: number) { return o.price != null && o.price > 0 ? o.price : base * (o.factor || 1); }
export const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// ---- saved price lists (shared across projects on this device) ----
const PL = 'p3d-pricelists';
export function priceLists(): Record<string, { prices: Record<string, number>; lineCfg: Record<string, any>; markup: number }> { try { return JSON.parse(localStorage.getItem(PL) || '{}'); } catch { return {}; } }
export function savePriceList(name: string, P: Project) { const all = priceLists(); all[name] = { prices: { ...P.prices }, lineCfg: { ...(P.lineCfg || {}) }, markup: P.markup }; localStorage.setItem(PL, JSON.stringify(all)); }
export function deletePriceList(name: string) { const all = priceLists(); delete all[name]; localStorage.setItem(PL, JSON.stringify(all)); }
