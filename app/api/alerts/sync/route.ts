import { NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-api-auth";
import { createClient } from "@supabase/supabase-js";
import { runAlertSync } from "@/lib/alerts-sync";

export async function POST(req: Request) {
  if (!(await requireUser(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { created } = await runAlertSync(supabase);
  return NextResponse.json({ ok: true, created });
}
