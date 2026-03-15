import { NextResponse } from "next/server";
import { syncContractStatuses } from "../../../lib/contractSync";

// נקרא מ-Vercel Cron Job כל יום בחצות
export async function GET() {
  try {
    const updated = await syncContractStatuses();
    return NextResponse.json({ ok: true, updated });
  } catch(e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
