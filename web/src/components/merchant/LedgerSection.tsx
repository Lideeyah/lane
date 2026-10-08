"use client";
import { useMemo, useState } from "react";
import type { Address } from "viem";
import { Amount, Band } from "../ui";
import { config } from "@/lib/chain";
import { dayKey, formatAmount, formatDay, formatOther, formatTime, shortAddress } from "@/lib/format";
import type { LedgerEntry } from "@/lib/ledger";
import type { Shop } from "@/lib/storage";
import { salesCount, todays, total, type LedgerState } from "@/lib/useLedger";

const RECOVERY_PROMPT_AT = 100n; // whole units of the token

export function LedgerSection({
  shop,
  state,
  onOpen,
  onSweep,
  onRecovery,
  only,
}: {
  shop: Shop;
  state: LedgerState;
  onOpen: (e: LedgerEntry) => void;
  onSweep?: () => void;
  onRecovery?: () => void;
  /** Staff view: one till, today only. */
  only?: Address;
}) {
  const [view, setView] = useState<"till" | "day">("till");
  const tills = only ? shop.tills.filter((t) => t.address === only) : shop.tills;
  const label = (a: string) => tills.find((t) => t.address.toLowerCase() === a.toLowerCase())?.label ?? shop.tills.find((t) => t.address.toLowerCase() === a.toLowerCase())?.label ?? "Till";

  const entries = useMemo(() => {
    const all = state.ledger?.entries ?? [];
    return only ? all.filter((e) => e.till.toLowerCase() === only.toLowerCase()) : all;
  }, [state.ledger, only]);
  const today = todays(entries);
  const todayTotal = total(today);

  const held = state.balances ? Object.entries(state.balances).filter(([a]) => !only || a.toLowerCase() === only.toLowerCase()).reduce((s, [, b]) => s + b, 0n) : null;
  const decimals = 10n ** BigInt(config.token.decimals);
  const showRecoveryPrompt = !only && onRecovery && !shop.recoveryShownAt && held !== null && held + state.ownerBalance >= RECOVERY_PROMPT_AT * decimals;

  const byDay = useMemo(() => {
    const m = new Map<string, LedgerEntry[]>();
    for (const e of entries) {
      const k = dayKey(e.time);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [entries]);

  const historyMissing = !state.ledger || state.ledger.catchingUp;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <p className="tiny">Today</p>
        <div className="mt" style={{ marginTop: 6 }}>
          {state.ledger && !state.ledger.catchingUp ? <Amount value={todayTotal} size="xl" /> : <span className="amount-display amount-xl" style={{ opacity: 0.35 }}>—</span>}
        </div>
        {state.ledger && !state.ledger.catchingUp && (
          <p className="mt muted">
            <span className="num">{salesCount(today)}</span> {salesCount(today) === 1 ? "sale" : "sales"}
          </p>
        )}
      </div>

      {showRecoveryPrompt && (
        <Band kind="plain">
          <p>Your shop now holds enough to be worth protecting. Save your recovery phrase so you can always get back in.</p>
          <button className="btn btn-text" style={{ padding: 0, justifyContent: "flex-start" }} onClick={onRecovery}>
            Save recovery phrase
          </button>
        </Band>
      )}

      {historyMissing && only && <p className="statusline">Today&rsquo;s sales are catching up. Payments are still landing in the till.</p>}

      {historyMissing && !only && (
        <div className="stack">
          <p className="statusline">Detailed history is catching up. These are the balances in your tills right now.</p>
          <div className="list">
            {tills.map((t) => (
              <div key={t.address} className="list-row static">
                <span>{t.label}</span>
                <span className="num">{state.balances ? formatAmount(state.balances[t.address] ?? 0n) : "Reading"}</span>
              </div>
            ))}
            {!only && (
              <div className="list-row static">
                <span>Main account</span>
                <span className="num">{state.balances ? formatAmount(state.ownerBalance) : "Reading"}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {!only && state.others.length > 0 && (
        <div>
          <p className="tiny">Other money in your tills</p>
          <div className="list">
            {state.others.flatMap((o) =>
              Object.entries(o.balances).map(([till, amt]) => (
                <div key={`${o.token}:${till}`} className="list-row static">
                  <span className="stack" style={{ gap: 2 }}>
                    <span>Unrecognised token{o.symbol ? ` · ${o.symbol}` : ""}</span>
                    <span className="small muted">
                      {label(till)} · <span className="num">{shortAddress(o.token)}</span>
                    </span>
                  </span>
                  <span className="num">{formatOther(amt, o.decimals)}</span>
                </div>
              )),
            )}
          </div>
          <p className="small muted mt">Lane does not price these. Closing the day moves them to your main account with everything else.</p>
        </div>
      )}

      {!historyMissing && (
        <>
          {!only && (
            <div className="row between">
              <div className="seg" role="tablist" aria-label="Group sales">
                <button role="tab" aria-selected={view === "till"} className={view === "till" ? "active" : ""} onClick={() => setView("till")}>
                  By till
                </button>
                <button role="tab" aria-selected={view === "day"} className={view === "day" ? "active" : ""} onClick={() => setView("day")}>
                  By day
                </button>
              </div>
              {onSweep && (
                <button className="btn btn-outline" style={{ width: "auto", minHeight: 40, fontSize: 15 }} onClick={onSweep}>
                  Close the day
                </button>
              )}
            </div>
          )}

          {view === "till" || only ? (
            <div className="stack" style={{ gap: 24 }}>
              {!only && (
                <div className="list">
                  {tills.map((t) => {
                    const tt = today.filter((e) => e.till.toLowerCase() === t.address.toLowerCase());
                    return (
                      <div key={t.address} className="list-row static">
                        <span>{t.label}</span>
                        <span className="num">{formatAmount(total(tt))}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div>
                <p className="tiny">Today&rsquo;s sales</p>
                <Rows entries={today} label={label} onOpen={onOpen} empty="No sales yet today." />
              </div>
            </div>
          ) : (
            <div className="stack" style={{ gap: 24 }}>
              {byDay.length === 0 && <p className="muted">No sales in the last two weeks.</p>}
              {byDay.map(([k, list]) => (
                <div key={k}>
                  <div className="row between">
                    <p className="tiny">{formatDay(list[0].time)}</p>
                    <p className="num small">{formatAmount(total(list))}</p>
                  </div>
                  <Rows entries={list} label={label} onOpen={onOpen} empty="" />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Rows({ entries, label, onOpen, empty }: { entries: LedgerEntry[]; label: (a: string) => string; onOpen: (e: LedgerEntry) => void; empty: string }) {
  if (!entries.length) return empty ? <p className="muted mt">{empty}</p> : null;
  return (
    <div className="list">
      {entries.map((e) => {
        const quiet = e.kind === "unmatched";
        return (
          <button key={e.id} className="list-row" onClick={() => onOpen(e)}>
            <span className="stack" style={{ gap: 2 }}>
              <span>
                {label(e.till)}
                {e.reference ? ` · ${e.reference}` : ""}
              </span>
              <span className="small muted">
                <span className="num">{formatTime(e.time)}</span>
                {e.kind === "refund" && " · Refund"}
                {e.kind === "short" && " · Paid short"}
                {e.kind === "over" && " · Overpaid"}
                {quiet && " · No request"}
              </span>
            </span>
            <span className="num" style={{ fontWeight: 600, fontSize: 18, opacity: quiet ? 0.75 : 1 }}>
              {formatAmount(e.amount)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
