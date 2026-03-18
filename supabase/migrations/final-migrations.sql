-- PropManager v4 — SQL Migrations Final
-- הרץ ב-Supabase SQL Editor

-- עמודות חוזים
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS indexation_method TEXT DEFAULT 'standard';
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS rent_type TEXT DEFAULT 'fixed';
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS revenue_pct NUMERIC;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS min_rent_per_sqm NUMERIC;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS management_fee_pct NUMERIC;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS management_fee_fixed NUMERIC;

-- בדיקות בטיחות
ALTER TABLE safety_inspections ADD COLUMN IF NOT EXISTS inspector TEXT;
ALTER TABLE safety_inspections ADD COLUMN IF NOT EXISTS certificate_number TEXT;

-- parking_subscriptions
CREATE TABLE IF NOT EXISTS parking_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  spot_number TEXT, subscription_type TEXT DEFAULT 'monthly',
  monthly_fee NUMERIC, start_date DATE, end_date DATE,
  vehicle_number TEXT, status TEXT DEFAULT 'active', notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE parking_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "p1" ON parking_subscriptions;
CREATE POLICY "p1" ON parking_subscriptions FOR ALL USING (auth.role()='authenticated');

-- revenue_reports
CREATE TABLE IF NOT EXISTS revenue_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
  report_month DATE NOT NULL, gross_revenue NUMERIC NOT NULL,
  revenue_pct NUMERIC NOT NULL, calculated_rent NUMERIC NOT NULL,
  min_rent NUMERIC, final_rent NUMERIC NOT NULL, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE revenue_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "p2" ON revenue_reports;
CREATE POLICY "p2" ON revenue_reports FOR ALL USING (auth.role()='authenticated');

-- property_groups
CREATE TABLE IF NOT EXISTS property_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, notes TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE property_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "p3" ON property_groups;
CREATE POLICY "p3" ON property_groups FOR ALL USING (auth.role()='authenticated');
ALTER TABLE properties ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES property_groups(id) ON DELETE SET NULL;

-- vat_rates
CREATE TABLE IF NOT EXISTS vat_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_pct NUMERIC NOT NULL, effective_from DATE NOT NULL,
  effective_to DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE vat_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "p4" ON vat_rates;
CREATE POLICY "p4" ON vat_rates FOR ALL USING (auth.role()='authenticated');
INSERT INTO vat_rates (rate_pct, effective_from, notes) VALUES (18, '2015-10-01', 'שיעור נוכחי') ON CONFLICT DO NOTHING;

-- document_templates
CREATE TABLE IF NOT EXISTS document_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, body_template TEXT, is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "p5" ON document_templates;
CREATE POLICY "p5" ON document_templates FOR ALL USING (auth.role()='authenticated');

-- cpi_records
CREATE TABLE IF NOT EXISTS cpi_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
  base_index_value NUMERIC, current_index_value NUMERIC,
  index_ratio NUMERIC, base_rent_amount NUMERIC, indexed_amount NUMERIC,
  billing_date DATE, t2_month TEXT, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE cpi_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "p6" ON cpi_records;
CREATE POLICY "p6" ON cpi_records FOR ALL USING (auth.role()='authenticated');

-- letters
CREATE TABLE IF NOT EXISTS letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
  letter_type TEXT DEFAULT 'notice', subject TEXT, body TEXT,
  template_id UUID, status TEXT DEFAULT 'draft',
  sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE letters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "p7" ON letters;
CREATE POLICY "p7" ON letters FOR ALL USING (auth.role()='authenticated');

-- audit_log
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT, entity_id TEXT, action TEXT, notes TEXT,
  performed_by UUID, performed_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "p8" ON audit_log;
CREATE POLICY "p8" ON audit_log FOR ALL USING (auth.role()='authenticated');

-- management_fees
CREATE TABLE IF NOT EXISTS management_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
  month DATE NOT NULL, base_amount NUMERIC,
  fee_amount NUMERIC, final_amount NUMERIC,
  status TEXT DEFAULT 'pending', paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE management_fees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "p9" ON management_fees;
CREATE POLICY "p9" ON management_fees FOR ALL USING (auth.role()='authenticated');

-- user_profiles
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT, full_name TEXT, role TEXT DEFAULT 'viewer',
  is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "p10" ON user_profiles;
CREATE POLICY "p10" ON user_profiles FOR ALL USING (auth.role()='authenticated');
INSERT INTO user_profiles (id, email, full_name, role, is_active)
SELECT id, email, 'Admin', 'admin', true FROM auth.users WHERE email='2944444@gmail.com'
ON CONFLICT (id) DO UPDATE SET role='admin', is_active=true;

SELECT 'PropManager v4 SQL migrations complete ✅' as result;
