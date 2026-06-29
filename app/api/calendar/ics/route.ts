import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/admin-api-auth";
import { deriveEvents, toICS } from "@/lib/calendar-events";

// ICS subscription feed. The URL embeds a per-user calendar_token (subscriptions
// can't send auth headers); we resolve the user, compute their property scope
// server-side (fail-closed — this runs with the service key, RLS is bypassed),
// then emit their events as an iCalendar document.
export const dynamic = "force-dynamic";

function pad(n: number) { return String(n).padStart(2, "0"); }
function iso(d: Date) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return new NextResponse("missing token", { status: 400 });

  const admin = adminClient();
  if (!admin) return new NextResponse("server not configured", { status: 500 });

  const { data: prof } = await admin.from("user_profiles").select("id, role, is_master").eq("calendar_token", token).maybeSingle();
  if (!prof) return new NextResponse("invalid token", { status: 403 });

  // ── Property scope (null = unrestricted) ──
  const [{ data: pa }, { data: ca }] = await Promise.all([
    admin.from("user_property_access").select("property_id").eq("user_id", prof.id),
    admin.from("user_company_access").select("company_id").eq("user_id", prof.id),
  ]);
  const propIds: string[] = (pa ?? []).map(function (r: any) { return r.property_id; });
  const compIds: string[] = (ca ?? []).map(function (r: any) { return r.company_id; });
  const hasScopeRows = propIds.length > 0 || compIds.length > 0;
  const unrestricted = (prof.is_master || prof.role === "admin") && !hasScopeRows;

  let scope: string[] | null = null;
  if (!unrestricted) {
    const ids = propIds.slice();
    if (compIds.length) {
      const { data: cp } = await admin.from("properties").select("id, company_id").in("company_id", compIds);
      (cp ?? []).forEach(function (p: any) { if (ids.indexOf(p.id) === -1) ids.push(p.id); });
    }
    scope = ids;
  }

  // Optional per-property feed (?property=<id>). Only narrow if the property is
  // within the caller's allowed scope — otherwise ignore it (never widen access).
  const propertyParam = req.nextUrl.searchParams.get("property");
  if (propertyParam && (scope === null || scope.indexOf(propertyParam) !== -1)) {
    scope = [propertyParam];
  }

  const keep = function (rows: any[], getPid: (r: any) => any) {
    if (scope === null) return rows;
    return rows.filter(function (r: any) { return (scope as string[]).indexOf(getPid(r)) !== -1; });
  };

  // ── Wide window: 2 months back .. 18 months forward ──
  const now = new Date();
  const from = iso(new Date(now.getFullYear(), now.getMonth() - 2, 1));
  const to   = iso(new Date(now.getFullYear(), now.getMonth() + 18, 0));

  const [c, g, it, ib, sf, op, al] = await Promise.all([
    admin.from("contracts").select("id, end_date, start_date, status, property_id, tenants(name)").in("status", ["active","expiring","extended","upcoming","ended"]),
    admin.from("guarantees").select("id, end_date, contract_id, contracts(property_id, tenants(name))").eq("status","active").not("end_date","is",null),
    admin.from("insurances_tenant").select("id, end_date, contract_id, contracts(property_id, tenants(name))").eq("status","active").not("end_date","is",null),
    admin.from("insurances_building").select("id, end_date, property_id, properties(name)").eq("status","active").not("end_date","is",null),
    admin.from("safety_inspections").select("id, next_inspection_date, inspection_type, property_id, properties(name)").not("next_inspection_date","is",null),
    admin.from("contract_options").select("id, notice_deadline, status, contract_id, contracts(property_id, tenants(name))").not("notice_deadline","is",null).not("status","in","(exercised,declined,expired)"),
    admin.from("alerts").select("id, title, due_date, severity, property_id, contracts(property_id)").eq("is_resolved",false).not("due_date","is",null),
  ]);

  const data = {
    contracts:  keep(c.data ?? [],  function (r: any) { return r.property_id; }),
    guarantees: keep(g.data ?? [],  function (r: any) { return r.contracts?.property_id; }),
    insT:       keep(it.data ?? [], function (r: any) { return r.contracts?.property_id; }),
    insB:       keep(ib.data ?? [], function (r: any) { return r.property_id; }),
    safety:     keep(sf.data ?? [], function (r: any) { return r.property_id; }),
    options:    keep(op.data ?? [], function (r: any) { return r.contracts?.property_id; }),
    alerts:     keep(al.data ?? [], function (r: any) { return r.property_id || r.contracts?.property_id; }),
  };

  const stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + "T" +
                pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + "Z";
  const ics = toICS(deriveEvents(data, from, to), "PropManager — נדל\"ן", stamp);

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="propmanager.ics"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
