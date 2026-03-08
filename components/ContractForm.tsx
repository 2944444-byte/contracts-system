"use client";

import { useState, type FormEvent } from "react";

type Unit = {
  name: string;
  status: string;
};

type Property = {
  name: string;
  units: Unit[];
};

type Contract = {
  property: string;
  unit: string;
  tenant: string;
  start: string;
  end: string;
  rent: number;
  status: "active";
};

type ContractFormProps = {
  properties: Property[];
  onSave: (contract: Contract) => void;
  onClose: () => void;
};

export default function ContractForm({
  properties,
  onSave,
  onClose,
}: ContractFormProps) {
  const [propertyIdx, setPropertyIdx] = useState(0);
  const [unitIdx, setUnitIdx] = useState(0);
  const [tenant, setTenant] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [rent, setRent] = useState("");

  const units = properties[propertyIdx]?.units ?? [];

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!tenant || !start || !end || !rent) return;
    if (!properties[propertyIdx]) return;
    if (!units[unitIdx]) return;

    onSave({
      property: properties[propertyIdx].name,
      unit: units[unitIdx].name,
      tenant,
      start,
      end,
      rent: Number(rent),
      status: "active",
    });

    setTenant("");
    setStart("");
    setEnd("");
    setRent("");
    setPropertyIdx(0);
    setUnitIdx(0);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      dir="rtl"
    >
      <form
        className="relative flex w-full max-w-md flex-col gap-4 rounded-xl border border-slate-200 bg-white p-8 shadow-lg"
        onSubmit={handleSubmit}
      >
        <button
          type="button"
          className="absolute left-4 top-4 text-xl text-slate-400 hover:text-slate-700"
          onClick={onClose}
        >
          &times;
        </button>

        <h2 className="mb-2 text-xl font-bold text-slate-800">הוסף חוזה</h2>

        <label className="text-right">נכס</label>
        <select
          className="rounded border border-slate-300 px-4 py-2 text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={propertyIdx}
          onChange={(e) => {
            setPropertyIdx(Number(e.target.value));
            setUnitIdx(0);
          }}
        >
          {properties.map((property, index) => (
            <option key={property.name} value={index}>
              {property.name}
            </option>
          ))}
        </select>

        <label className="text-right">יחידה</label>
        <select
          className="rounded border border-slate-300 px-4 py-2 text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={unitIdx}
          onChange={(e) => setUnitIdx(Number(e.target.value))}
        >
          {units.map((unit, index) => (
            <option key={unit.name} value={index}>
              {unit.name}
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="שם שוכר"
          className="rounded border border-slate-300 px-4 py-2 text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={tenant}
          onChange={(e) => setTenant(e.target.value)}
          required
        />

        <input
          type="date"
          className="rounded border border-slate-300 px-4 py-2 text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          required
        />

        <input
          type="date"
          className="rounded border border-slate-300 px-4 py-2 text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          required
        />

        <input
          type="number"
          placeholder='שכ"ד חודשי'
          className="rounded border border-slate-300 px-4 py-2 text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={rent}
          onChange={(e) => setRent(e.target.value)}
          min={1}
          required
        />

        <button
          type="submit"
          className="mt-2 rounded bg-blue-700 py-2 font-bold text-white transition-colors hover:bg-blue-800"
        >
          שמור
        </button>
      </form>
    </div>
  );
}