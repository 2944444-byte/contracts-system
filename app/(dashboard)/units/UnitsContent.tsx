"use client";
import { Suspense } from "react";
import UnitsPage from "./UnitsContent";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400">טוען...</div>}>
      <UnitsPage />
    </Suspense>
  );
}
