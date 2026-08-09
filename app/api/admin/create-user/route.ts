import { NextRequest, NextResponse } from "next/server";
import { adminClient, callerProfile, isUnrestrictedAdmin, SERVICE_KEY_MSG, FORBIDDEN_MSG } from "@/lib/admin-api-auth";

export async function POST(req: NextRequest) {
  try {
    const { email, password, fullName, role } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Missing email or password" }, { status: 400 });
    }

    const admin = adminClient();
    if (!admin) return NextResponse.json({ error: SERVICE_KEY_MSG }, { status: 500 });

    // Caller verification (this route runs with the service key — without this
    // check anyone could create admins): managers may create VIEWERS only;
    // admins create managers/viewers; creating an ADMIN requires an
    // UNRESTRICTED admin (master / no scope) — otherwise a scoped admin could
    // mint an unrestricted admin and escape his scope.
    const prof = await callerProfile(req, admin);
    const caller = prof?.role ?? null;
    const newRole = role ?? "viewer";
    // A manager also needs the explicit manage_viewers capability — matching
    // the users screen, ROUTE_RULES and the DB triggers.
    const allowed = caller === "admin" ||
      (caller === "manager" && newRole === "viewer" && !!prof?.permissions?.["manage_viewers"]);
    if (!allowed) return NextResponse.json({ error: FORBIDDEN_MSG }, { status: 403 });
    if (newRole === "admin" && !(prof && await isUnrestrictedAdmin(prof, admin))) {
      return NextResponse.json({ error: "רק מנהל מערכת בלתי-מוגבל יכול להקים מנהלי מערכת" }, { status: 403 });
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName ?? email },
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // צור profile
    if (data.user) {
      // Per-user secret for the ICS calendar feed (see /api/calendar/ics).
      const calendarToken = (globalThis.crypto?.randomUUID?.() ?? "").replace(/-/g, "") +
                            (globalThis.crypto?.randomUUID?.() ?? "").replace(/-/g, "");
      await admin.from("user_profiles").upsert({
        id:        data.user.id,
        email:     data.user.email,
        full_name: fullName ?? email,
        role:      newRole,
        is_active: true,
        calendar_token: calendarToken || undefined,
      });
    }

    return NextResponse.json({ ok: true, userId: data.user?.id });
  } catch(e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
