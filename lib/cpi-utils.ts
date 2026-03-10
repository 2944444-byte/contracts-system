// lib/cpi-utils.ts
// Chain-linked CPI calculation utility
// Supports contracts with different base years using linkage coefficients

// Linkage coefficients published by CBS (Israel Central Bureau of Statistics)
// Updated when CBS changes the base year (every ~2 years)
// from_base -> to_base: multiply by coefficient to convert to older base
export const LINK_COEFFICIENTS: Record<string, number> = {
  "2024->2022": 1.074,
  "2022->2020": 1.059,
  "2020->2018": 1.003,
  "2018->2016": 1.010,
  "2016->2014": 0.989,
  "2014->2012": 1.020,
  "2012->2010": 1.052,
  "2010->2008": 1.051,
  "2008->2006": 1.038,
  "2006->2002": 1.068,
  "2002->2000": 1.064,
};

// Base year periods — when each base was active
const BASE_PERIODS: { baseYear: number; from: number; to: number }[] = [
  { baseYear: 2024, from: 2024, to: 9999 },
  { baseYear: 2022, from: 2022, to: 2023 },
  { baseYear: 2020, from: 2018, to: 2021 },
  { baseYear: 2018, from: 2016, to: 2017 },
  { baseYear: 2016, from: 2014, to: 2015 },
  { baseYear: 2014, from: 2012, to: 2013 },
  { baseYear: 2012, from: 2010, to: 2011 },
  { baseYear: 2010, from: 2008, to: 2009 },
  { baseYear: 2008, from: 2006, to: 2007 },
  { baseYear: 2006, from: 2002, to: 2005 },
  { baseYear: 2002, from: 2000, to: 2001 },
];

// Convert any index value to base 2020=100 equivalent
// This allows comparing indices from different base years
export function normalizeToBase2020(value: number, fromBaseYear: number): number {
  if (fromBaseYear === 2020) return value;

  let result = value;
  let currentBase = fromBaseYear;

  // Chain up to 2020 if fromBaseYear is newer
  while (currentBase > 2020) {
    const bases = BASE_PERIODS.filter(b => b.baseYear === currentBase);
    const prevBase = bases[0] ? currentBase - 2 : null;
    if (!prevBase) break;
    const key = `${currentBase}->${prevBase}`;
    const coeff = LINK_COEFFICIENTS[key];
    if (!coeff) break;
    result = result * coeff;
    currentBase = prevBase;
  }

  // Chain down to 2020 if fromBaseYear is older
  while (currentBase < 2020) {
    const nextBase = currentBase + 2;
    const key = `${nextBase}->${currentBase}`;
    const coeff = LINK_COEFFICIENTS[key];
    if (!coeff) break;
    result = result / coeff;
    currentBase = nextBase;
  }

  return result;
}

// Calculate indexation ratio between two CPI values
// Handles different base years using chain linking
export function calcIndexRatio(
  baseValue: number,
  baseYear: number,
  currentValue: number,
  currentBaseYear: number = 2022
): number {
  const normalizedBase = normalizeToBase2020(baseValue, baseYear);
  const normalizedCurrent = normalizeToBase2020(currentValue, currentBaseYear);
  return normalizedCurrent / normalizedBase;
}

// Get the active base year for a given date
export function getBaseYearForDate(year: number): number {
  const period = BASE_PERIODS.find(b => year >= b.from && year <= b.to);
  return period?.baseYear ?? 2022;
}
