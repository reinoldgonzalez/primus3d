import { store, objCorners, polyArea, polyPerimeter, wallLen } from './model';
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
