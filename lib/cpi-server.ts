"use server";

const CBS_CALC_URL = "https://api.cbs.gov.il/index/data/calculator/120010";

/**
 * Server Action: Fetch CPI-adjusted value from CBS calculator.
 * Runs server-side — no CORS or Vercel auth issues.
 * CBS index 120010 = CPI. The calculator handles base-year conversions automatically.
 *
 * CBS determines the "מדד ידוע" (known index) based on the date:
 * - The day matters: CPI for month X is published ~15th of month X+1.
 *
 * @param fromDate - Base date as MM-DD-YYYY (full date with day for CBS known-index logic)
 * @param toDate   - Target date as MM-DD-YYYY
 * @param value    - Rent per sqm to adjust
 */
export async function fetchCpiAdjusted(params: {
  value: number;
  fromDate: string;  // MM-DD-YYYY
  toDate: string;    // MM-DD-YYYY
}): Promise<any> {
  const { value, fromDate: fromDateRaw, toDate: toDateRaw } = params;

  if (!value || !fromDateRaw || !toDateRaw) {
    return { success: false, error: "Missing params" };
  }

  // Ensure MM-DD-YYYY format. Accept MM-DD-YYYY or MM-YYYY (default to 15th)
  function ensureFullDate(d: string): string {
    const parts = d.split("-");
    if (parts.length === 3) return d;
    return `${parts[0]}-15-${parts[1]}`;
  }

  const fromDate = ensureFullDate(fromDateRaw);
  const toDate = ensureFullDate(toDateRaw);

  const cbsUrl = `${CBS_CALC_URL}?value=${value}&date=${fromDate}&toDate=${toDate}&format=json&download=false`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(cbsUrl, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "PropManager/4.0",
      },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `CBS API ${res.status}: ${text.substring(0, 200)}` };
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("json")) {
      const text = await res.text();
      return { success: false, error: `CBS returned non-JSON (${contentType}): ${text.substring(0, 200)}` };
    }

    const data = await res.json();
    const answer = data.answer;

    if (!answer || !answer.to_value) {
      return { success: false, error: "CBS returned no answer: " + JSON.stringify(data).substring(0, 300) };
    }

    return {
      success: true,
      baseRentPerSqm: value,
      adjustedRentPerSqm: answer.to_value,
      changePct: answer.change_percent ?? null,
      fromDate: answer.from_index_date || fromMM,
      toDate: answer.to_index_date || toMM,
      fromIndexValue: answer.from_index_value ?? null,
      toIndexValue: answer.to_index_value ?? null,
      baseYear: answer.base_year ?? null,
      verificationUrl: cbsUrl,
    };
  } catch (e: any) {
    return { success: false, error: `Fetch failed: ${e.name} — ${e.message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchHighestChainedCpi — for "highest_in_period" / "no_drop" contracts.
//
// Scans every month in [scanFromYear/Month .. scanToYear/Month], asks CBS
// calculator for the precise chained ratio from baseFromDate to each month,
// and returns the month with the HIGHEST chained value. This is the only
// correct way to find the peak across Israeli base-year changes (every 2
// years) — comparing raw published index values across bases is invalid.
//
// Caching: results are memoized per (baseFromDate, monthKey) for the lifetime
// of the server process. ~30 unique CBS calls per contract per session.
//
// @param baseFromDate    MM-DD-YYYY — the contract's base date
// @param scanFromYear/Month  inclusive — usually the base month
// @param scanToYear/Month    inclusive — usually the t-2 known month at payment
// ─────────────────────────────────────────────────────────────────────────────
const _highestChainedCache = new Map<string, number>();

export async function fetchHighestChainedCpi(params: {
  baseFromDate: string;     // MM-DD-YYYY
  scanFromYear: number;
  scanFromMonth: number;    // 1..12
  scanToYear: number;
  scanToMonth: number;      // 1..12
}): Promise<{
  success: boolean;
  peakYear?: number;
  peakMonth?: number;
  peakToValue?: number;     // precise CBS to_value for value=10000
  peakRatio?: number;       // peakToValue / 10000
  error?: string;
}> {
  const { baseFromDate, scanFromYear, scanFromMonth, scanToYear, scanToMonth } = params;
  if (!baseFromDate) return { success: false, error: "Missing baseFromDate" };

  const fromYM = scanFromYear * 12 + (scanFromMonth - 1);
  const toYM = scanToYear * 12 + (scanToMonth - 1);
  if (toYM < fromYM) return { success: false, error: "scanTo < scanFrom" };

  let peakKey = "";
  let peakValue = 0;
  let peakY = 0, peakM = 0;

  for (let ym = fromYM; ym <= toYM; ym++) {
    const y = Math.floor(ym / 12);
    const m = (ym % 12) + 1;
    const cacheKey = `${baseFromDate}|${y}-${m}`;
    let toValue = _highestChainedCache.get(cacheKey);

    if (toValue === undefined) {
      // CPI of month M becomes "known" on the 16th of month M+1.
      // Use that publish date so CBS calculator treats month M as the to-index.
      let pubY = y;
      let pubM = m + 1;
      if (pubM > 12) { pubM = 1; pubY++; }
      const pubDate = `${String(pubM).padStart(2, "0")}-16-${pubY}`;

      const result = await fetchCpiAdjusted({
        value: 10000,
        fromDate: baseFromDate,
        toDate: pubDate,
      });
      toValue = result.success ? (Number(result.adjustedRentPerSqm) || 0) : 0;
      _highestChainedCache.set(cacheKey, toValue);
    }

    if (toValue > peakValue) {
      peakValue = toValue;
      peakKey = `${y}-${m}`;
      peakY = y;
      peakM = m;
    }
  }

  if (peakValue <= 0) return { success: false, error: "No data" };
  return {
    success: true,
    peakYear: peakY,
    peakMonth: peakM,
    peakToValue: peakValue,
    peakRatio: peakValue / 10000,
  };
}
