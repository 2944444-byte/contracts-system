"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { getScopeIds, getCompanyScopeIds, scopeRows, scopeGroups } from "@/lib/permissions";

/**
 * Shared hierarchy filter component: קבוצה → חברה → נכס
 * Used across all screens that need property-level filtering.
 *
 * Usage:
 *   <PropertyHierarchyFilter onChange={({ groupId, companyId, propertyId, propertyIds }) => ...} />
 *
 * Returns:
 *   - groupId: selected group or "all"
 *   - companyId: selected company or "all"
 *   - propertyId: selected property or "all"
 *   - propertyIds: array of property IDs matching current filter (for queries)
 */

interface FilterState {
  groupId: string;
  companyId: string;
  propertyId: string;
  propertyIds: string[];
}

interface Props {
  onChange: (filter: FilterState) => void;
  showGroupFilter?: boolean; // default true if groups exist
}

export default function PropertyHierarchyFilter({ onChange, showGroupFilter }: Props) {
  const [groups, setGroups] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [groupId, setGroupId] = useState("all");
  const [companyId, setCompanyId] = useState("all");
  const [propertyId, setPropertyId] = useState("all");

  useEffect(function() {
    Promise.all([
      supabase.from("property_groups").select("id,group_name,company_id").order("group_name"),
      supabase.from("companies").select("id,company_name").order("company_name"),
      supabase.from("properties").select("id,name,company_id,group_id").order("name"),
      getScopeIds(),
      getCompanyScopeIds(),
    ]).then(function([g, c, p, scope, companyScope]) {
      // SCOPED: this shared filter feeds every screen's dropdowns — a limited
      // user must only ever see his own groups/companies/properties here.
      var scopedProps = scopeRows(p.data ?? [], scope as any, function(prop: any){ return prop.id; });
      var scopedComps = (companyScope === null) ? (c.data ?? []) : (c.data ?? []).filter(function(comp: any){ return (companyScope as any).indexOf(comp.id) !== -1; });
      setGroups(scopeGroups(g.data ?? [], scope as any, scopedProps));
      setCompanies(scopedComps);
      setProperties(scopedProps);
      setLoaded(true);
      // Initial callback with all (scoped) properties
      var allIds = scopedProps.map(function(prop: any) { return prop.id; });
      onChange({ groupId: "all", companyId: "all", propertyId: "all", propertyIds: allIds });
    });
  }, []);

  function applyFilter(newGroup: string, newCompany: string, newProperty: string) {
    setGroupId(newGroup);
    setCompanyId(newCompany);
    setPropertyId(newProperty);

    var filtered = properties;

    // Filter by group
    if (newGroup !== "all") {
      filtered = filtered.filter(function(p) { return p.group_id === newGroup; });
    }

    // Filter by company
    if (newCompany !== "all") {
      filtered = filtered.filter(function(p) { return p.company_id === newCompany; });
    }

    // Filter by specific property
    if (newProperty !== "all") {
      filtered = filtered.filter(function(p) { return p.id === newProperty; });
    }

    var ids = filtered.map(function(p) { return p.id; });
    onChange({ groupId: newGroup, companyId: newCompany, propertyId: newProperty, propertyIds: ids });
  }

  // Filtered options based on hierarchy
  var visibleCompanies = companies;
  if (groupId !== "all") {
    var groupCompanyIds = groups.filter(function(g) { return g.id === groupId; }).map(function(g) { return g.company_id; });
    visibleCompanies = companies.filter(function(c) { return groupCompanyIds.includes(c.id); });
  }

  var visibleProperties = properties;
  if (groupId !== "all") {
    visibleProperties = visibleProperties.filter(function(p) { return p.group_id === groupId; });
  }
  if (companyId !== "all") {
    visibleProperties = visibleProperties.filter(function(p) { return p.company_id === companyId; });
  }

  var hasGroups = groups.length > 0;
  var hasMultipleCompanies = companies.length > 1;
  var hasMultipleProperties = properties.length > 1;

  if (!loaded) return null;

  return (
    <div className="flex gap-2 flex-wrap items-center">
      {/* Group filter — only show if groups exist */}
      {hasGroups && (showGroupFilter !== false) && (
        <select
          value={groupId}
          onChange={function(e) { applyFilter(e.target.value, "all", "all"); }}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <option value="all">כל הקבוצות</option>
          {groups.map(function(g) { return <option key={g.id} value={g.id}>{g.group_name}</option>; })}
        </select>
      )}

      {/* Company filter — only show if multiple companies */}
      {hasMultipleCompanies && (
        <select
          value={companyId}
          onChange={function(e) { applyFilter(groupId, e.target.value, "all"); }}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <option value="all">כל החברות</option>
          {visibleCompanies.map(function(c) { return <option key={c.id} value={c.id}>{c.company_name}</option>; })}
        </select>
      )}

      {/* Property filter — always show if multiple properties */}
      {hasMultipleProperties && (
        <select
          value={propertyId}
          onChange={function(e) { applyFilter(groupId, companyId, e.target.value); }}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <option value="all">כל הנכסים</option>
          {visibleProperties.map(function(p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}
        </select>
      )}
    </div>
  );
}
