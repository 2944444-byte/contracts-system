import { supabase } from "./supabase";

interface AuditParams {
  entity_type: string;
  entity_id?:  string | null;   // חייב להיות uuid — ערך אחר נשמר כ-null (העמודה מסוג uuid)
  action:      string;
  notes?:      string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// רישום ליומן הפעולות (audit_log). שמות העמודות חייבים להתאים לסכימה:
// user_id / created_at (ברירת מחדל now()); אין עמודת notes — הערה נשמרת
// בתוך new_value. אי-התאמה כאן נכשלת בשקט (ה-catch), אז כל שינוי בסכימה
// מחייב עדכון כאן.
export async function logAudit({ entity_type, entity_id, action, notes }: AuditParams): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const eid = entity_id && UUID_RE.test(entity_id) ? entity_id : null;
    const { error } = await supabase.from("audit_log").insert({
      entity_type,
      entity_id: eid,
      action,
      user_id:   user?.id ?? null,
      new_value: notes ? { notes: notes } : null,
    });
    if (error) console.warn("audit log failed", error.message);
  } catch (e) {
    // audit log failure should not break the app
    console.warn("audit log failed", e);
  }
}
