export type UserRole = "admin" | "manager" | "viewer";
export type UnitStatus = "vacant" | "occupied" | "future" | "inactive";
export type ContractStatus = "active" | "expiring" | "expired" | "upcoming";
export type PaymentFrequency = "monthly" | "quarterly" | "other";
export type AlertSeverity = "critical" | "warning" | "info";
export type AlertType = "contract_expiry" | "option_deadline" | "guarantee_expiry" | "insurance_expiry" | "upcoming_contract";

export type ContactPerson = { name: string; phone: string; email: string; role: string; };
export type Guarantee = { type: string; amount: number; expiryDate: string; notes?: string; };
export type Insurance = { company: string; policyNumber: string; expiryDate: string; coverageAmount: number; };
export type IndexBase = { date: string; value: number; };
export type Option = { durationMonths: number; noticeDeadline: string; exercised: boolean; };

export type Unit = {
  id: string; propertyId: string; name: string; area: number;
  useType: string; status: UnitStatus; currentTenantId?: string;
  currentContractId?: string; notes?: string;
};

export type Property = {
  id: string; name: string; address: string; type: string;
  status: "active" | "inactive"; totalRentableArea: number;
  insuranceCostPerYear: number; managementCostPerYear: number;
  trashCostPerYear: number; units: Unit[]; allowedUserIds: string[];
};

export type Tenant = {
  id: string; name: string; companyName?: string;
  contacts: ContactPerson[]; assignedUnitIds: string[];
  assignedPropertyIds: string[]; guarantees: Guarantee[];
  insurances: Insurance[]; notes?: string;
};

export type Contract = {
  id: string; tenantId: string; propertyId: string; unitIds: string[];
  startDate: string; endDate: string; status: ContractStatus;
  rentPerSqm: number; chargedArea: number; investmentAddition: number;
  paymentFrequency: PaymentFrequency; indexBase: IndexBase;
  options: Option[]; guarantees: Guarantee[]; insurance?: Insurance;
  documentUrl?: string; annexUrls: string[]; notes?: string;
};

export type Alert = {
  id: string; type: AlertType; severity: AlertSeverity;
  title: string; description: string; relatedEntityId: string;
  dueDate: string; isRead: boolean; createdAt: string;
};
