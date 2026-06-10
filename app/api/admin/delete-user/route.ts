import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Permanently delete a user: auth record + profile + access rows.
export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) return NextResponse.json({ error: "Service role key not configured" }, { status: 500 });
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    await admin.from("user_property_access").delete().eq("user_id", userId);
    await admin.from("user_company_access").delete().eq("user_id", userId);
    await admin.from("user_profiles").delete().eq("id", userId);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error && error.message.indexOf("not found") === -1) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
