// One physical guarantee, two rows.
//
// When an amendment is added to a contract the same bank guarantee is usually
// recorded again against the amendment, so the instrument now exists twice: once
// on the parent contract and once on the נספח. Both rows are legitimate — each
// contract document really is secured by that guarantee — but they are the SAME
// piece of paper: same bank, same amount, same expiry, often the same scanned
// file. Alerting on each row separately makes the screen show the same guarantee
// expiring twice.
//
// This picks one row per physical guarantee to alert on. Grouping is by the
// contract FAMILY (the parent contract, or the contract itself when it has no
// parent) plus type, expiry and amount — so two genuinely different guarantees
// on the same contract still alert separately, and the same guarantee spread
// across a contract and its amendments alerts once.

function familyOf(g: any): string {
  return g?.contracts?.parent_contract_id || g?.contract_id || "?";
}

export function guaranteeFingerprint(g: any): string {
  return [
    familyOf(g),
    g?.guarantee_type || "?",
    String(g?.end_date || "?").slice(0, 10),
    String(g?.amount_actual ?? g?.amount_required ?? "?"),
  ].join("|");
}

// The ids that should carry the alert — the earliest-recorded row of each group
// (ties broken by id, so the choice is stable between runs).
export function representativeGuaranteeIds(rows: any[]): Set<string> {
  const best: Record<string, any> = {};
  for (const g of (rows || [])) {
    if (!g || !g.id) continue;
    const fp = guaranteeFingerprint(g);
    const cur = best[fp];
    if (!cur) { best[fp] = g; continue; }
    const a = String(g.created_at || ""), b = String(cur.created_at || "");
    if (a < b || (a === b && String(g.id) < String(cur.id))) best[fp] = g;
  }
  const out = new Set<string>();
  Object.keys(best).forEach(function (fp) { out.add(best[fp].id); });
  return out;
}
