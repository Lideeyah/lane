"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { Amount, Band } from "./ui";
import { Pad, nextAmountText } from "./Pad";
import { QR } from "./QR";
import { formatAmount, formatTime, parseAmount } from "@/lib/format";
import { useOnline } from "@/lib/hooks";
import { createRequest, matchTransfer, requestLink, type PaymentRequest } from "@/lib/request";
import { salesStore } from "@/lib/storage";
import { watchTransfers, type IncomingTransfer, type WatchStatus } from "@/lib/watch";

export interface CounterTill {
  address: Address;
  label: string;
}

type Phase =
  | { p: "entry" }
  | { p: "request"; req: PaymentRequest }
  | { p: "outcome"; req: PaymentRequest; transfer: IncomingTransfer; kind: "exact" | "short" | "over" };

/**
 * The till pad and everything that happens at the counter. Requests are made
 * locally; the till is watched continuously so a payment that arrives with no
 * open request is still recorded (flow §4.2), and nothing is ever discarded.
 */
export function Counter({
  till,
  shopName,
  onRefundDifference,
  header,
}: {
  till: CounterTill;
  shopName: string;
  /** Owner only. Staff phones cannot move money and get no refund action. */
  onRefundDifference?: (t: { payer: Address; amount: bigint; saleId: string }) => void;
  header?: React.ReactNode;
}) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ p: "entry" });
  const [status, setStatus] = useState<WatchStatus>("connecting");
  const [extra, setExtra] = useState(0);
  const online = useOnline();
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const onTransfer = useCallback(
    (t: IncomingTransfer) => {
      const id = `${t.txHash}:${t.logIndex}`;
      if (salesStore.get(id)) return; // already reconciled on an earlier load
      const cur = phaseRef.current;
      const open = cur.p === "request" || cur.p === "outcome" ? cur.req : null;
      // A transfer that predates the request cannot be for it.
      const eligible = open && t.time >= open.ts - 5000 ? open : null;
      const kind = matchTransfer(eligible ? { amount: BigInt(eligible.a) } : null, t.amount);
      salesStore.put({
        id,
        txHash: t.txHash,
        till: t.to,
        payer: t.from,
        amount: t.amount.toString(),
        time: t.time,
        kind,
        ...(eligible ? { requestId: eligible.r, reference: eligible.f, requestedAmount: eligible.a } : {}),
      });
      if (cur.p === "request" && eligible && kind !== "unmatched") {
        setPhase({ p: "outcome", req: cur.req, transfer: t, kind });
        navigator.vibrate?.(80);
      } else if (cur.p === "outcome" && eligible) {
        // A second customer scanned the same code (flow §4.9): both are recorded.
        setExtra((n) => n + 1);
      }
    },
    [],
  );

  useEffect(() => watchTransfers({ till: till.address, onTransfer, onStatus: setStatus }), [till.address, onTransfer]);

  const amount = parseAmount(text);

  function request(amt: bigint, reference?: string) {
    if (amt <= 0n) return;
    setExtra(0);
    setPhase({ p: "request", req: createRequest({ till: till.address, amount: amt, shop: shopName, tillLabel: till.label, reference }) });
  }

  function clear() {
    setText("");
    setNote("");
    setNoteOpen(false);
    setExtra(0);
    setPhase({ p: "entry" });
  }

  const offline = !online || status === "offline";

  if (phase.p === "outcome") {
    const got = phase.transfer.amount;
    const want = BigInt(phase.req.a);
    const diff = got > want ? got - want : want - got;
    if (phase.kind === "exact") {
      return (
        <div className="paid-screen" role="status" aria-live="assertive">
          {header}
          <div className="grow" />
          <p className="paid-word">Paid</p>
          <div className="mt">
            <Amount value={got} size="xl" />
          </div>
          <p className="lede mt">
            <span className="num">{formatTime(phase.transfer.time)}</span> · {till.label}
            {phase.req.f ? ` · ${phase.req.f}` : ""}
          </p>
          {extra > 0 && (
            <div className="mt">
              <Band kind="warning">
                <p>
                  {extra === 1 ? "Another payment" : `${extra} more payments`} arrived for this sale. It is in the ledger, where you can refund it.
                </p>
              </Band>
            </div>
          )}
          <div className="grow" />
          <button className="btn btn-ink btn-xl" style={{ minHeight: 96 }} onClick={clear} autoFocus>
            Next sale
          </button>
        </div>
      );
    }
    return (
      <div className="warn-screen" role="status" aria-live="assertive">
        {header}
        <div className="grow" />
        <Band kind="warning">
          <h2>{phase.kind === "short" ? "Paid short" : "Overpaid"}</h2>
        </Band>
        <dl className="kv mt-lg">
          <dt>Asked for</dt>
          <dd className="num">{formatAmount(want)}</dd>
          <dt>Received</dt>
          <dd className="num">{formatAmount(got)}</dd>
          <dt>{phase.kind === "short" ? "Still to pay" : "Paid over"}</dt>
          <dd className="amount-display amount-md">{formatAmount(diff)}</dd>
        </dl>
        <div className="grow" />
        <div className="stack">
          {phase.kind === "short" ? (
            <button className="btn btn-primary btn-xl" onClick={() => request(diff, phase.req.f ?? `Balance of ${phase.req.r}`)}>
              Request the {formatAmount(diff)} balance
            </button>
          ) : onRefundDifference ? (
            <button
              className="btn btn-primary btn-xl"
              onClick={() => onRefundDifference({ payer: phase.transfer.from, amount: diff, saleId: `${phase.transfer.txHash}:${phase.transfer.logIndex}` })}
            >
              Refund the {formatAmount(diff)}
            </button>
          ) : (
            <p className="small">The owner can refund the difference from their phone. The sale is in the ledger.</p>
          )}
          <button className="btn btn-outline" onClick={clear}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (phase.p === "request") {
    const link = requestLink(phase.req, origin);
    return (
      <div className="stack grow" style={{ gap: 16 }}>
        {offline && <div className="offline-band">No connection. The customer can still pay. The sale appears when you reconnect.</div>}
        <div className="row between">
          <span className="small">{till.label}</span>
          <span className="small">{shopName}</span>
        </div>
        <div className="center">
          <Amount value={BigInt(phase.req.a)} size="xl" />
          {phase.req.f && <p className="mt">{phase.req.f}</p>}
        </div>
        <QR value={link} label={`Code to pay ${formatAmount(BigInt(phase.req.a))} to ${shopName}`} />
        <p className="statusline center" aria-live="polite">
          {offline ? "Waiting. Checking again when you reconnect." : "Waiting for payment"}
        </p>
        <div className="grow" />
        <button className="btn btn-outline" onClick={clear}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="stack grow" style={{ gap: 12 }}>
      {header}
      {offline && <div className="offline-band">No connection. You can still take payments.</div>}
      <div className="grow" />
      <p className="amount-display amount-xl" style={{ textAlign: "right", opacity: text ? 1 : 0.35 }} aria-live="polite" aria-label={`Amount ${text || "0"}`}>
        {text || "0"}
      </p>
      {noteOpen ? (
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was sold" maxLength={64} autoFocus />
      ) : (
        <button className="btn btn-text" style={{ justifyContent: "flex-start", padding: 0 }} onClick={() => setNoteOpen(true)}>
          Add what was sold
        </button>
      )}
      <Pad onKey={(k) => setText((t) => nextAmountText(t, k))} />
      <button className="btn btn-primary btn-xl" disabled={amount <= 0n} onClick={() => request(amount, note.trim() || undefined)}>
        {amount > 0n ? `Request ${formatAmount(amount)}` : "Request payment"}
      </button>
    </div>
  );
}
