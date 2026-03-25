"use server";

/**
 * Server Action: Fetch CPI-adjusted value from CBS calculator.
 * Runs server-side — no CORS issues, no Vercel auth issues.
 * Uses CBS official calculator (index 120010) which handles base-year changes automatically.
 */
export async function fetchCpiAdjusted(params: {
  value: number;
  fromMM: string; // MM-YYYY
  toMM: string;   // MM-YYYY
}): Promise<{
  success: boolean;
  baseRentPerSqm: number;
  adjustedRentPerSqm: number;
  changePct: number | null;
  fromDate: string;
  toDate: string;
  fromIndexValue: number | null;
  toIndexValue: number | null;
  baseYear: string | null;
  verificationUrl: string;
} | { success: false; error: string }> {
  const { value, fromMM, toMM } = params;

  // Convert MM-YYYY to MM-DD-YYYY for CBS API
  const [fMM, fYYYY] = fromMM.split("-");
  const [tMM, tYYYY] = toMM.split("-");
  const fromDate = `${fMM}-01-${fYYYY}`;
  const toDate = `${tMM}-01-${tYYYY}`;

  const cbsUrl = `https://api.cbs.gov.il/index/data/calculator/120010?value=${value}&date=${fromDate}&toDate=${toDate}&format=json&download=false`;

  try {
    const res = await fetch(cbsUrl, {
      headers: { "Accept": "application/json" },
      next: { revalidate: 3600 }, // cache 1 hour
    });

    if (!res.ok) {
      return { success: false, error: `CBS API returned ${res.status}` };
    }

    const data = await res.json();
    const answer = data.answer ?? data;

    if (!answer.to_value) {
      return { success: false, error: "No result from CBS" };
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
    return { success: false, error: e.message };
  }
}
