"use client";
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";

// Shared open/close state for the mobile sidebar drawer. Desktop never uses it
// (the sidebar is static at lg+), so this is a pure mobile-only concern.
const Ctx = createContext<{ open: boolean; setOpen: (v: boolean) => void }>({ open: false, setOpen: function(){} });
export function useMobileNav() { return useContext(Ctx); }

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Auto-close the drawer after navigating (tapping a nav item changes route).
  useEffect(function(){ setOpen(false); }, [pathname]);
  // Lock body scroll while the drawer overlay is up.
  useEffect(function(){
    if (open) document.body.style.overflow = "hidden"; else document.body.style.overflow = "";
    return function(){ document.body.style.overflow = ""; };
  }, [open]);
  return <Ctx.Provider value={{ open: open, setOpen: setOpen }}>{children}</Ctx.Provider>;
}

// Hamburger — visible only on mobile (lg:hidden), opens the drawer.
export function MobileMenuButton() {
  const { setOpen } = useMobileNav();
  return (
    <button type="button" onClick={function(){ setOpen(true); }} aria-label="פתח תפריט"
      className="lg:hidden rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 shrink-0 leading-none">
      <span className="text-lg">☰</span>
    </button>
  );
}
