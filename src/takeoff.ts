import { store, polyArea, polyPerimeter, wallLen, roomOutline, FLOORS, Project } from './model';
import { CAT_BY_KEY, OPENINGS } from './catalog';
import { FT } from './units';

export interface Line { key: string; label: string; qty: number; unit: 'sq ft' | 'lf' | 'ea'; price: number }
const SQFT = FT * FT;

export function takeoff(P: Project = store.p): { lines: Line[]; total: number; wallLf: number; floorSf: number; outdoorSf: number; curbLf: number } {
  const prices = (P as any).prices || {}; const lines: Line[] = [];
  const add = (key: string, label: string, qty: number, unit: Line['unit']) => { if (qty <= 0) return; const ex = lines.find(l => l.key === key); if (ex) ex.qty += qty; else lines.push({ key, label, qty, unit, price: +prices[key] || 0 }); };
  let wallLf = 0, wallSf = 0;
  for (const w of P.walls) { const L = wallLen(w); wallLf += L / FT; let a = L * w.height; for (const o of P.openings) if (o.wallId === w.id) a -= o.width * o.height; wallSf += a / SQFT; }
  add('walls', 'Wall framing (length)', wallLf, 'lf'); add('drywall', 'Wall surface, both sides (drywall/paint)', wallSf * 2, 'sq ft');
  let floorSf = 0, outdoorSf = 0, curbLf = 0;
  for (const r of P.rooms) {
    const ol = roomOutline(r); const A = polyArea(ol) / SQFT; const mat = FLOORS[r.floor]?.label || r.floor;
    if (r.outdoor) { outdoorSf += A; add('area:' + r.floor, `${mat} (outdoor)`, A, 'sq ft'); } else { floorSf += A; add('floor:' + r.floor, `${mat} flooring`, A, 'sq ft'); }
    if (r.curb) { const lf = polyPerimeter(ol) / FT; curbLf += lf; add('curb', 'Concrete curbing', lf, 'lf'); }
  }
  for (const o of P.openings) { const it = OPENINGS.find(x => x.style === (o.style || '') && x.kind === o.kind); const nm = (it?.name.replace(/\s*\d.*$/, '') || o.kind) + ` ${Math.round(o.width / 0.0254)}"x${Math.round(o.height / 0.0254)}"`; add('op:' + nm, nm, 1, 'ea'); }
  for (const o of P.objects) {
    const it = CAT_BY_KEY[o.kind]; const flat = it && it.shape === 'slab' && o.h < 0.15;
    if (flat) add('obj:' + o.kind, o.name, (o.w * o.d) / SQFT, 'sq ft');
    else if (it && ['fence', 'fenceRail', 'hedge'].includes(it.shape) || o.kind === 'hedge' || o.kind === 'seawall') add('obj:' + o.kind, o.name.replace(/\s*\d+'.*$/, ''), o.w / FT, 'lf');
    else add('obj:' + o.name, o.name, 1, 'ea');
  }
  for (const l of lines) l.qty = Math.round(l.qty * 10) / 10;
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0) * (1 + (+((P as any).markup) || 0) / 100);
  return { lines, total, wallLf, floorSf, outdoorSf, curbLf };
}
export const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
