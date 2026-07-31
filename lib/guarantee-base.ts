// What monthly rent a guarantee of "N months' rent" is measured against.
//
// On a fixed-rent lease that is simply rent_per_sqm × area (+ any investment
// addition), which is why the calculation was always right there.
//
// On a turnover lease there is no rent_per_sqm at all — the rent is a share of
// revenue and is unknowable in advance. What the landlord can actually count on
// each month is the MINIMUM, and that is what the guarantee is written against.
// Reading the empty rent_per_sqm left the guarantee holding the management fee
// alone, understating it by the whole rent.

export function guaranteedMonthlyRent(params: {
  rentType: string;
  rentPerSqm?: number | string | null;
  area?: number | string | null;
  investmentAddition?: number | string | null;
  minimumRent?: number | string | null;
  // How the minimum is expressed: per sqm per month, or a monthly sum.
  minRentBasis?: "per_sqm" | "monthly";
  // Already-computed per-unit rent, when units are priced individually.
  perUnitTotal?: number | null;
}): number {
  const area = Number(params.area) || 0;
  const invest = Number(params.investmentAddition) || 0;

  const perUnit = Number(params.perUnitTotal) || 0;
  if (perUnit > 0) return perUnit + invest;

  const fixed = (Number(params.rentPerSqm) || 0) * area;
  if (fixed > 0) return fixed + invest;

  const isRevenue = params.rentType === "revenue_pct" || params.rentType === "revenue_based";
  if (isRevenue) {
    const min = Number(params.minimumRent) || 0;
    if (min <= 0) return 0;                     // no floor agreed → nothing to measure against
    const monthly = params.minRentBasis === "monthly" ? min : min * area;
    return monthly + invest;
  }

  return invest;
}
