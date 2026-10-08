import type { Address } from "viem";
import { config } from "./chain";

/**
 * A payment request is generated on the merchant's device and travels to the
 * customer in the URL fragment, so it never reaches a server log (architecture
 * §12). Nothing is sent anywhere when it is created, which is why the code still
 * appears when the merchant has no connection.
 */
export interface PaymentRequest {
  v: 1;
  /** till address */
  t: Address;
  /** amount in token base units, as a decimal string */
  a: string;
  /** token address */
  k: Address;
  /** chain id */
  c: number;
  /** local request id, so two sales of one amount at one till never blur */
  r: string;
  /** created at, ms */
  ts: number;
  /** shop name */
  s: string;
  /** till label */
  n: string;
  /** optional reference for what was sold */
  f?: string;
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function newRequestId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function createRequest(input: { till: Address; amount: bigint; shop: string; tillLabel: string; reference?: string }): PaymentRequest {
  return {
    v: 1,
    t: input.till,
    a: input.amount.toString(),
    k: config.token.address,
    c: config.chain.id,
    r: newRequestId(),
    ts: Date.now(),
    s: input.shop.slice(0, 64),
    n: input.tillLabel.slice(0, 32),
    ...(input.reference ? { f: input.reference.slice(0, 64) } : {}),
  };
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function encodePayload(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

export function decodePayload<T>(fragment: string): T | null {
  try {
    const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
    if (!raw) return null;
    return JSON.parse(new TextDecoder().decode(unb64url(raw))) as T;
  } catch {
    return null;
  }
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;

export function isPaymentRequest(x: unknown): x is PaymentRequest {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    r.v === 1 &&
    typeof r.t === "string" && ADDR.test(r.t) &&
    typeof r.k === "string" && ADDR.test(r.k) &&
    typeof r.a === "string" && /^\d+$/.test(r.a) &&
    typeof r.c === "number" &&
    typeof r.r === "string" && r.r.length > 0 && r.r.length <= 32 &&
    typeof r.ts === "number" &&
    typeof r.s === "string" &&
    typeof r.n === "string"
  );
}

export function requestLink(req: PaymentRequest, origin: string): string {
  return `${origin}/pay#${encodePayload(req)}`;
}

export function isExpired(req: PaymentRequest, now = Date.now()): boolean {
  return now - req.ts > config.requestExpiryMs;
}

/**
 * Compare an incoming transfer to the open request. Pure, so it is tested.
 * Exact matches; less is short; more is over; no open request is unmatched.
 */
export function matchTransfer(open: { amount: bigint } | null, received: bigint): "exact" | "short" | "over" | "unmatched" {
  if (!open) return "unmatched";
  if (received === open.amount) return "exact";
  return received < open.amount ? "short" : "over";
}

/** EIP-681 link for wallets that register the ethereum: scheme. */
export function eip681(req: PaymentRequest): string {
  return `ethereum:${req.k}@${req.c}/transfer?address=${req.t}&uint256=${req.a}`;
}
