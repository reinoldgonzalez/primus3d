import { store, objCorners, polyArea, polyPerimeter, wallLen, roomOutline } from './model';
import { drawPlan, ViewXf, Underlay } from './plan';
import { fmtLen, fmtArea, getUnits } from './units';

function bounds(underlay: Underlay | null) {
  const P = store.p; const pts: { x: number; y: number }[] = [];
  P.walls.forEach(w => pts.push(w.a, w.b)); P.rooms.forEach(r => pts.push(...r.pts)); P.objects.forEach(o => pts.push(...objCorners(o))); P.measures.forEach(m => pts.push({ x: m.a.x, y: m.a.z }, { x: m.b.x, y: m.b.z }));
  if (!pts.length && P.background) { const b = P.background; pts.push({ x: b.x, y: b.y }, { x: b.x + b.wpx * b.mpp, y: b.y + b.hpx * b.mpp }); }
  if (!pts.length && underlay) pts.push({ x: underlay.x, y: underlay.y }, { x: underlay.x + underlay.w, y: underlay.y + underlay.h });
  if (!pts.length) pts.push({ x: 0, y: 0 }, { x: 5, y: 5 });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  return { x0, y0, x1, y1 };
}

/** Render the plan to a canvas at given pixel size with dimensions; returns canvas. */
export function renderPlanCanvas(W: number, H: number, opts: { withBackground: boolean; underlay: Underlay | null }) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d')!;
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
  const b = bounds(opts.underlay); const bw = Math.max(b.x1 - b.x0, 0.5), bh = Math.max(b.y1 - b.y0, 0.5);
  const margin = 80; const scale = Math.min((W - margin * 2) / bw, (H - margin * 2) / bh);
  const v: ViewXf = { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale };
  drawPlan(c, store.p, v, W, H, { grid: false, dims: true, sel: null, underlay: opts.withBackground ? opts.underlay : null, handles: false, print: true, bg: opts.withBackground });
  return { canvas: cv, scale };
}

export async function exportPNG(underlay: Underlay | null, withBackground: boolean) {
  const { canvas } = renderPlanCanvas(2400, 1700, { withBackground, underlay });
  const c = canvas.getContext('2d')!; const P = store.p;
  c.fillStyle = '#111'; c.font = '700 34px system-ui, sans-serif'; c.fillText(P.name, 40, 52);
  c.font = '400 20px system-ui, sans-serif'; c.fillStyle = '#555'; c.fillText([P.client, P.address, new Date().toLocaleDateString()].filter(Boolean).join('  ·  '), 40, 84);
  c.font = '600 18px system-ui, sans-serif'; c.fillText('Primus 3D', canvas.width - 140, canvas.height - 24);
  return new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/png'));
}

export async function exportPDF(underlay: Underlay | null, withBackground: boolean, shot3d?: string) {
  const { jsPDF } = await import('jspdf');
  const P = store.p; const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight();
  const { canvas } = renderPlanCanvas(3000, 2000, { withBackground, underlay });
  // title block
  { const B = getBiz(); doc.setFillColor(31, 41, 51); doc.rect(0, 0, PW, 6, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(232, 89, 12); doc.text((B.name || 'Primus').toUpperCase(), PW - 36, 34, { align: 'right' }); doc.setTextColor(120); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text([B.tagline, B.phone, B.email].filter(Boolean).join('  ·  '), PW - 36, 46, { align: 'right' }); doc.setTextColor(0); }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(P.name || 'Floor plan', 36, 40);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90);
  doc.text([P.client && `Client: ${P.client}`, P.address && `Address: ${P.address}`, `Date: ${new Date().toLocaleDateString()}`].filter(Boolean).join('     '), 36, 58);
  doc.setTextColor(0);
  const imgW = PW - 72, imgH = imgW * 2000 / 3000; const h = Math.min(imgH, PH - 120); const w = h * 3000 / 2000;
  doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 36 + (imgW - w) / 2, 70, w, h);
  doc.setFontSize(8); doc.setTextColor(120);
  doc.text('Prepared with Primus 3D. Dimensions are wall centerline lengths. Verify all measurements on site before ordering materials or building.', 36, PH - 24);
  // page 2: schedule
  doc.addPage(); doc.setTextColor(0); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('Room & opening schedule', 36, 40);
  doc.setFontSize(10); let y = 70; doc.text('Room', 36, y); doc.text('Area', 220, y); doc.text('Perimeter', 320, y); doc.text('Ceiling', 430, y); doc.text('Floor', 520, y); doc.setFont('helvetica', 'normal');
  let total = 0;
  for (const r of P.rooms) { y += 16; const A = polyArea(r.pts); total += A; doc.text(r.name, 36, y); doc.text(fmtArea(A), 220, y); doc.text(fmtLen(polyPerimeter(r.pts), { short: true }), 320, y); doc.text(fmtLen(r.ceilingHeight, { short: true }), 430, y); doc.text(r.floor, 520, y); if (y > PH - 60) { doc.addPage(); y = 40; } }
  if (P.rooms.length) { y += 18; doc.setFont('helvetica', 'bold'); doc.text(`Total: ${fmtArea(total)}`, 36, y); doc.setFont('helvetica', 'normal'); }
  y += 30; doc.setFont('helvetica', 'bold'); doc.text('Openings', 36, y); doc.setFont('helvetica', 'normal');
  const cnt: Record<string, number> = {};
  for (const o of P.openings) { const k = `${o.kind} ${fmtLen(o.width, { short: true })} x ${fmtLen(o.height, { short: true })}${o.kind === 'window' ? ' sill ' + fmtLen(o.sill, { short: true }) : ''}`; cnt[k] = (cnt[k] || 0) + 1; }
  for (const [k, n] of Object.entries(cnt)) { y += 16; doc.text(`${n} x ${k}`, 36, y); if (y > PH - 60) { doc.addPage(); y = 40; } }
  const wallTotal = P.walls.reduce((s, w) => s + wallLen(w), 0);
  y += 26; doc.text(`Walls: ${P.walls.length}  ·  total length ${fmtLen(wallTotal, { short: true })}  ·  units ${getUnits()}`, 36, y);
  if (P.notes) { y += 26; doc.setFont('helvetica', 'bold'); doc.text('Notes', 36, y); doc.setFont('helvetica', 'normal'); doc.text(doc.splitTextToSize(P.notes, PW - 72), 36, y + 16); }
  // estimate + good/better/best + approval
  { const T = takeoff(); const priced = T.lines.filter(l => l.price > 0); doc.addPage(); const B = getBiz(); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('Estimate & options', 36, 40); doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.text(`${B.name}${B.phone ? '  ·  ' + B.phone : ''}${B.email ? '  ·  ' + B.email : ''}`, PW - 36, 40, { align: 'right' });
    let y = 66; doc.setFont('helvetica', 'bold'); doc.text('Item', 36, y); doc.text('Quantity', 360, y); doc.text('Amount', PW - 36, y, { align: 'right' }); doc.setFont('helvetica', 'normal');
    for (const l of (priced.length ? priced : T.lines)) { y += 14; if (y > PH - 160) { doc.addPage(); y = 50; } doc.text(l.label, 36, y); doc.text(`${l.qty} ${l.unit}${l.waste ? ` (+${l.waste}% waste)` : ''}`, 360, y); doc.text(l.price ? money(l.total) : '—', PW - 36, y, { align: 'right' }); }
    y += 20; doc.setFont('helvetica', 'bold'); doc.text('Estimated total', 36, y); doc.text(money(T.total), PW - 36, y, { align: 'right' });
    y += 30; doc.setFontSize(12); doc.text('Choose your option', 36, y); doc.setFontSize(10);
    for (const o of options(P)) { y += 22; doc.rect(36, y - 9, 10, 10); doc.setFont('helvetica', 'bold'); doc.text(`${o.name} — ${money(optionPrice(o, T.total))}`, 54, y); doc.setFont('helvetica', 'normal'); doc.text(o.desc || '', 260, y); }
    y += 40; doc.line(36, y, 300, y); doc.line(340, y, 520, y); doc.setFontSize(8); doc.text('Customer approval (signature)', 36, y + 11); doc.text('Date', 340, y + 11);
    doc.text('Prices valid 30 days. Final price confirmed after site verification. No payment is collected by this document.', 36, PH - 24); }
  if (shot3d) { doc.addPage(); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('3D view', 36, 40); const im = await loadImg(shot3d); const k = Math.min((PW - 72) / im.width, (PH - 90) / im.height); doc.addImage(shot3d, 'PNG', 36, 56, im.width * k, im.height * k); }
  return doc.output('blob');
}
function loadImg(src: string): Promise<HTMLImageElement> { return new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; }); }

export function download(blob: Blob, name: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
/** On phones prefer the share sheet (iOS can't "download" well). */
export async function shareOrDownload(blob: Blob, name: string) {
  const file = new File([blob], name, { type: blob.type });
  const nav: any = navigator;
  if (nav.canShare && nav.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    try { await nav.share({ files: [file], title: name }); return; } catch (e: any) { if (e?.name === 'AbortError') return; }
  }
  download(blob, name);
}

// ================= Permit sheets (site plan, pool plan, pool barrier) =================
import { setbacks, edgeName, lotArea, setbackIssues } from './site';
/** jsPDF's built-in fonts only have Latin-1/WinAnsi: swap the symbols the app uses for plain text. */
const pdfSafe = (t: any): any => Array.isArray(t) ? t.map(pdfSafe) : typeof t !== 'string' ? t : t.replace(/→/g, '->').replace(/✓/g, 'OK').replace(/[⚠️]/g, '!').replace(/×/g, 'x').replace(/[≥]/g, '>=').replace(/[≤]/g, '<=').replace(/[^\x00-\xff–—‘’“”•…]/g, '');
import { takeoff, options, optionPrice, money } from './takeoff';
import { getBiz } from './share';
const FTm = 0.3048;
type Box = { x0: number; y0: number; x1: number; y1: number };
function boxOf(pts: { x: number; y: number }[], pad = 0): Box { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); } return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad }; }
/** Draw a region at an exact engineering scale (feet per inch) so the printed sheet measures true at 100%. */
function scaledCanvas(b: Box, wIn: number, hIn: number, dpi = 150, scales = [5, 10, 20, 30, 40, 50, 60, 80, 100, 200]) {
  const wM = b.x1 - b.x0, hM = b.y1 - b.y0; const ftPerIn = scales.find(s => wM <= wIn * s * FTm && hM <= hIn * s * FTm) || scales[scales.length - 1];
  const cv = document.createElement('canvas'); cv.width = Math.round(wIn * dpi); cv.height = Math.round(hIn * dpi); const c = cv.getContext('2d')!; c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
  const pxPerM = dpi / (ftPerIn * FTm); const v: ViewXf = { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale: pxPerM };
  drawPlan(c, store.p, v, cv.width, cv.height, { grid: false, dims: true, sel: null, underlay: null, handles: false, print: true, bg: false });
  return { cv, ftPerIn, v, c, dpi };
}
function northArrow(doc: any, x: number, y: number, deg = 0) {
  const r = 16; const a = (deg - 90) * Math.PI / 180; const tip = { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r }, l = { x: x + Math.cos(a + 2.6) * r * 0.7, y: y + Math.sin(a + 2.6) * r * 0.7 }, rr = { x: x + Math.cos(a - 2.6) * r * 0.7, y: y + Math.sin(a - 2.6) * r * 0.7 };
  doc.setFillColor(0); doc.triangle(tip.x, tip.y, l.x, l.y, x, y, 'F'); doc.setDrawColor(0); doc.triangle(tip.x, tip.y, rr.x, rr.y, x, y, 'S'); doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.text('N', tip.x - 3, tip.y - 4);
}
function scaleBar(doc: any, x: number, y: number, ftPerIn: number) { // 72 pt per inch
  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); const segFt = ftPerIn; for (let i = 0; i < 4; i++) { doc.setFillColor(i % 2 ? 255 : 0); doc.rect(x + i * 36, y, 36, 5, 'FD'); doc.text(String(i * segFt / 2), x + i * 36 - 2, y + 13); } doc.text(String(2 * segFt) + ' ft', x + 144 - 4, y + 13);
}
function titleBlock(doc: any, PW: number, PH: number, sheet: string, num: string, ftPerIn: number) {
  const P = store.p; const B = getBiz(); const x = PW - 200, w = 180; doc.setDrawColor(0); doc.setLineWidth(1); doc.rect(x, 20, w, PH - 40);
  let y = 40; doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(B.name || 'Primus', x + 10, y); y += 13; doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  for (const t of [B.tagline, B.phone, B.email, B.license && 'Lic. ' + B.license]) if (t) { doc.text(String(t), x + 10, y); y += 11; }
  doc.line(x, y, x + w, y); y += 16; doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(doc.splitTextToSize(P.name || 'Project', w - 20), x + 10, y); y += 14;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  for (const t of [P.client && 'Owner: ' + P.client, P.address && 'Site: ' + P.address, P.geo?.parcel && 'Parcel: ' + P.geo.parcel]) if (t) { const L = doc.splitTextToSize(t, w - 20); doc.text(L, x + 10, y); y += 11 * L.length; }
  const yb = PH - 150; doc.line(x, yb, x + w, yb); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(sheet, x + 10, yb + 20);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(ftPerIn ? `Scale: 1" = ${ftPerIn}'-0"` : 'Scale: as noted', x + 10, yb + 36); doc.text(ftPerIn ? '(when printed at 100% on 11x17)' : '(key plan scale shown under it)', x + 10, yb + 47); doc.text('Date: ' + new Date().toLocaleDateString(), x + 10, yb + 62);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.text(num, x + w - 50, PH - 40);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.text(doc.splitTextToSize('Prepared with Primus 3D. Lot lines from public parcel data are approximate; verify against a signed survey. Contractor to verify all dimensions and code requirements with the local building department.', w - 20), x + 10, PH - 80);
  return x;
}
export async function exportPermitPDF() {
  const { jsPDF } = await import('jspdf'); const P = store.p; const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'tabloid' }); const t0 = doc.text.bind(doc); (doc as any).text = (t: any, ...a: any[]) => t0(pdfSafe(t), ...a);
  const PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight(); const drawW = (PW - 200 - 50) / 72, drawH = (PH - 40 - 30) / 72;
  const all: { x: number; y: number }[] = [...(P.lot || [])]; P.walls.forEach(w => all.push(w.a, w.b)); P.rooms.forEach(r => all.push(...r.pts)); P.objects.forEach(o => all.push(...objCorners(o)));
  if (!all.length) all.push({ x: 0, y: 0 }, { x: 10, y: 10 });
  const T = takeoff(); const SQ = FTm * FTm;
  // ---- C-1 site plan ----
  { const s = scaledCanvas(boxOf(all, 3), drawW, drawH); doc.addImage(s.cv.toDataURL('image/jpeg', 0.9), 'JPEG', 25, 20, drawW * 72, drawH * 72);
    titleBlock(doc, PW, PH, 'SITE PLAN', 'C-1', s.ftPerIn); northArrow(doc, 60, 60, P.northDeg || 0); scaleBar(doc, 40, PH - 40, s.ftPerIn);
    // impervious & setback table
    const lotA = P.lot && P.lot.length > 2 ? lotArea(P.lot) / SQ : 0; const rows: [string, string][] = []; const FL: any = (P as any).flood || {};
    if (lotA) rows.push(['Lot area', `${Math.round(lotA).toLocaleString()} sq ft`]); rows.push(['Building footprint (under roof)', `${Math.round((T as any).footprintSf || T.floorSf).toLocaleString()} sq ft`]); rows.push(['Impervious total', `${Math.round(T.imperviousSf).toLocaleString()} sq ft`]); if (lotA) rows.push(['Impervious coverage', `${(100 * T.imperviousSf / lotA).toFixed(1)} %`]);
    rows.push(['Flood zone', FL.zone || '____']); rows.push(['Base flood elevation (BFE)', FL.bfe != null ? `${FL.bfe} ft ${FL.datum || 'NAVD88'}` : '____ ft NAVD88']); rows.push(['Finish floor elevation (FFE)', FL.ffe != null ? `${FL.ffe} ft NAVD88` : '____ ft NAVD88']);
    rows.push(['SETBACKS (provided / required)', '']);
    for (const sb of setbacks(P).sort((a, b) => a.what.localeCompare(b.what) || edgeName(P, a.edge).localeCompare(edgeName(P, b.edge)))) rows.push([`${sb.what} to ${edgeName(P, sb.edge)} line (${sb.edge + 1})`, `${fmtLen(Math.max(0, sb.d), { short: true })} / ${sb.need ? fmtLen(sb.need, { short: true }) : '-'}${sb.bad ? '  !' : ''}`]);
    const iss = setbackIssues(P); const n = Math.min(rows.length, 30);
    let y = 100; const x = 35; doc.setFillColor(255, 255, 255); doc.rect(x - 6, y - 14, 250, 20 + 11 * (n + iss.length + 1), 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('SITE DATA', x, y); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    for (const [k, v] of rows.slice(0, n)) { y += 11; if (!v) doc.setFont('helvetica', 'bold'); doc.text(k, x, y); doc.setFont('helvetica', 'normal'); doc.text(v, x + 238, y, { align: 'right' }); }
    if (iss.length) { doc.setTextColor(200, 0, 0); for (const t of iss) { y += 11; doc.text('! ' + t, x, y); } doc.setTextColor(0); }
  }
  // ---- C-2 pool plan ----
  const pool = P.objects.filter(o => /^pool|^cage$|^pad$|^spa/.test(o.kind)); const deck = P.rooms.filter(r => r.outdoor && /pavers|travertine|concrete|stamped|pool/.test(r.floor));
  if (pool.length) {
    doc.addPage('tabloid', 'landscape'); const pts = [...pool.flatMap(o => objCorners(o)), ...deck.flatMap(r => r.pts)]; const s = scaledCanvas(boxOf(pts, 4), drawW, drawH);
    doc.addImage(s.cv.toDataURL('image/jpeg', 0.9), 'JPEG', 25, 20, drawW * 72, drawH * 72); titleBlock(doc, PW, PH, 'POOL PLAN', 'C-2', s.ftPerIn); northArrow(doc, 60, 60, P.northDeg || 0); scaleBar(doc, 40, PH - 40, s.ftPerIn);
    let y = 110; const x = 35; doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('POOL DATA', x, y); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    for (const o of pool) { y += 12; doc.text(`${o.name}: ${fmtLen(o.w, { short: true })} x ${fmtLen(o.d, { short: true })}${o.kind === 'cage' ? ', ' + fmtLen(o.h, { short: true }) + ' high' : ''}`, x, y); }
    for (const r of deck) { y += 12; doc.text(`${r.name}: ${fmtArea(polyArea(roomOutline(r)))}`, x, y); }
    for (const sb of setbacks(P).filter(s => /Pool|cage|Equipment/.test(s.what))) { y += 12; doc.text(`${sb.what} to ${edgeName(P, sb.edge)} lot line: ${fmtLen(sb.d, { short: true })}`, x, y); }
  }
  // ---- C-3 barrier ----
  if (pool.length) {
    doc.addPage('tabloid', 'landscape'); titleBlock(doc, PW, PH, 'POOL BARRIER', 'C-3', 0);
    const barrier = P.objects.filter(o => /^cage$|^fence|^gate/.test(o.kind)); let y = 50; const x = 40;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text('Residential swimming pool barrier', x, y); y += 22; doc.setFontSize(10); doc.text('Barrier on this job:', x, y); doc.setFont('helvetica', 'normal');
    let lf = 0; for (const o of barrier) { const L = o.kind === 'cage' ? 2 * (o.w + o.d) : o.w; lf += L; y += 14; doc.text(`• ${o.name} - ${o.kind === 'cage' ? fmtLen(o.w, { short: true }) + ' x ' + fmtLen(o.d, { short: true }) + ', ' : ''}${Math.round(L / FTm)} LF, height ${fmtLen(o.h, { short: true })}`, x + 10, y); }
    const gates = P.objects.filter(o => /gate/.test(o.kind)).length + P.openings.filter(o => o.kind !== 'window' && P.objects.some(c => c.kind === 'cage')).length * 0; if (barrier.length) { y += 14; doc.setFont('helvetica', 'bold'); doc.text(`Barrier total: ${Math.round(lf / FTm)} LF · gates/doors in barrier: ${gates || 1} (self-closing, self-latching, open outward)`, x + 10, y); doc.setFont('helvetica', 'normal'); }
    if (!barrier.length) { y += 14; doc.text('• (add a screen cage or pool fence to the design)', x + 10, y); }
    y += 26; doc.setFont('helvetica', 'bold'); doc.text('Typical requirements (Florida Building Code – Residential, Sec. R4501.17 / F.S. Ch. 515):', x, y); doc.setFont('helvetica', 'normal');
    const notes = ['Barrier at least 4 ft (48") high measured on the outside, with no gaps that allow a 4" sphere to pass.', 'Barrier placed around the perimeter of the pool, separate from any fence/hedge/wall unless that wall is part of the barrier.', 'Gates open outward away from the pool, are self-closing and self-latching; release at least 54" above grade (or on the pool side, 3" below the top, with no openings > 1/2" within 18").', 'A screen enclosure may serve as the barrier when it meets these requirements.', 'Where a house wall is part of the barrier, doors with direct access to the pool need an exit alarm, or self-closing / self-latching hardware with release at least 54" above the floor.', 'At least one pool safety feature per F.S. 515.27 (barrier, approved safety cover, door/window alarms, or self-closing/latching doors).', 'City of Cape Coral (since 3/1/2026, Notice to Industry 2-2-26): the pool safety barrier (fence, screen enclosure or screen-room pan roof) needs its OWN Safety Barrier Permit, separate from the pool permit, with NOC, burrowing owl affidavit, site plan/survey showing the barrier and barrier construction details.', 'City of Cape Coral: a final survey is required for pool/spa permits (Notice to Industry, amended 2/10/2026) - check the notice for the required elevations.', 'Verify the current code edition and local amendments with the City of Cape Coral / Lee County building department before submittal.'];
    for (const n of notes) { const L = doc.splitTextToSize('• ' + n, PW - 300); y += 14; doc.text(L, x + 10, y); y += 11 * (L.length - 1); }
    // small key plan
    const pts = [...pool.flatMap(o => objCorners(o)), ...barrier.flatMap(o => objCorners(o))]; P.walls.forEach(w => { if (pts.length && Math.min(...pts.map(q => Math.hypot(q.x - w.a.x, q.y - w.a.y))) < 12) pts.push(w.a, w.b); }); const s = scaledCanvas(boxOf(pts, 4), 7, 4.6, 120); const ky = Math.max(y + 20, PH - 30 - 4.6 * 72); doc.addImage(s.cv.toDataURL('image/jpeg', 0.9), 'JPEG', x, ky, 7 * 72, 4.6 * 72); doc.setFontSize(8); doc.text(`Key plan, 1" = ${s.ftPerIn}'-0"`, x, PH - 24);
  }
  return doc.output('blob');
}
