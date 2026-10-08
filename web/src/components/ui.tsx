"use client";
import type { ReactNode } from "react";
import { config } from "@/lib/chain";
import { formatAmount } from "@/lib/format";

export function Amount({ value, size = "xl", symbol = true }: { value: bigint; size?: "xl" | "lg" | "md"; symbol?: boolean }) {
  return (
    <span className={`amount-display amount-${size}`}>
      {formatAmount(value)}
      {symbol && <span className="amount-sym">{config.token.symbol}</span>}
    </span>
  );
}

export function Band({ kind, children }: { kind: "warning" | "error" | "plain"; children: ReactNode }) {
  return (
    <div className={`band band-${kind}`} role={kind === "error" ? "alert" : "status"}>
      {kind !== "plain" && (
        <svg className="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="10" cy="10" r="8" />
          <path d="M10 6v5M10 13.5v.5" />
        </svg>
      )}
      <div>{children}</div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Spinnerless({ text }: { text: string }) {
  return (
    <p className="statusline" aria-live="polite">
      {text}
    </p>
  );
}
