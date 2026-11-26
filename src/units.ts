// All internal lengths are meters. Display/parse in feet-inches or metric.
export type UnitSystem = 'imperial' | 'metric';
export const FT = 0.3048;
export const IN = 0.0254;
let system: UnitSystem = 'imperial';
export function setUnits(u: UnitSystem) { system = u; }
export function getUnits(): UnitSystem { return system; }

function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : a; }

/** Format a length in meters. Imperial: 12' 6 1/2" (nearest 1/8"). */
export function fmtLen(m: number, opts: { short?: boolean } = {}): string {
  if (!isFinite(m)) return '-';
  if (system === 'metric') {
    if (Math.abs(m) < 1) return `${Math.round(m * 1000) / 10} cm`;
    return `${(Math.round(m * 1000) / 1000).toFixed(opts.short ? 2 : 3)} m`;
  }
  const neg = m < 0; m = Math.abs(m);
  let eighths = Math.round(m / IN * 8);
  let ft = Math.floor(eighths / 96); eighths -= ft * 96;
  let inch = Math.floor(eighths / 8); let frac = eighths - inch * 8;
  let fracStr = '';
  if (frac && !opts.short) { const g = gcd(frac, 8); fracStr = ` ${frac / g}/${8 / g}`; }
  else if (frac && opts.short) { if (frac >= 4) inch += 1; if (inch === 12) { ft += 1; inch = 0; } }
  const s = ft ? `${ft}' ${inch}${fracStr}"` : `${inch}${fracStr}"`;
  return (neg ? '-' : '') + s;
}

export function fmtArea(m2: number): string {
  if (system === 'metric') return `${(Math.round(m2 * 100) / 100).toFixed(2)} m²`;
  return `${Math.round(m2 / (FT * FT) * 10) / 10} sq ft`;
}

/** Parse user input to meters. Accepts: 12' 6", 12'6, 12 6, 12.5', 150", 12.5 (ft), 3.2m, 320cm, 1/2" fractions. */
export function parseLen(input: string): number | null {
  let s = (input || '').trim().toLowerCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace(/''/g, '"');
  if (!s) return null;
  const num = (t: string): number => {
    t = t.trim(); if (!t) return 0;
    // mixed number "6 1/2" or "1/2" or "6-1/2"
    const mm = t.match(/^(\d+(?:\.\d+)?)?[\s-]*(?:(\d+)\/(\d+))?$/);
    if (!mm) return NaN;
    const whole = mm[1] ? parseFloat(mm[1]) : 0;
    const fr = mm[2] ? parseFloat(mm[2]) / parseFloat(mm[3]) : 0;
    if (!mm[1] && !mm[2]) return NaN;
    return whole + fr;
  };
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m)$/))) {
    const v = parseFloat(m[1]); return m[2] === 'mm' ? v / 1000 : m[2] === 'cm' ? v / 100 : v;
  }
  if (system === 'metric' && /^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s); // plain number = meters
  // feet and inches
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(.*)$/))) {
    const ft = parseFloat(m[1]);
    let rest = m[2].replace(/("|in|inch|inches)$/, '').trim();
    const inch = rest ? num(rest) : 0;
    if (isNaN(inch)) return null;
    return ft * FT + inch * IN;
  }
  if ((m = s.match(/^(.*?)\s*(?:"|in|inch|inches)$/))) {
    const inch = num(m[1]); return isNaN(inch) ? null : inch * IN;
  }
  // "12 6" => 12 ft 6 in ; "12 6 1/2"
  if ((m = s.match(/^(\d+)\s+(\d+(?:\s+\d+\/\d+)?|\d+\/\d+)$/))) {
    const inch = num(m[2]); if (isNaN(inch)) return null;
    return parseInt(m[1]) * FT + inch * IN;
  }
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s) * FT; // bare number = feet
  return null;
}

export function fmtAngle(rad: number): string {
  let d = rad * 180 / Math.PI; d = ((d % 360) + 360) % 360;
  return `${Math.round(d * 10) / 10}°`;
}
