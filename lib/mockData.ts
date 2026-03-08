import type { Property, Tenant, Contract, Alert } from "./types";

export const mockProperties: Property[] = [
  { id: "prop-1", name: "מגדל עזריאלי", address: "דרך מנחם בגין 132, תל אביב", type: "משרדים", status: "active", totalRentableArea: 5000, insuranceCostPerYear: 120000, managementCostPerYear: 200000, trashCostPerYear: 30000, allowedUserIds: ["user-1"], units: [
    { id: "unit-1", propertyId: "prop-1", name: "קומה 10", area: 400, useType: "משרד", status: "occupied", currentTenantId: "tenant-1", currentContractId: "contract-1" },
    { id: "unit-2", propertyId: "prop-1", name: "קומה 11", area: 300, useType: "משרד", status: "vacant" },
    { id: "unit-3", propertyId: "prop-1", name: "קומה 12", area: 500, useType: "משרד", status: "occupied", currentTenantId: "tenant-2", currentContractId: "contract-2" },
  ]},
  { id: "prop-2", name: "קניון רמת אביב", address: "איינשטיין 40, תל אביב", type: "מסחרי", status: "active", totalRentableArea: 3000, insuranceCostPerYear: 80000, managementCostPerYear: 150000, trashCostPerYear: 20000, allowedUserIds: ["user-1"], units: [
    { id: "unit-4", propertyId: "prop-2", name: "חנות 101", area: 200, useType: "מסחרי", status: "occupied", currentTenantId: "tenant-3", currentContractId: "contract-3" },
    { id: "unit-5", propertyId: "prop-2", name: "חנות 102", area: 250, useType: "מסחרי", status: "vacant" },
    { id: "unit-6", propertyId: "prop-2", name: "חנות 103", area: 350, useType: "מסחרי", status: "occupied", currentTenantId: "tenant-4", currentContractId: "contract-4" },
  ]},
  { id: "prop-3", name: "בית כלל", address: "יפו 9, ירושלים", type: "משרדים", status: "active", totalRentableArea: 2000, insuranceCostPerYear: 50000, managementCostPerYear: 90000, trashCostPerYear: 15000, allowedUserIds: ["user-1"], units: [
    { id: "unit-7", propertyId: "prop-3", name: "משרד 1", area: 200, useType: "משרד", status: "occupied", currentTenantId: "tenant-5", currentContractId: "contract-5" },
    { id: "unit-8", propertyId: "prop-3", name: "משרד 2", area: 200, useType: "משרד", status: "vacant" },
    { id: "unit-9", propertyId: "prop-3", name: "משרד 3", area: 200, useType: "משרד", status: "future", currentTenantId: "tenant-6", currentContractId: "contract-6" },
  ]},
];

export const mockTenants: Tenant[] = [
  { id: "tenant-1", name: "חברת הייטק", contacts: [{ name: "דני לוי", phone: "052-1234567", email: "dani@tech.co.il", role: "מנכל" }], assignedUnitIds: ["unit-1"], assignedPropertyIds: ["prop-1"], guarantees: [{ type: "בנקאית", amount: 75000, expiryDate: "2026-06-30" }], insurances: [] },
  { id: "tenant-2", name: "חברת ביטוח לאומי", contacts: [{ name: "שרה כהן", phone: "054-9876543", email: "sara@bituach.co.il", role: "סמנכל" }], assignedUnitIds: ["unit-3"], assignedPropertyIds: ["prop-1"], guarantees: [{ type: "בנקאית", amount: 100000, expiryDate: "2027-03-31" }], insurances: [] },
  { id: "tenant-3", name: "רשת אופנה", contacts: [{ name: "מיכל אברהם", phone: "050-1111222", email: "michal@fashion.co.il", role: "מנהלת" }], assignedUnitIds: ["unit-4"], assignedPropertyIds: ["prop-2"], guarantees: [{ type: "שיק ביטחון", amount: 54000, expiryDate: "2026-08-01" }], insurances: [] },
  { id: "tenant-4", name: "רשת נעליים", contacts: [{ name: "יוסי שפירא", phone: "053-3334444", email: "yosi@shoes.co.il", role: "בעלים" }], assignedUnitIds: ["unit-6"], assignedPropertyIds: ["prop-2"], guarantees: [], insurances: [] },
  { id: "tenant-5", name: "עוד כהן ושות", contacts: [{ name: "אבי כהן", phone: "02-5555666", email: "avi@cohen-law.co.il", role: "עורך דין" }], assignedUnitIds: ["unit-7"], assignedPropertyIds: ["prop-3"], guarantees: [{ type: "בנקאית", amount: 27000, expiryDate: "2025-04-30" }], insurances: [] },
  { id: "tenant-6", name: "חברת נדלן ישראל", contacts: [{ name: "רון מזרחי", phone: "054-7778888", email: "ron@realestate.co.il", role: "מנכל" }], assignedUnitIds: ["unit-9"], assignedPropertyIds: ["prop-3"], guarantees: [], insurances: [] },
];

export const mockContracts: Contract[] = [
  { id: "contract-1", tenantId: "tenant-1", propertyId: "prop-1", unitIds: ["unit-1"], startDate: "2024-01-01", endDate: "2026-12-31", status: "active", rentPerSqm: 90, chargedArea: 400, investmentAddition: 2000, paymentFrequency: "monthly", indexBase: { date: "2024-01", value: 108.5 }, options: [], guarantees: [], annexUrls: [] },
  { id: "contract-2", tenantId: "tenant-2", propertyId: "prop-1", unitIds: ["unit-3"], startDate: "2025-01-01", endDate: "2027-01-01", status: "active", rentPerSqm: 95, chargedArea: 500, investmentAddition: 0, paymentFrequency: "monthly", indexBase: { date: "2025-01", value: 110.2 }, options: [], guarantees: [], annexUrls: [] },
  { id: "contract-3", tenantId: "tenant-3", propertyId: "prop-2", unitIds: ["unit-4"], startDate: "2023-06-01", endDate: "2026-06-01", status: "active", rentPerSqm: 90, chargedArea: 200, investmentAddition: 0, paymentFrequency: "monthly", indexBase: { date: "2023-06", value: 105.0 }, options: [], guarantees: [], annexUrls: [] },
  { id: "contract-4", tenantId: "tenant-4", propertyId: "prop-2", unitIds: ["unit-6"], startDate: "2024-03-01", endDate: "2028-03-01", status: "active", rentPerSqm: 85, chargedArea: 350, investmentAddition: 1500, paymentFrequency: "monthly", indexBase: { date: "2024-03", value: 109.0 }, options: [], guarantees: [], annexUrls: [] },
  { id: "contract-5", tenantId: "tenant-5", propertyId: "prop-3", unitIds: ["unit-7"], startDate: "2022-03-01", endDate: "2025-04-01", status: "expiring", rentPerSqm: 75, chargedArea: 200, investmentAddition: 0, paymentFrequency: "monthly", indexBase: { date: "2022-03", value: 102.0 }, options: [], guarantees: [], annexUrls: [] },
  { id: "contract-6", tenantId: "tenant-6", propertyId: "prop-3", unitIds: ["unit-9"], startDate: "2025-07-01", endDate: "2028-07-01", status: "upcoming", rentPerSqm: 80, chargedArea: 200, investmentAddition: 0, paymentFrequency: "monthly", indexBase: { date: "2025-07", value: 112.0 }, options: [], guarantees: [], annexUrls: [] },
];

export const mockAlerts: Alert[] = [
  { id: "alert-1", type: "contract_expiry", severity: "critical", title: "חוזה עומד לפוג", description: "חוזה עוד כהן פוקע בעוד פחות מ-60 יום", relatedEntityId: "contract-5", dueDate: "2025-04-01", isRead: false, createdAt: "2025-03-01" },
  { id: "alert-2", type: "guarantee_expiry", severity: "warning", title: "ערבות בנקאית פוקעת", description: "ערבות של עוד כהן פוקעת ב-30/04/2025", relatedEntityId: "tenant-5", dueDate: "2025-04-30", isRead: false, createdAt: "2025-03-15" },
  { id: "alert-3", type: "upcoming_contract", severity: "info", title: "חוזה עתידי מתחיל בקרוב", description: "חוזה חברת נדלן ישראל מתחיל 01/07/2025", relatedEntityId: "contract-6", dueDate: "2025-07-01", isRead: false, createdAt: "2025-03-01" },
];

export function getContractsByProperty(propertyId: string) { return mockContracts.filter(c => c.propertyId === propertyId); }
export function getContractsByTenant(tenantId: string) { return mockContracts.filter(c => c.tenantId === tenantId); }
export function calcMonthlyRent(c: Contract) { return c.rentPerSqm * c.chargedArea + c.investmentAddition; }
export function getOccupancyStats(p: Property) {
  const occupied = p.units.filter(u => u.status === "occupied");
  const occupiedArea = occupied.reduce((s, u) => s + u.area, 0);
  return {
    occupiedUnits: occupied.length,
    totalUnits: p.units.length,
    occupiedArea,
    byUnits: p.units.length > 0 ? Math.round(occupied.length / p.units.length * 100) : 0,
    byArea: p.totalRentableArea > 0 ? Math.round(occupiedArea / p.totalRentableArea * 100) : 0
  };
}
