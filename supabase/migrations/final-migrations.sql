-- ===== PropManager v4 — SQL מלא =====

-- 1. כבר נוצר בהתחלה: companies, properties, spaces, tenants, contracts, charges,
--    management_fees, letters, documents, guarantees, insurances_building, insurances_tenant,
--    safety_inspections, alerts, audit_log, vat_rates, document_templates

-- 2. עמודות חסרות לחוזים
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS indexation_method    TEXT DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS rent_type            TEXT DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS revenue_pct          NUMERIC,
  ADD COLUMN IF NOT EXISTS min_rent_per_sqm     NUMERIC,
  ADD COLUMN IF NOT EXISTS management_fee_pct   NUMERIC,
  ADD COLUMN IF NOT EXISTS management_fee_fixed NUMERIC;

-- 3. בדיקות בטיחות — inspector + certificate
ALTER TABLE safety_inspections
  ADD COLUMN IF NOT EXISTS inspector          TEXT,
  ADD COLUMN IF NOT EXISTS certificate_number TEXT;

-- 4. חניה
CREATE TABLE IF NOT EXISTS parking_subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID REFERENCES properties(id) ON DELETE CASCADE,
  tenant_id         UUID REFERENCES tenants(id) ON DELETE SET NULL,
  spot_number       TEXT,
  subscription_type TEXT DEFAULT 'monthly',
  monthly_fee       NUMERIC,
  start_date        DATE,
  end_date          DATE,
  vehicle_number    TEXT,
  status            TEXT DEFAULT 'active',
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE parking_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "parking_auth" ON parking_subscriptions;
CREATE POLICY "parking_auth" ON parking_subscriptions
  FOR ALL USING (auth.role() = 'authenticated');

-- 5. דוחות פידיון
CREATE TABLE IF NOT EXISTS revenue_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     UUID REFERENCES contracts(id) ON DELETE CASCADE,
  report_month    DATE NOT NULL,
  gross_revenue   NUMERIC NOT NULL,
  revenue_pct     NUMERIC NOT NULL,
  calculated_rent NUMERIC NOT NULL,
  min_rent        NUMERIC,
  final_rent      NUMERIC NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE revenue_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "revenue_auth" ON revenue_reports;
CREATE POLICY "revenue_auth" ON revenue_reports
  FOR ALL USING (auth.role() = 'authenticated');

-- 6. property_groups
CREATE TABLE IF NOT EXISTS property_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE property_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "groups_auth" ON property_groups;
CREATE POLICY "groups_auth" ON property_groups
  FOR ALL USING (auth.role() = 'authenticated');

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES property_groups(id) ON DELETE SET NULL;

-- 7. vat_rates
CREATE TABLE IF NOT EXISTS vat_rates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_pct       NUMERIC NOT NULL,
  effective_from DATE NOT NULL,
  effective_to   DATE,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE vat_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vat_auth" ON vat_rates;
CREATE POLICY "vat_auth" ON vat_rates
  FOR ALL USING (auth.role() = 'authenticated');

-- 8. document_templates
CREATE TABLE IF NOT EXISTS document_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  body_template TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "templates_auth" ON document_templates;
CREATE POLICY "templates_auth" ON document_templates
  FOR ALL USING (auth.role() = 'authenticated');

-- 9. cpi_records
CREATE TABLE IF NOT EXISTS cpi_records (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id          UUID REFERENCES contracts(id) ON DELETE CASCADE,
  base_index_value     NUMERIC,
  current_index_value  NUMERIC,
  index_ratio          NUMERIC,
  base_rent_amount     NUMERIC,
  indexed_amount       NUMERIC,
  billing_date         DATE,
  t2_month             TEXT,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE cpi_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cpi_auth" ON cpi_records;
CREATE POLICY "cpi_auth" ON cpi_records
  FOR ALL USING (auth.role() = 'authenticated');

-- 10. letters table אם לא קיים
CREATE TABLE IF NOT EXISTS letters (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id  UUID REFERENCES contracts(id) ON DELETE CASCADE,
  letter_type  TEXT DEFAULT 'notice',
  subject      TEXT,
  body         TEXT,
  template_id  UUID,
  status       TEXT DEFAULT 'draft',
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE letters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "letters_auth" ON letters;
CREATE POLICY "letters_auth" ON letters
  FOR ALL USING (auth.role() = 'authenticated');

-- 11. audit_log
CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT,
  entity_id    TEXT,
  action       TEXT,
  notes        TEXT,
  performed_by UUID,
  performed_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_auth" ON audit_log;
CREATE POLICY "audit_auth" ON audit_log
  FOR ALL USING (auth.role() = 'authenticated');

-- 12. user_profiles
INSERT INTO user_profiles (id, email, full_name, role, is_active)
SELECT id, email, 'Admin', 'admin', true
FROM auth.users WHERE email = '2944444@gmail.com'
ON CONFLICT (id) DO UPDATE SET role = 'admin', is_active = true;

SELECT 'migrations complete ✅' as result;
