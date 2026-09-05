// The area a contract covers is the sum of ITS UNITS — never the header field.
//
// `contracts.charged_area` is a header value typed once. Add a unit to a lease,
// remove one, or amend it, and that number goes stale while the truth lives in
// contract_spaces. A calculation that reads the header therefore bills the
// wrong area: פולירם held מחסן 1 (5,589 m²) plus גרליה + ממד + מדרגות (422 m²)
// while the header still said 5,589, so 422 m² were charged to nobody.
//
// Rule: units decide. The header is used only when a contract has no units
// listed at all, which is the one case where it is the only information there
// is — and even then it is a fallback, not a source of truth.

// Units only — no fallback. The option penalty was written this way and its
// figure must not change: a lease with no units listed yields 0 there, which is
// the conservative answer for a penalty.
// The area a contract row charges for a unit. A snapshot may carry a frozen
// area (area_override) — set when the physical unit was later split — so that
// periods before the split keep the m² that were true at the time. Otherwise
// the live unit area.
export function csArea(cs: any): number {
  if (cs == null) return 0;
  const o = cs.area_override;
  if (o != null && o !== "" && Number(o) > 0) return Number(o);
  return Number(cs?.spaces?.area) || Number(cs?.area) || 0;
}

export function contractAreaStrict(row: any): number {
  const spaces = row?.contract_spaces ?? [];
  var total = 0;
  for (const cs of spaces) {
    const a = csArea(cs);
    if (a > 0) total += a;
  }
  return total;
}

export function contractArea(row: any): number {
  const spaces = row?.contract_spaces;
  if (Array.isArray(spaces) && spaces.length > 0) {
    const sum = spaces.reduce(function (a: number, x: any) {
      return a + csArea(x);
    }, 0);
    if (sum > 0) return sum;
  }
  return Number(row?.charged_area) || 0;
}

// True when the header disagrees with the units — the sign that one of them
// needs correcting. Screens surface this rather than silently picking a side.
export function areaMismatch(row: any): { mismatch: boolean; header: number; units: number } {
  const header = Number(row?.charged_area) || 0;
  const spaces = row?.contract_spaces;
  const units = Array.isArray(spaces) && spaces.length > 0
    ? spaces.reduce(function (a: number, x: any) { return a + csArea(x); }, 0)
    : 0;
  return { mismatch: units > 0 && header > 0 && Math.abs(units - header) > 0.5, header, units };
}
