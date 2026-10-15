"use client";
import { useEffect, useMemo, useState } from "react";
import { isAddress, type Address } from "viem";
import { Amount, Band, Field } from "../ui";
import { withSigner } from "@/lib/accounts";
import { acceptedToken, publicClient } from "@/lib/chain";
import { formatAmount, parseAmount, shortAddress } from "@/lib/format";
import { readBalances } from "@/lib/ledger";
import { PasskeyError } from "@/lib/passkey";
import { syncRegistry } from "@/lib/shop";
import { salesStore, type Shop } from "@/lib/storage";
import { describe, planRefund, refund } from "@/lib/tx";

export interface RefundTarget {
  saleId: string;
  till: Address;
  payer: Address;
  /** The stablecoin the customer paid with; a refund goes back in the same one. */
  token: Address;
  max: bigint;
  /** Prefilled amount: the full sale, or the overpaid difference. */
  amount: bigint;
}

/** Full or edited amount, a line stating where the money comes from, one confirmation (flow §8). */
export function RefundSheet({ shop, target, onClose }: { shop: Shop; target: RefundTarget; onClose: () => void }) {
  const [text, setText] = useState(formatAmount(target.amount).replace(/,/g, ""));
  const [to, setTo] = useState<string>(target.payer);
  const [bal, setBal] = useState<{ till: bigint; owner: bigint } | null>(null);
  const [state, setState] = useState<{ s: "idle" } | { s: "sending" } | { s: "done"; amount: bigint } | { s: "error"; msg: string }>({ s: "idle" });
  const till = shop.tills.find((t) => t.address.toLowerCase() === target.till.toLowerCase());

  useEffect(() => {
    const of = (h: { token: Address; amount: bigint }[] | undefined) => h?.find((x) => x.token.toLowerCase() === target.token.toLowerCase())?.amount ?? 0n;
    readBalances([target.till], shop.owner)
      .then((b) => setBal({ till: of(b.holdings[target.till]), owner: of(b.holdings[shop.owner]) }))
      .catch(() => setBal(null));
  }, [target.till, target.token, shop.owner]);
  const symbol = acceptedToken(target.token)?.symbol ?? "";
  const toValid = isAddress(to.trim());
  const recipient = to.trim() as Address;

  let amount = 0n;
  try {
    amount = parseAmount(text);
  } catch {
    amount = 0n;
  }
  const tooMuch = amount > target.max;
  const plan = useMemo(
    () => (bal && till ? planRefund(till.index, till.address, shop.owner, amount, bal.till, bal.owner) : null),
    [bal, till, shop.owner, amount],
  );

  async function confirm() {
    if (!plan || amount <= 0n || tooMuch || !toValid) return;
    setState({ s: "sending" });
    try {
      const hash = await withSigner(shop.credentialId, async (session) => {
        const h = await refund(session, plan, recipient, amount, target.token);
        await syncRegistry(session).catch(() => undefined);
        return h;
      });
      const receipt = await publicClient().getTransactionReceipt({ hash });
      const logIndex = receipt.logs[0]?.logIndex ?? 0;
      salesStore.put({ id: `${hash}:${logIndex}`, txHash: hash, token: target.token, till: plan.sourceAddress, payer: recipient, amount: (-amount).toString(), time: Date.now(), kind: "refund", refundOf: target.saleId });
      setState({ s: "done", amount });
    } catch (e) {
      if (e instanceof PasskeyError && e.kind === "dismissed") return setState({ s: "idle" });
      setState({ s: "error", msg: describe(e) });
    }
  }

  return (
    <div className="sheet">
      <main className="screen">
        {state.s === "done" ? (
          <>
            <div className="grow" />
            <h2>Refunded</h2>
            <div className="mt">
              <Amount value={state.amount} size="lg" />
            </div>
            <p className="mt">Sent back to {shortAddress(recipient)} in {symbol}. The ledger shows it against the sale.</p>
            <div className="grow" />
            <button className="btn btn-ink btn-xl" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-text" style={{ justifyContent: "flex-start", padding: 0, width: "auto" }} onClick={onClose}>
              Back
            </button>
            <h1 className="mt">Refund</h1>
            <div className="stack mt-lg" style={{ gap: 20 }}>
              <Field label="Amount to refund">
                <input className="input num" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))} />
              </Field>
              {tooMuch && <p className="small">The most you can refund on this sale is {formatAmount(target.max)}.</p>}
              <p>
                {!bal
                  ? "Checking where the money will come from."
                  : plan
                    ? plan.source === "till"
                      ? `The money will come from ${till?.label ?? "this till"}.`
                      : `${till?.label ?? "This till"} no longer holds enough, so the money will come from your main account.`
                    : "Neither the till nor your main account holds enough for this refund."}
              </p>
              <Field label={`Send it back to (a Monad address, in ${symbol})`}>
                <input className="input num" value={to} spellCheck={false} autoCapitalize="off" onChange={(e) => setTo(e.target.value)} />
              </Field>
              {!toValid && <p className="small">That is not a complete address.</p>}
              <p className="small muted">
                Filled in with the address that paid. If the customer paid from an exchange such as Bybit or Binance, that address belongs to the exchange, not to them, and a refund sent there may never reach them. Ask them for a Monad address of their own.
              </p>
              {state.s === "error" && (
                <Band kind="error">
                  <p>The refund did not go through. {state.msg}</p>
                </Band>
              )}
            </div>
            <div className="grow" />
            <button className="btn btn-primary btn-xl mt-lg" disabled={!plan || amount <= 0n || tooMuch || !toValid || state.s === "sending"} onClick={confirm}>
              {state.s === "sending" ? "Refunding" : `Refund ${formatAmount(amount)}`}
            </button>
          </>
        )}
      </main>
    </div>
  );
}
