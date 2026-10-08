"use client";
import { Amount, Band } from "../ui";
import { explorerTx } from "@/lib/chain";
import { formatAmount, formatDay, formatTime, shortAddress } from "@/lib/format";
import type { LedgerEntry } from "@/lib/ledger";
import type { Till } from "@/lib/storage";

const KIND_TEXT: Record<string, string> = {
  exact: "Matched its request",
  short: "Paid short of its request",
  over: "Paid over its request",
  unmatched: "Arrived with no open request",
  direct: "Paid",
  refund: "Refund",
};

export function SaleDetail({
  entry,
  tills,
  refunds,
  onBack,
  onRefund,
}: {
  entry: LedgerEntry;
  tills: Till[];
  refunds: LedgerEntry[];
  onBack: () => void;
  onRefund?: () => void;
}) {
  const till = tills.find((t) => t.address.toLowerCase() === entry.till.toLowerCase());
  const isRefund = entry.amount < 0n;
  const refunded = refunds.reduce((s, r) => s - r.amount, 0n);
  const link = explorerTx(entry.txHash);
  return (
    <div className="sheet">
      <main className="screen">
        <button className="btn btn-text" style={{ justifyContent: "flex-start", padding: 0, width: "auto" }} onClick={onBack}>
          Back
        </button>
        <p className="tiny mt">{isRefund ? "Refund" : "Sale"}</p>
        <div className="mt">
          <Amount value={isRefund ? -entry.amount : entry.amount} size="lg" />
        </div>
        <dl className="kv mt-lg">
          <dt>Till</dt>
          <dd>{till?.label ?? shortAddress(entry.till)}</dd>
          <dt>{isRefund ? "Paid back to" : "Paid by"}</dt>
          <dd className="num">{shortAddress(entry.counterparty)}</dd>
          <dt>Time</dt>
          <dd className="num">
            {formatDay(entry.time)} · {formatTime(entry.time)}
          </dd>
          <dt>Reference</dt>
          <dd>{entry.reference ?? (entry.requestId ? entry.requestId : "None")}</dd>
          <dt>Status</dt>
          <dd>{KIND_TEXT[entry.kind] ?? entry.kind}</dd>
          {entry.requestedAmount !== undefined && (
            <>
              <dt>Asked for</dt>
              <dd className="num">{formatAmount(entry.requestedAmount)}</dd>
            </>
          )}
          {refunded > 0n && (
            <>
              <dt>Refunded</dt>
              <dd className="num">{formatAmount(refunded)}</dd>
            </>
          )}
        </dl>
        {entry.kind === "unmatched" && !isRefund && (
          <div className="mt">
            <Band kind="plain">
              <p className="small">This money is yours. It reached the till without a matching request on this phone, for example after a sale was cancelled.</p>
            </Band>
          </div>
        )}
        <div className="grow" />
        {!isRefund && onRefund && refunded < entry.amount && (
          <button className="btn btn-outline mt-lg" onClick={onRefund}>
            Refund
          </button>
        )}
        {link && (
          <a className="small muted mt" href={link} target="_blank" rel="noreferrer noopener" style={{ display: "block", textAlign: "center", padding: "12px 0" }}>
            View transaction
          </a>
        )}
      </main>
    </div>
  );
}
