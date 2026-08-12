"use client";
import { useEffect } from "react";
import { authHeaders } from "@/lib/api-auth-client";

// Background status refresher. Goes through the SERVER route: browser-side
// writes are capability-gated at the DB now, so a viewer's background sync
// would silently fail (and only ever covered their own scope to begin with).
async function syncViaServer() {
  try {
    await fetch("/api/sync-status", { method: "POST", headers: await authHeaders() });
  } catch (e) { /* best-effort */ }
}

export default function ContractSyncer() {
  useEffect(() => {
    syncViaServer();
    const interval = setInterval(syncViaServer, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);
  return null;
}
