import { NextRequest, NextResponse } from "next/server";
import { adminClient, callerRole, SERVICE_KEY_MSG, FORBIDDEN_MSG } from "@/lib/admin-api-auth";

export async function POST(req: NextRequest) {
  try {
    const { email, password, fullName, role } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Missing email or password" }, { status: 400 });
    }

    const admin = adminClient();
    if (!admin) return NextResponse.json({ error: SERVICE_KEY_MSG }, { status: 500 });

    // Caller verification (this route runs with the service key — without this
    // check anyone could create admins): admins create any role; managers may
    // create VIEWERS only.
    const caller = await callerRole(req, admin);
    const newRole = role ?? "viewer";
    const allowed = caller === "admin" || (caller === "manager" && newRole === "viewer");
    if (!allowed) return NextResponse.json({ error: FORBIDDEN_MSG }, { status: 403 });

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName ?? email },
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // צור profile
    if (data.user) {
      await admin.from("user_profiles").upsert({
        id:        data.user.id,
        email:     data.user.email,
        full_name: fullName ?? email,
        role:      newRole,
        is_active: true,
      });
    }

    return NextResponse.json({ ok: true, userId: data.user?.id });
  } catch(e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
