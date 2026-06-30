import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side caller verification for the admin API routes. These routes run
// with the SERVICE ROLE key, so without this check ANYONE who knows the URL
// could create admins / reset passwords / delete users. The client must send
// its Supabase session token (Authorization: Bearer <access_token>); we verify
// it and load the caller's profile role.
export function adminClient(): SupabaseClient | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function callerProfile(req: Request, admin: SupabaseClient): Promise<{ uid: string; role: "admin" | "manager" | "viewer"; isMaster: boolean } | null> {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
    if (!token) return null;
    const { data } = await admin.auth.getUser(token);
    const uid = data?.user?.id;
    if (!uid) return null;
    const { data: prof } = await admin.from("user_profiles").select("role,is_active,is_master").eq("id", uid).maybeSingle();
    if (!prof || prof.is_active === false) return null;
    const role = prof.role === "admin" ? "admin" : prof.role === "manager" ? "manager" : "viewer";
    return { uid: uid, role: role, isMaster: !!prof.is_master };
  } catch (e) {
    return null;
  }
}

export async function callerRole(req: Request, admin: SupabaseClient): Promise<"admin" | "manager" | "viewer" | null> {
  const p = await callerProfile(req, admin);
  return p ? p.role : null;
}

// Lightweight gate for action routes (send-email, extract, etc.): is the caller
// any logged-in user? Verifies the bearer JWT (works with service or anon key).
export async function requireUser(req: Request): Promise<boolean> {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
    if (!token) return false;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data } = await client.auth.getUser(token);
    return !!data?.user?.id;
  } catch (e) { return false; }
}

// Is this admin UNRESTRICTED (master, or no scope rows)? A SCOPED admin must
// not be able to create admins — that would let him mint an unrestricted one.
export async function isUnrestrictedAdmin(p: { uid: string; role: string; isMaster: boolean }, admin: SupabaseClient): Promise<boolean> {
  if (p.role !== "admin") return false;
  if (p.isMaster) return true;
  const [{ count: c1 }, { count: c2 }] = await Promise.all([
    admin.from("user_company_access").select("id", { count: "exact", head: true }).eq("user_id", p.uid),
    admin.from("user_property_access").select("id", { count: "exact", head: true }).eq("user_id", p.uid),
  ]);
  return ((c1 ?? 0) + (c2 ?? 0)) === 0;
}

export const SERVICE_KEY_MSG = "חסר מפתח SUPABASE_SERVICE_ROLE_KEY בהגדרות Vercel. היכנס ל-Supabase → Settings → API → העתק את ה-service_role key, הוסף אותו כ-Environment Variable בפרויקט ב-Vercel (Production+Preview) ובצע Redeploy.";
export const FORBIDDEN_MSG = "אין הרשאה — נדרשת התחברות עם משתמש מורשה.";
