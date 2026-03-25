"use server";

const CBS_CALC_URL = "https://api.cbs.gov.il/index/data/calculator/120010";

/**
 * Server Action: Fetch CPI-adjusted value from CBS calculator.
 * Runs server-side — no CORS issues.
 * CBS index 120010 = CPI. The calculator handles base-year conversions automatically.
 *
 * @param fromMM - Base date in MM-YYYY format
 * @param toMM   - Target date in MM-YYYY format
 * @param value  - Rent per sqm to adjust
 */
export async function fetchCpiAdjusted(params: {
  value: number;
  fromMM: string;
  toMM: string;
}): Promise<any> {
  const { value, fromMM, toMM } = params;

  if (!value || !fromMM || !toMM) {
    return { success: false, error: "Missing params" };
  }

  // Convert MM-YYYY → MM-DD-YYYY for CBS API
  const [fMM, fYYYY] = fromMM.split("-");
  const [tMM, tYYYY] = toMM.split("-");

  if (!fMM || !fYYYY || !tMM || !tYYYY) {
    return { success: false, error: `Invalid date format: from=${fromMM} to=${toMM}` };
  }

  const fromDate = `${fMM}-01-${fYYYY}`;
  const toDate = `${tMM}-01-${tYYYY}`;

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
