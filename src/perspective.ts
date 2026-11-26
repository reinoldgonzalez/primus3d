/** Photos of paper plans: find the sheet, then flatten it (4-corner perspective correction). Plain canvas math, no libraries. */
export type Quad = [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }]; // TL, TR, BR, BL

/** Bright, low-colour region (the paper) → its 4 corners. Returns null when the sheet already fills the photo or nothing paper-like is found. */
export function findPaper(src: HTMLCanvasElement): { quad: Quad; cover: number } | null {
  const S = 360; const k = Math.min(1, S / Math.max(src.width, src.height)); const W = Math.max(8, Math.round(src.width * k)), H = Math.max(8, Math.round(src.height * k));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d', { willReadFrequently: true })!; c.drawImage(src, 0, 0, W, H);
  const d = c.getImageData(0, 0, W, H).data; const L = new Float32Array(W * H);
  for (let i = 0, j = 0; j < L.length; i += 4, j++) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); L[j] = mx - 0.6 * (mx - mn); } // paper: bright and grey/white
  // smooth away the drawing's lines so the sheet is one blob
  const B = new Float32Array(W * H); const r = 3;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = Math.min(H - 1, Math.max(0, y + dy)); m = Math.max(m, L[yy * W + xx]); } B[y * W + x] = m; }
  const hist = new Float64Array(256); for (const v of B) hist[Math.max(0, Math.min(255, v | 0))]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i]; let sB = 0, wB = 0, best = 0, th = 128; const n = W * H;
  for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += i * hist[i]; const v = wB * wF * (sB / wB - (sum - sB) / wF) ** 2; if (v > best) { best = v; th = i; } }
  const M = new Uint8Array(W * H); for (let i = 0; i < n; i++) M[i] = B[i] > th ? 1 : 0;
  // largest bright component
  const lab = new Int32Array(n); let bestId = 0, bestN = 0, id = 0;
  for (let s = 0; s < n; s++) { if (!M[s] || lab[s]) continue; id++; let cnt = 0; const st = [s]; lab[s] = id;
    while (st.length) { const p = st.pop()!; cnt++; const x = p % W, y = (p / W) | 0; for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (q >= 0 && M[q] && !lab[q]) { lab[q] = id; st.push(q); } }
    if (cnt > bestN) { bestN = cnt; bestId = id; } }
  const cover = bestN / n; if (cover < 0.15) return null;
  let tl = { x: 0, y: 0, v: Infinity }, tr = { x: 0, y: 0, v: -Infinity }, br = { x: 0, y: 0, v: -Infinity }, bl = { x: 0, y: 0, v: Infinity };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (lab[y * W + x] !== bestId) continue; const s1 = x + y, s2 = x - y;
    if (s1 < tl.v) tl = { x, y, v: s1 }; if (s1 > br.v) br = { x, y, v: s1 }; if (s2 > tr.v) tr = { x, y, v: s2 }; if (s2 < bl.v) bl = { x, y, v: s2 }; }
  const f = (p: { x: number; y: number }) => ({ x: (p.x + 0.5) / k, y: (p.y + 0.5) / k });
  return { quad: [f(tl), f(tr), f(br), f(bl)], cover };
}

/** Does this look like a photo of a sheet lying on something (darker surroundings visible)? */
export function isPhotoOfPaper(src: HTMLCanvasElement): Quad | null {
  const r = findPaper(src); if (!r) return null; const { quad, cover } = r; const W = src.width, H = src.height;
  const margin = Math.min(...quad.map(p => Math.min(p.x, p.y, W - p.x, H - p.y))) / Math.max(W, H);
  const skew = Math.abs(quad[0].y - quad[1].y) + Math.abs(quad[3].y - quad[2].y) + Math.abs(quad[0].x - quad[3].x) + Math.abs(quad[1].x - quad[2].x);
  if (cover > 0.97 || (margin < 0.01 && skew / Math.max(W, H) < 0.03)) return null; // sheet fills the photo already (a scan)
  if (cover < 0.2) return null; return quad;
}

function solve(A: number[][], b: number[]) { const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r; [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; } }
  return M.map((r, i) => r[n] / r[i]); }
/** Homography mapping points p[i] → q[i]. */
function homography(p: { x: number; y: number }[], q: { x: number; y: number }[]) {
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) { const { x, y } = p[i], { x: u, y: v } = q[i]; A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u); A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v); }
  const h = solve(A, b); return (x: number, y: number) => { const w = h[6] * x + h[7] * y + 1; return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w }; };
}
/** Warp the quad to a flat rectangle (size from the quad's edge lengths, longest side ≤ maxSide). */
export function warpQuad(src: HTMLCanvasElement, q: Quad, maxSide = 2400): HTMLCanvasElement {
  const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  let w = Math.max(d(q[0], q[1]), d(q[3], q[2])), h = Math.max(d(q[0], q[3]), d(q[1], q[2])); const s = Math.min(1, maxSide / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
  const map = homography([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], q);
  const sd = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, src.width, src.height).data; const SW = src.width, SH = src.height;
  const out = document.createElement('canvas'); out.width = w; out.height = h; const oc = out.getContext('2d')!; const od = oc.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = map(x + 0.5, y + 0.5); const x0 = Math.floor(p.x - 0.5), y0 = Math.floor(p.y - 0.5), fx = p.x - 0.5 - x0, fy = p.y - 0.5 - y0; const o = (y * w + x) * 4;
    if (x0 < 0 || y0 < 0 || x0 + 1 >= SW || y0 + 1 >= SH) { od.data[o] = od.data[o + 1] = od.data[o + 2] = 255; od.data[o + 3] = 255; continue; }
    for (let ch = 0; ch < 3; ch++) { const i00 = (y0 * SW + x0) * 4 + ch; od.data[o + ch] = (sd[i00] * (1 - fx) + sd[i00 + 4] * fx) * (1 - fy) + (sd[i00 + SW * 4] * (1 - fx) + sd[i00 + SW * 4 + 4] * fx) * fy; }
    od.data[o + 3] = 255;
  }
  oc.putImageData(od, 0, 0); return out;
}
