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

export async function callerRole(req: Request, admin: SupabaseClient): Promise<"admin" | "manager" | "viewer" | null> {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
    if (!token) return null;
    const { data } = await admin.auth.getUser(token);
    const uid = data?.user?.id;
    if (!uid) return null;
    const { data: prof } = await admin.from("user_profiles").select("role,is_active").eq("id", uid).maybeSingle();
    if (!prof || prof.is_active === false) return null;
    return prof.role === "admin" ? "admin" : prof.role === "manager" ? "manager" : "viewer";
  } catch (e) {
    return null;
  }
}

export const SERVICE_KEY_MSG = "חסר מפתח SUPABASE_SERVICE_ROLE_KEY בהגדרות Vercel. היכנס ל-Supabase → Settings → API → העתק את ה-service_role key, הוסף אותו כ-Environment Variable בפרויקט ב-Vercel (Production+Preview) ובצע Redeploy.";
export const FORBIDDEN_MSG = "אין הרשאה — נדרשת התחברות עם משתמש מורשה.";
