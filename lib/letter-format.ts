import { supabase } from '@/lib/supabase';

// Company / property letterhead details, used to render the same professional
// header (logo + name + address/phone) and signature that the advances and
// CPI-diff letters already use. Keeps all auto-generated letters visually
// consistent.
export interface CompanyInfo {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  logoUrl: string;
  bankLine: string;
}

export async function loadCompanyInfo(propId: string): Promise<CompanyInfo> {
  const { data: propData } = await supabase
    .from("properties")
    .select("name, company_id, companies(company_name, address, city, phone, email, logo_url, bank_name, bank_branch, bank_account)")
    .eq("id", propId)
    .single();
  const company: any = (propData?.companies as any) || {};
  const companyName = company.company_name || propData?.name || "";
  const companyAddress = [company.address, company.city].filter(Boolean).join(", ");
  const companyPhone = company.phone || "";
  let bankLine = "";
  if (company.bank_name && company.bank_account) {
    bankLine =
      "את התשלום ניתן להעביר לפקודת " + companyName +
      ", חשבון " + company.bank_account +
      " סניף " + (company.bank_branch || "") + " " + company.bank_name + ".";
  }
  const logoUrl = company.logo_url || "";
  return { companyName, companyAddress, companyPhone, logoUrl, bankLine };
}

// Build the content_json object stored on a letter, wrapping the body with the
// company letterhead fields so /letters → handlePrint renders the full header,
// the "הנדון:" subject styling, the signature, and (optionally) the appendix.
export function letterContent(body: string, ci: CompanyInfo, extra?: Record<string, any>) {
  return {
    body: body,
    companyName: ci.companyName,
    companyAddress: ci.companyAddress,
    companyPhone: ci.companyPhone,
    logoUrl: ci.logoUrl,
    bankLine: ci.bankLine,
    ...(extra || {}),
  };
}
