import { formatUnits, parseUnits } from "viem";
import { config } from "./chain";

const decimals = () => config.token.decimals;

/** "12.50" for 12_500_000 with 6 decimals. Always two fraction digits for display. */
export function formatAmount(base: bigint, opts: { signed?: boolean } = {}): string {
  const neg = base < 0n;
  const abs = neg ? -base : base;
  const s = formatUnits(abs, decimals());
  const [whole, frac = ""] = s.split(".");
  const fixed = `${Number(whole).toLocaleString("en-GB")}.${(frac + "00").slice(0, 2)}`;
  if (neg) return `−${fixed}`;
  return opts.signed ? `+${fixed}` : fixed;
}

/** Parse "12.5" → 12_500_000n. Rejects more fraction digits than the token has. */
export function parseAmount(text: string): bigint {
  const clean = text.replace(/[^0-9.]/g, "");
  if (!clean || clean === ".") return 0n;
  return parseUnits(clean, decimals());
}

/** The pad shows up to two fraction digits regardless of token precision. */
export const PAD_FRACTION_DIGITS = 2;

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Balance of a token Lane does not know, in its own units. Never priced. */
export function formatOther(amount: bigint, decimals?: number): string {
  if (decimals === undefined || decimals > 36) return `${amount.toString()} units`;
  const s = formatUnits(amount, decimals);
  const [w, f = ""] = s.split(".");
  return f ? `${Number(w).toLocaleString("en-GB")}.${f.slice(0, 4).replace(/0+$/, "") || "0"}` : Number(w).toLocaleString("en-GB");
}
