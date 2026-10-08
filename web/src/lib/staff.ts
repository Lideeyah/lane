import type { Address } from "viem";
import { decodePayload, encodePayload } from "./request";

/**
 * Staff pairing carries a till address and its label and nothing else. The
 * staff device can create requests and read that till's public sales. It never
 * receives key material, so a lost staff phone is not an incident.
 */
export interface PairingPayload {
  v: 1;
  t: Address;
  n: string;
  s: string;
}

export function pairingLink(p: { till: Address; label: string; shop: string }, origin: string): string {
  const payload: PairingPayload = { v: 1, t: p.till, n: p.label, s: p.shop };
  return `${origin}/staff#${encodePayload(payload)}`;
}

export function parsePairing(fragment: string): PairingPayload | null {
  const p = decodePayload<PairingPayload>(fragment);
  if (!p || p.v !== 1 || typeof p.t !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(p.t)) return null;
  return { v: 1, t: p.t, n: String(p.n ?? "Till"), s: String(p.s ?? "") };
}
