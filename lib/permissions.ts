import { supabase } from '@/lib/supabase';

// ─────────────────────────────────────────────────────────────────────────────
// Role & permission model (single source of truth)
//
// admin   (מנהל מערכת) — full access to everything; the only role that can
//                        create admins and managers.
// manager (מנהל)       — scoped to the companies/properties granted by an
//                        admin, with explicit capability flags; may create
//                        VIEWER users within their own scope only.
// viewer  (צופה)       — scoped + capability-limited user (e.g. a safety
//                        officer who only uploads safety certs, or a finance
//                        person who only sees money screens and confirms
//                        payments).
// ─────────────────────────────────────────────────────────────────────────────

export interface PermissionDef { key: string; icon: string; label: string; desc: string; }

export const PERMISSIONS: PermissionDef[] = [
  { key: "manage_properties", icon: "🏢", label: "הקמת ועריכת נכסים",     desc: "יצירה ועריכה של נכסים ויחידות" },
  { key: "manage_contracts",  icon: "📄", label: "הקמת ועריכת חוזים",     desc: "יצירת חוזים, תוספות ואופציות" },
  { key: "manage_letters",    icon: "✉️", label: "יצירת ושליחת מכתבים",   desc: "הפקה, איחוד ושליחה של מכתבים" },
  { key: "manage_charges",    icon: "💳", label: "יצירת חיובים",          desc: "הפקת חיובים והתחשבנויות (מקדמות, הצמדה, ניהול…)" },
  { key: "update_payments",   icon: "✅", label: "עדכון אישורי תשלום",    desc: "סימון חיובים כשולמו והעלאת אסמכתאות" },
  { key: "view_finance",      icon: "💰", label: "צפייה בכספים ודוחות",   desc: "חייבים, תזרים, פדיון ודוחות הכנסות" },
  { key: "manage_guarantees", icon: "🏦", label: "ניהול ערבויות",         desc: "רישום, הארכה והחלפה של ערבויות" },
  { key: "manage_insurance",  icon: "🛡️", label: "ניהול אישורי ביטוח",    desc: "העלאת תעודות ביטוח ומעקב תאימות" },
  { key: "manage_safety",     icon: "🔒", label: "ניהול בדיקות בטיחות",   desc: "העלאת אישורי בטיחות/אש ועדכון בדיקות" },
  { key: "manage_viewers",    icon: "👁", label: "הקמת משתמשי צפייה",     desc: "יצירת משתמשי צפייה בנכסים שבהרשאתו" },
];

// Quick-start presets for viewer users — common job profiles. Always editable
// after applying; purely a convenience, not a constraint.
export const VIEWER_PRESETS: { label: string; icon: string; perms: Record<string, boolean> }[] = [
  { label: "איש כספים",     icon: "💰", perms: { view_finance: true, update_payments: true } },
  { label: "אחראי בטיחות",  icon: "🔒", perms: { manage_safety: true } },
  { label: "אחראי ביטוח",   icon: "🛡️", perms: { manage_insurance: true } },
  { label: "צפייה בלבד",    icon: "👁", perms: {} },
];

export interface CurrentAccess {
  profile: any | null;            // user_profiles row (or null when unknown)
  role: "admin" | "manager" | "viewer";
  permissions: Record<string, boolean>;
  companyIds: string[];           // companies granted directly
  propertyIds: string[];          // properties granted directly
}

// Load the logged-in user's profile + scope. Falls back to admin-like access
// when there is no auth session (local/dev) so the app stays usable.
export async function getCurrentAccess(): Promise<CurrentAccess> {
  try {
    const { data: au } = await supabase.auth.getUser();
    const uid = au?.user?.id;
    if (!uid) return { profile: null, role: "admin", permissions: {}, companyIds: [], propertyIds: [] };
    let [{ data: prof }, { data: comps }, { data: props }] = await Promise.all([
      supabase.from("user_profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("user_company_access").select("company_id").eq("user_id", uid),
      supabase.from("user_property_access").select("property_id").eq("user_id", uid),
    ]);
    // Bootstrap guard: a logged-in user with NO profile row would be locked out
    // as a viewer. If the system has no admin at all, this user IS the master —
    // self-heal by creating an admin profile (prevents the master-lockout that
    // happened when user_profiles was empty). When admins exist, a missing
    // profile stays restricted (safe default).
    if (!prof) {
      const { data: admins } = await supabase.from("user_profiles").select("id").eq("role", "admin").limit(1);
      if (!admins || admins.length === 0) {
        const { data: created } = await supabase.from("user_profiles")
          .upsert({ id: uid, email: au?.user?.email ?? "", full_name: au?.user?.user_metadata?.full_name ?? au?.user?.email ?? "", role: "admin", is_active: true })
          .select().maybeSingle();
        prof = created ?? { id: uid, role: "admin", permissions: {} };
      }
    }
    const role = (prof?.role === "admin" || prof?.role === "manager" || prof?.role === "viewer") ? prof.role : "viewer";
    return {
      profile: prof ?? null,
      role: role,
      permissions: (prof?.permissions && typeof prof.permissions === "object") ? prof.permissions : {},
      companyIds: (comps ?? []).map(function (r: any) { return r.company_id; }),
      propertyIds: (props ?? []).map(function (r: any) { return r.property_id; }),
    };
  } catch (e) {
    return { profile: null, role: "admin", permissions: {}, companyIds: [], propertyIds: [] };
  }
}

// Capability check — admins can everything; others need the explicit flag.
export function hasPerm(access: CurrentAccess, key: string): boolean {
  if (access.role === "admin") return true;
  return !!access.permissions[key];
}

// The property ids this user may see. null = unrestricted (admin).
// Effective scope = directly-granted properties ∪ all properties of granted
// companies (so granting a company covers its future properties too).
export async function allowedPropertyIds(access: CurrentAccess): Promise<string[] | null> {
  if (access.role === "admin") return null;
  let ids = access.propertyIds.slice();
  if (access.companyIds.length) {
    const { data } = await supabase.from("properties").select("id").in("company_id", access.companyIds);
    (data ?? []).forEach(function (p: any) { if (ids.indexOf(p.id) === -1) ids.push(p.id); });
  }
  return ids;
}
