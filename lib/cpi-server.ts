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
      baseRentPerSqm: Math.round(value * 100) / 100,
      adjustedRentPerSqm: Math.round(answer.to_value * 100) / 100,
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
