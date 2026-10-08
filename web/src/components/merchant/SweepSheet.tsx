"use client";
import { useState } from "react";
import type { Address } from "viem";
import { Amount, Band } from "../ui";
import { withSigner } from "@/lib/accounts";
import { formatAmount, formatDay, formatOther } from "@/lib/format";
import { otherTokens, readBalances } from "@/lib/ledger";
import { PasskeyError } from "@/lib/passkey";
import { syncRegistry } from "@/lib/shop";
import type { Shop } from "@/lib/storage";
import { describe, sweepTills, type OtherBalances, type SweepResult } from "@/lib/tx";
import { salesCount, todays, total, type LedgerState } from "@/lib/useLedger";

type State = { s: "confirm" } | { s: "sweeping" } | { s: "partial"; results: SweepResult[] } | { s: "summary" } | { s: "error"; msg: string };

/** Sweep each till into the main account with one prompt, then the day close summary (flow §7). */
export function SweepSheet({ shop, ledger, onClose }: { shop: Shop; ledger: LedgerState; onClose: () => void }) {
  const [state, setState] = useState<State>({ s: "confirm" });
  const balances = ledger.balances ?? {};
  const waiting = shop.tills.reduce((s, t) => s + (balances[t.address] ?? 0n), 0n);
  const otherCount = ledger.others.reduce((n, o) => n + Object.keys(o.balances).length, 0);
  const today = todays(ledger.ledger?.entries ?? []);

  async function run(only?: Address) {
    setState({ s: "sweeping" });
    try {
      const addrs = shop.tills.map((t) => t.address);
      const [fresh, extra] = await Promise.all([readBalances(addrs, shop.owner), otherTokens(addrs).catch(() => [])]);
      const others: OtherBalances = {};
      for (const o of extra) for (const [till, amount] of Object.entries(o.balances)) (others[till as Address] ??= []).push({ token: o.token, amount });
      const targets = shop.tills.filter((t) => (!only || t.address === only) && ((fresh.balances[t.address] ?? 0n) > 0n || (others[t.address]?.length ?? 0) > 0));
      const results = await withSigner(shop.credentialId, async (session) => {
        const r = await sweepTills(session, targets, fresh.balances, undefined, others);
        await syncRegistry(session).catch(() => undefined);
        return r;
      });
      ledger.refresh();
      const failed = results.filter((r) => r.error || r.others?.some((o) => o.error));
      setState(failed.length ? { s: "partial", results: failed } : { s: "summary" });
    } catch (e) {
      if (e instanceof PasskeyError && e.kind === "dismissed") return setState({ s: "confirm" });
      setState({ s: "error", msg: describe(e) });
    }
  }

  const label = (a: string) => shop.tills.find((t) => t.address === a)?.label ?? "Till";

  return (
    <div className="sheet">
      <main className="screen">
        {state.s !== "summary" && (
          <button className="btn btn-text" style={{ justifyContent: "flex-start", padding: 0, width: "auto" }} onClick={onClose}>
            Back
          </button>
        )}

        {(state.s === "confirm" || state.s === "sweeping" || state.s === "error") && (
          <>
            <h1 className="mt">Close the day</h1>
            <p className="mt">Move everything in your tills into your main account.</p>
            <div className="mt-lg">
              <p className="tiny">In your tills now</p>
              <div style={{ marginTop: 6 }}>
                <Amount value={waiting} size="xl" />
              </div>
            </div>
            <div className="list mt">
              {shop.tills.map((t) => (
                <div key={t.address} className="list-row static">
                  <span>{t.label}</span>
                  <span className="num">{formatAmount(balances[t.address] ?? 0n)}</span>
                </div>
              ))}
            </div>
            {otherCount > 0 && (
              <p className="small mt">
                Also moving {otherCount === 1 ? "one unrecognised token" : `${otherCount} unrecognised token balances`}. Lane does not price these.
              </p>
            )}
            {state.s === "error" && (
              <div className="mt">
                <Band kind="error">
                  <p>Nothing was moved. {state.msg}</p>
                </Band>
              </div>
            )}
            <div className="grow" />
            <div className="stack mt-lg">
              <button className="btn btn-primary btn-xl" disabled={state.s === "sweeping" || (waiting === 0n && otherCount === 0)} onClick={() => run()}>
                {state.s === "sweeping" ? "Moving money" : waiting === 0n ? (otherCount ? "Move unrecognised tokens" : "Nothing to move") : `Move ${formatAmount(waiting)}`}
              </button>
              {waiting === 0n && otherCount === 0 && (
                <button className="btn btn-outline" onClick={() => setState({ s: "summary" })}>
                  See today&rsquo;s summary
                </button>
              )}
            </div>
          </>
        )}

        {state.s === "partial" && (
          <>
            <div className="mt">
              <Band kind="error">
                <h2>{state.results.length === 1 ? `${label(state.results[0].till)} did not move` : "Some tills did not move"}</h2>
              </Band>
            </div>
            <p className="mt">Every other till moved into your main account. The money below is still safe in its till.</p>
            <div className="list mt">
              {state.results.map((r) => (
                <div key={r.till} className="list-row static">
                  <span className="stack" style={{ gap: 2 }}>
                    <span>{label(r.till)}</span>
                    <span className="small muted">
                      {r.error ??
                        r.others
                          ?.filter((o) => o.error)
                          .map((o) => `An unrecognised token (${formatOther(o.amount)}) did not move.`)
                          .join(" ")}
                    </span>
                  </span>
                  <button className="btn btn-primary" style={{ width: "auto", minHeight: 44 }} onClick={() => run(r.till)}>
                    Retry {formatAmount(r.amount)}
                  </button>
                </div>
              ))}
            </div>
            <div className="grow" />
            <button className="btn btn-outline mt-lg" onClick={() => setState({ s: "summary" })}>
              See today&rsquo;s summary
            </button>
          </>
        )}

        {state.s === "summary" && (
          <>
            <div className="grow" />
            <p className="tiny">{shop.name}</p>
            <p className="mt" style={{ fontSize: 18 }}>
              {formatDay(Date.now())}
            </p>
            <div className="mt">
              <Amount value={total(today)} size="xl" />
            </div>
            <p className="lede mt">
              <span className="num">{salesCount(today)}</span> {salesCount(today) === 1 ? "sale" : "sales"}
            </p>
            <div className="list mt-lg">
              {shop.tills.map((t) => {
                const tt = today.filter((e) => e.till.toLowerCase() === t.address.toLowerCase());
                return (
                  <div key={t.address} className="list-row static">
                    <span>
                      {t.label} <span className="small muted num">· {salesCount(tt)}</span>
                    </span>
                    <span className="num" style={{ fontWeight: 600 }}>
                      {formatAmount(total(tt))}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="small muted mt">Taken with Lane</p>
            <div className="grow" />
            <button className="btn btn-ink btn-xl mt-lg" onClick={onClose}>
              Done
            </button>
          </>
        )}
      </main>
    </div>
  );
}
