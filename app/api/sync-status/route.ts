import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/admin-api-auth";
import { syncContractStatuses } from "@/lib/contractSync";

export const runtime = "nodejs";
export const maxDuration = 60;

// Status sync as a SERVER action. It used to run in the browser with the
// caller's own token — which broke the moment DB writes became
// capability-gated (a finance viewer's background sync would fail on
// contracts/spaces updates), and meant the sync only ever covered the
// caller's property scope anyway. Any logged-in user may TRIGGER it; the
// writes run with the service key, exactly like the nightly cron.
export async function POST(req: NextRequest) {
  if (!(await requireUser(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  }
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key,
    { auth: { autoRefreshToken: false, persistSession: false } });
  try {
    const updates = await syncContractStatuses(supabase);
    return NextResponse.json({ ok: true, updates });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "sync failed" }, { status: 500 });
  }
}
