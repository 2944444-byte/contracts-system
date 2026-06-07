"use client";
import React from "react";

// ── Shared design primitives ──────────────────────────────────────────────
// One source of truth for buttons, cards, inputs, empty/loading states and page
// headers, so screens stop re-defining their own `ic` strings and ad-hoc button
// colors. Adopt incrementally — existing markup keeps working unchanged.

// Shared input class (replaces the 33 duplicated `const ic = …` definitions).
export const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 transition";

type Variant = "primary" | "secondary" | "danger" | "success" | "ghost" | "amber";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:   "bg-blue-700 text-white hover:bg-blue-800 border border-transparent",
  secondary: "bg-white text-slate-700 hover:bg-slate-50 border border-slate-300",
  danger:    "bg-red-600 text-white hover:bg-red-700 border border-transparent",
  success:   "bg-green-600 text-white hover:bg-green-700 border border-transparent",
  amber:     "bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-300",
  ghost:     "bg-transparent text-slate-600 hover:bg-slate-100 border border-transparent",
};
const SIZES: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs rounded-lg",
  md: "px-4 py-2 text-sm rounded-lg",
  lg: "px-5 py-2.5 text-sm rounded-xl",
};

export function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
) {
  const { variant = "primary", size = "md", className = "", children, ...rest } = props;
  return (
    <button
      {...rest}
      className={"inline-flex items-center justify-center gap-1.5 font-semibold disabled:opacity-50 disabled:pointer-events-none " + VARIANTS[variant] + " " + SIZES[size] + " " + className}
    >
      {children}
    </button>
  );
}

export function Card(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className = "", children, ...rest } = props;
  return (
    <div {...rest} className={"rounded-xl border border-slate-200 bg-white shadow-sm " + className}>
      {children}
    </div>
  );
}

export function PageHeader(props: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-3xl font-bold text-slate-800">{props.title}</h1>
        {props.subtitle != null && <p className="text-sm text-slate-500 mt-1">{props.subtitle}</p>}
      </div>
      {props.actions && <div className="flex items-center gap-2">{props.actions}</div>}
    </div>
  );
}

export function Field(props: { label: React.ReactNode; required?: boolean; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-700">
        {props.label}{props.required && <span className="text-red-500"> *</span>}
      </label>
      {props.children}
      {props.hint && <p className="mt-1 text-[11px] text-slate-400">{props.hint}</p>}
    </div>
  );
}

export function Spinner(props: { className?: string }) {
  return (
    <span
      className={"inline-block w-4 h-4 rounded-full border-2 border-slate-300 border-t-blue-600 animate-spin " + (props.className || "")}
      role="status"
      aria-label="טוען"
    />
  );
}

export function Loading(props: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm">
      <Spinner /> {props.label || "טוען..."}
    </div>
  );
}

export function Skeleton(props: { className?: string }) {
  return <div className={"rounded-lg bg-slate-100 animate-pulse " + (props.className || "h-5 w-full")} />;
}

export function EmptyState(props: { icon?: string; title: string; hint?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
      <div className="text-5xl mb-3">{props.icon || "📭"}</div>
      <div className="text-slate-500 font-medium">{props.title}</div>
      {props.hint && <div className="text-sm text-slate-400 mt-1">{props.hint}</div>}
      {props.action && <div className="mt-4">{props.action}</div>}
    </div>
  );
}
