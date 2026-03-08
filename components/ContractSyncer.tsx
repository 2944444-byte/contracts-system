"use client";
import { useEffect } from "react";
import { syncContractStatuses } from "../lib/contractSync";

export default function ContractSyncer() {
  useEffect(() => {
    syncContractStatuses();
    const interval = setInterval(syncContractStatuses, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);
  return null;
}
