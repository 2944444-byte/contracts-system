// A turnover lease can price different kinds of takings differently — delivery
// platforms at a lower rate than in-store sales, plus whatever else a deal
// names. The tenant reports a figure per category; the consideration is the sum
// of each category at its own rate, and only that total is compared against the
// minimum rent.
//
// A contract with no categories keeps the single-percentage behaviour exactly.

export type RevenueCategory = {
  key: string;    // stable id used in the report's per-category map
  name: string;   // what the user calls it ("משלוחים", "אירועים", …)
  pct: number;    // percentage applied to this category's turnover
};

export function revenueCategoriesFromRow(c: any): RevenueCategory[] {
  const raw = c?.revenue_categories;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(function(x: any) { return x && x.key && x.name; })
    .map(function(x: any) { return { key: String(x.key), name: String(x.name), pct: Number(x.pct) || 0 }; });
}

// Stable key from a name, so a report's stored map survives a rename.
export function categoryKey(name: string, existing: RevenueCategory[]): string {
  const base = (name || "cat").trim().replace(/\s+/g, "_").slice(0, 24) || "cat";
  var k = base, i = 2;
  while (existing.some(function(c) { return c.key === k; })) { k = base + "_" + i; i++; }
  return k;
}

export function hasCategories(cats: RevenueCategory[]): boolean {
  return cats.length > 0;
}

export type CategorySplit = {
  gross: number;               // total turnover across categories
  consideration: number;       // Σ (category turnover × its pct)
  effectivePct: number;        // consideration / gross — for display only
  perCategory: Array<{ key: string; name: string; pct: number; amount: number; consideration: number }>;
  missing: string[];           // categories with no figure reported
};

// Split a report across the contract's categories. `byCategory` is the stored
// per-category map; anything missing counts as zero and is reported back so the
// screen can say the report is incomplete rather than quietly under-charging.
export function splitRevenue(params: {
  categories: RevenueCategory[];
  byCategory: Record<string, any> | null | undefined;
  fallbackGross?: number;      // a pre-categories report keeps its single figure
  fallbackPct?: number;
}): CategorySplit {
  const { categories } = params;
  const map = params.byCategory || {};

  if (!hasCategories(categories)) {
    const gross = Number(params.fallbackGross) || 0;
    const pct = Number(params.fallbackPct) || 0;
    return {
      gross,
      consideration: Math.round(gross * (pct / 100) * 100) / 100,
      effectivePct: pct,
      perCategory: [],
      missing: [],
    };
  }

  var gross = 0, consideration = 0;
  const perCategory: CategorySplit["perCategory"] = [];
  const missing: string[] = [];

  for (const c of categories) {
    const has = map[c.key] != null && map[c.key] !== "";
    const amount = Number(map[c.key]) || 0;
    if (!has) missing.push(c.name);
    const cons = amount * (c.pct / 100);
    gross += amount;
    consideration += cons;
    perCategory.push({ key: c.key, name: c.name, pct: c.pct, amount: amount, consideration: Math.round(cons * 100) / 100 });
  }

  // A report saved before the categories existed carries only a total — fall
  // back to it so history doesn't read as zero turnover.
  if (gross === 0 && Number(params.fallbackGross) > 0) {
    const fg = Number(params.fallbackGross);
    const fp = Number(params.fallbackPct) || 0;
    return {
      gross: fg,
      consideration: Math.round(fg * (fp / 100) * 100) / 100,
      effectivePct: fp,
      perCategory: perCategory,
      missing: missing,
    };
  }

  return {
    gross: Math.round(gross * 100) / 100,
    consideration: Math.round(consideration * 100) / 100,
    effectivePct: gross > 0 ? Math.round((consideration / gross) * 10000) / 100 : 0,
    perCategory,
    missing,
  };
}

export function describeCategories(cats: RevenueCategory[]): string {
  if (!hasCategories(cats)) return "";
  return cats.map(function(c) { return c.name + " " + c.pct + "%"; }).join(" · ");
}
