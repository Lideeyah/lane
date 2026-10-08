"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { loadLedger, otherTokens, readBalances, type Ledger, type LedgerEntry, type OtherToken } from "./ledger";
import { dayKey, startOfToday } from "./format";
import { onStorageChange } from "./storage";

const HISTORY_DAYS = 14;

export interface LedgerState {
  ledger: Ledger | null;
  loading: boolean;
  /** Balances read straight from the chain, available before history is. */
  balances: Record<Address, bigint> | null;
  ownerBalance: bigint;
  /** Tokens other than the shop's own sitting in the tills (flow §4.11). */
  others: OtherToken[];
  refresh: () => void;
}

export function useLedger(tills: Address[], owner?: Address): LedgerState {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [balances, setBalances] = useState<Record<Address, bigint> | null>(null);
  const [ownerBalance, setOwnerBalance] = useState(0n);
  const [loading, setLoading] = useState(true);
  const [others, setOthers] = useState<OtherToken[]>([]);
  const key = JSON.stringify([tills, owner ?? null]);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    const n = ++seq.current;
    const [list, own] = JSON.parse(key) as [Address[], Address | null];
    const owner = own ?? undefined;
    if (!list.length) return;
    readBalances(list, owner)
      .then((b) => {
        if (n !== seq.current) return;
        setBalances(b.balances);
        setOwnerBalance(b.ownerBalance);
      })
      .catch(() => undefined);
    otherTokens(list)
      .then((o) => n === seq.current && setOthers(o))
      .catch(() => undefined);
    loadLedger(list, owner, startOfToday() - (HISTORY_DAYS - 1) * 86_400_000)
      .then((l) => {
        if (n !== seq.current) return;
        setLedger(l);
        setBalances(l.balances);
        setOwnerBalance(l.ownerBalance);
      })
      .catch(() => {
        if (n === seq.current) setLedger((prev) => prev ?? { entries: [], balances: {}, ownerBalance: 0n, source: "chain", catchingUp: true });
      })
      .finally(() => n === seq.current && setLoading(false));
  }, [key]);

  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 8000);
    const off = onStorageChange(refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(t);
      off();
      window.removeEventListener("online", refresh);
    };
  }, [refresh]);

  return { ledger, loading, balances, ownerBalance, others, refresh };
}

export function todays(entries: LedgerEntry[]): LedgerEntry[] {
  const k = dayKey(Date.now());
  return entries.filter((e) => dayKey(e.time) === k);
}

export function total(entries: LedgerEntry[]): bigint {
  return entries.reduce((s, e) => s + e.amount, 0n);
}

export function salesCount(entries: LedgerEntry[]): number {
  return entries.filter((e) => e.amount > 0n).length;
}
