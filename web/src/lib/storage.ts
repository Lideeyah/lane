import type { Address } from "viem";

/**
 * Local state. The browser stores the credential id, the shop name and the till
 * labels, plus the device's own reconciliation records (which request matched
 * which transfer). None of it is key material and all of it is rebuildable from
 * the chain except the references, which only ever existed on this device.
 */

export interface Till {
  index: number;
  address: Address;
  label: string;
  registered: boolean;
  /** Set when a pairing code has been shown for this till. Housekeeping only. */
  pairedAt?: number;
}

export interface Shop {
  version: 1;
  credentialId: string;
  owner: Address;
  name: string;
  tills: Till[];
  createdAt: number;
  recoveryShownAt?: number;
}

export type MatchKind = "exact" | "short" | "over" | "unmatched" | "direct" | "refund";

export interface SaleRecord {
  /** `${txHash}:${logIndex}` */
  id: string;
  txHash: `0x${string}`;
  till: Address;
  payer: Address;
  amount: string; // bigint as string
  time: number;
  kind: MatchKind;
  requestId?: string;
  reference?: string;
  requestedAmount?: string;
  /** For refunds: the sale this refund belongs to. */
  refundOf?: string;
}

export interface StaffPairing {
  version: 1;
  till: Address;
  label: string;
  shop: string;
  pairedAt: number;
}

const SHOP_KEY = "lane.shop.v1";
const SALES_KEY = "lane.sales.v1";
const STAFF_KEY = "lane.staff.v1";

function read<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent("lane:storage", { detail: key }));
  } catch {
    /* storage full or blocked: the chain is the source of truth anyway */
  }
}

export const shopStore = {
  get: () => read<Shop>(SHOP_KEY),
  set: (shop: Shop) => write(SHOP_KEY, shop),
  update(fn: (s: Shop) => Shop) {
    const s = read<Shop>(SHOP_KEY);
    if (!s) throw new Error("No shop on this device");
    write(SHOP_KEY, fn(s));
  },
  clear() {
    window.localStorage.removeItem(SHOP_KEY);
    window.dispatchEvent(new CustomEvent("lane:storage", { detail: SHOP_KEY }));
  },
  hasShop: () => !!read<Shop>(SHOP_KEY)?.credentialId,
};

export const salesStore = {
  all: () => read<Record<string, SaleRecord>>(SALES_KEY) ?? {},
  get: (id: string) => salesStore.all()[id],
  put(rec: SaleRecord) {
    const all = salesStore.all();
    all[rec.id] = { ...all[rec.id], ...rec };
    write(SALES_KEY, all);
  },
  /** Returns records with a request/reference attached to them, for ledger enrichment. */
  byTx(txHash: string) {
    return Object.values(salesStore.all()).filter((r) => r.txHash === txHash);
  },
};

export const staffStore = {
  get: () => read<StaffPairing>(STAFF_KEY),
  set: (p: StaffPairing) => write(STAFF_KEY, p),
  clear() {
    window.localStorage.removeItem(STAFF_KEY);
  },
};

/** Subscribe to local changes (same tab and other tabs). */
export function onStorageChange(fn: () => void): () => void {
  const handler = () => fn();
  window.addEventListener("lane:storage", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("lane:storage", handler);
    window.removeEventListener("storage", handler);
  };
}
