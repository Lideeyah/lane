"use client";
import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, numberToHex, type Address, type Hash } from "viem";
import { Amount, Band } from "@/components/ui";
import { erc20Abi } from "@/lib/abi";
import { meraSigner, mnemonicFromSecret, type MeraSigner } from "@/lib/accounts";
import { config, inChunks, publicClient, type TokenInfo } from "@/lib/chain";
import { formatAmount } from "@/lib/format";
import { useFragment } from "@/lib/hooks";
import { assertPrfDiscoverable, PasskeyError } from "@/lib/passkey";
import { decodePayload, eip681, isExpired, isPaymentRequest, type PaymentRequest } from "@/lib/request";
import { describe, ensureGas, sendToken } from "@/lib/tx";

/**
 * The only screen a stranger sees. No header, no navigation, no route back to
 * the landing page, no third-party scripts. It rebuilds itself from the link
 * fragment alone, because a wallet app often returns the customer to a cold page.
 */

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
declare global {
  interface Window {
    ethereum?: Eth;
  }
}

type State =
  | { s: "loading" }
  | { s: "invalid" }
  | { s: "expired" }
  | { s: "ready" }
  | { s: "paying"; how: "wallet" | "face" }
  | { s: "waiting-wallet" }
  | { s: "exchange" }
  | { s: "waiting-exchange" }
  | { s: "confirmed"; hash?: Hash }
  | { s: "declined"; msg?: string }
  | { s: "insufficient"; balance: bigint }
  | { s: "no-wallet" };

const pendingKey = (r: string) => `lane.pay.${r}`;

/** Exchanges can only send real money, so the exchange path is hidden on testnet. */
const EXCHANGE_PAY = config.chainKey !== "testnet";

/**
 * Which accepted stablecoin to pay with: the one the request names if the payer
 * holds enough of it, otherwise any other accepted one they hold enough of.
 */
async function pickToken(holder: Address, req: PaymentRequest, amount: bigint): Promise<{ token: TokenInfo } | { short: bigint }> {
  const client = publicClient();
  const tokens = [...config.tokens].sort((a, b) => (a.address.toLowerCase() === req.k.toLowerCase() ? -1 : b.address.toLowerCase() === req.k.toLowerCase() ? 1 : 0));
  const held = await Promise.all(tokens.map((t) => client.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [holder] }).catch(() => 0n)));
  const i = held.findIndex((b) => b >= amount);
  return i >= 0 ? { token: tokens[i] } : { short: held.reduce((m, b) => (b > m ? b : m), 0n) };
}

export default function Pay() {
  const [req, setReq] = useState<PaymentRequest | null>(null);
  const [state, setState] = useState<State>({ s: "loading" });

  const fragment = useFragment();

  useEffect(() => {
    if (!fragment) {
      if (!window.location.hash) setState({ s: "invalid" });
      return;
    }
    setReq(null);
    const p = decodePayload<unknown>(fragment);
    if (!isPaymentRequest(p) || p.c !== config.chain.id) return setState({ s: "invalid" });
    setReq(p);
    // Returning cold from a wallet app: resume from what this tab recorded.
    let pending: { hash?: Hash; at: number; via?: "exchange" } | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(pendingKey(p.r)) ?? "null");
    } catch {}
    if (pending) return setState(pending.hash ? { s: "paying", how: "wallet" } : pending.via === "exchange" ? { s: "waiting-exchange" } : { s: "waiting-wallet" });
    if (isExpired(p)) return setState({ s: "expired" });
    setState({ s: "ready" });
  }, [fragment]);

  const amount = req ? BigInt(req.a) : 0n;

  const markPending = useCallback(async (r: PaymentRequest, hash?: Hash, via?: "exchange") => {
    const write = (block?: string) => {
      try {
        sessionStorage.setItem(pendingKey(r.r), JSON.stringify({ hash, at: Date.now(), block, via }));
      } catch {}
    };
    write();
    if (!hash) {
      // Anchor the amount match to the block at hand-off, so an older payment of the same amount never counts.
      const head = await publicClient().getBlockNumber().catch(() => undefined);
      if (head !== undefined) write(head > 2n ? (head - 2n).toString() : "0");
    }
  }, []);

  // Watch for this tab's payment landing: by hash when known, otherwise by amount and time.
  useEffect(() => {
    if (!req || (state.s !== "paying" && state.s !== "waiting-wallet" && state.s !== "waiting-exchange")) return;
    let stop = false;
    const client = publicClient();
    const tokens = config.tokens.map((t) => t.address);
    const tick = async () => {
      let pending: { hash?: Hash; at: number; block?: string; via?: string } | null = null;
      try {
        pending = JSON.parse(sessionStorage.getItem(pendingKey(req.r)) ?? "null");
      } catch {}
      try {
        if (pending?.hash) {
          const r = await client.getTransactionReceipt({ hash: pending.hash }).catch(() => null);
          if (r && !stop) {
            if (r.status === "success") setState({ s: "confirmed", hash: pending.hash });
            else setState({ s: "declined", msg: "The payment was rejected by the network." });
            return;
          }
        } else if (pending) {
          // An exchange withdrawal can take minutes, longer than one log query may span,
          // so read forward from where the last look ended.
          const head = await client.getBlockNumber();
          const from = pending.block ? BigInt(pending.block) : head > 300n ? head - 300n : 0n;
          if (from <= head) {
            const logs = await inChunks(from, head, (a, b) =>
              client.getContractEvents({ address: tokens, abi: erc20Abi, eventName: "Transfer", args: { to: req.t }, fromBlock: a, toBlock: b }),
            );
            const hit = logs.find((l) => l.args.value === amount);
            if (hit && !stop) return setState({ s: "confirmed", hash: hit.transactionHash ?? undefined });
            try {
              sessionStorage.setItem(pendingKey(req.r), JSON.stringify({ ...pending, block: (head + 1n).toString() }));
            } catch {}
          }
        }
      } catch {
        /* offline: keep trying, the payment lands regardless (flow §4.7) */
      }
      if (!stop) setTimeout(tick, pending?.via === "exchange" ? 2000 : 500);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [req, state.s, amount]);

  async function payWithWallet() {
    if (!req) return;
    const eth = window.ethereum;
    if (!eth) {
      // No wallet in this browser: hand off to the phone's wallet app.
      await markPending(req);
      setState({ s: "waiting-wallet" });
      // A wallet app taking over sends this page to the background. Focus alone is
      // not enough: an "open with?" dialog takes focus without any app opening.
      let left = false;
      const away = () => {
        if (document.visibilityState === "hidden") left = true;
      };
      document.addEventListener("visibilitychange", away);
      window.location.href = eip681(req);
      window.setTimeout(() => {
        document.removeEventListener("visibilitychange", away);
        if (!left && document.visibilityState === "visible") {
          try {
            sessionStorage.removeItem(pendingKey(req.r));
          } catch {}
          setState({ s: "no-wallet" });
        }
      }, 2500);
      return;
    }
    setState({ s: "paying", how: "wallet" });
    try {
      const [from] = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
      const chainHex = numberToHex(config.chain.id);
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
      } catch (e) {
        if ((e as { code?: number }).code === 4902) {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [{ chainId: chainHex, chainName: config.chain.name, nativeCurrency: config.chain.nativeCurrency, rpcUrls: [config.rpcUrl] }],
          });
        } else throw e;
      }
      // Check the balance before asking for a signature (flow §4.5).
      const client = publicClient();
      const pick = await pickToken(from, req, amount);
      if ("short" in pick) return setState({ s: "insufficient", balance: pick.short });
      const token = pick.token.address;
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [req.t, amount] });
      const gas = await client.estimateGas({ account: from, to: token, data });
      const hash = (await eth.request({
        method: "eth_sendTransaction",
        params: [{ from, to: token, data, gas: numberToHex(gas) }],
      })) as Hash;
      markPending(req, hash);
      // The watcher effect picks up the receipt.
    } catch (e) {
      const code = (e as { code?: number }).code;
      setState({ s: "declined", msg: code === 4001 ? "You cancelled it in your wallet." : describe(e) });
    }
  }

  async function payWithFace() {
    if (!req) return;
    setState({ s: "paying", how: "face" });
    let secret: Uint8Array | undefined;
    let signer: MeraSigner | undefined;
    try {
      const got = await assertPrfDiscoverable();
      secret = got.secret;
      // Mera signing session for this one payment, ended in the finally below.
      signer = meraSigner(mnemonicFromSecret(secret), 0);
      secret.fill(0);
      const account = signer.account;
      const pick = await pickToken(account.address, req, amount);
      if ("short" in pick) return setState({ s: "insufficient", balance: pick.short });
      await ensureGas(account.address);
      const hash = await sendToken(account, req.t, amount, pick.token.address);
      markPending(req, hash);
      setState({ s: "confirmed", hash });
    } catch (e) {
      if (e instanceof PasskeyError) {
        if (e.kind === "dismissed") return setState({ s: "ready" });
        return setState({ s: "declined", msg: "This phone has no Lane account that can pay. Pay with your wallet instead." });
      }
      setState({ s: "declined", msg: describe(e) });
    } finally {
      signer?.end();
      secret?.fill(0);
    }
  }

  function retry() {
    if (req) {
      try {
        sessionStorage.removeItem(pendingKey(req.r));
      } catch {}
    }
    setState({ s: "ready" });
  }

  // The block when the customer opened the exchange steps: a fast withdrawal can land
  // before they come back to tap "I have sent it", and it must still count.
  const [exchangeFrom, setExchangeFrom] = useState<bigint | null>(null);
  async function openExchange() {
    setState({ s: "exchange" });
    if (exchangeFrom === null) {
      const head = await publicClient().getBlockNumber().catch(() => undefined);
      if (head !== undefined) setExchangeFrom(head > 2n ? head - 2n : 0n);
    }
  }

  async function sentFromExchange() {
    if (!req) return;
    if (exchangeFrom === null) await markPending(req, undefined, "exchange");
    else {
      try {
        sessionStorage.setItem(pendingKey(req.r), JSON.stringify({ at: Date.now(), block: exchangeFrom.toString(), via: "exchange" }));
      } catch {}
    }
    setState({ s: "waiting-exchange" });
  }

  if (state.s === "loading") return <main className="screen" />;

  if (state.s === "invalid" || !req) {
    return (
      <main className="screen">
        <div className="grow" />
        <h1>This code could not be read.</h1>
        <p className="lede mt">Ask the shop to show it again.</p>
        <div className="grow" />
      </main>
    );
  }

  const header = (
    <div className="stack" style={{ gap: 6 }}>
      <p className="tiny">Paying</p>
      <h1>{req.s || "A Lane shop"}</h1>
      <p className="muted">{req.n}</p>
    </div>
  );

  if (state.s === "confirmed") {
    return (
      <main className="screen" style={{ padding: 0 }}>
        <div className="paid-screen" style={{ margin: 0 }} role="status" aria-live="assertive">
          <div className="grow" />
          <p className="paid-word">Paid</p>
          <div className="mt">
            <Amount value={amount} size="xl" />
          </div>
          <p className="lede mt">to {req.s}</p>
          <p className="mt muted">Reference {req.f ? `${req.f} · ` : ""}<span className="num">{req.r}</span></p>
          <div className="grow" />
          <p className="small center">You can close this page.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="screen">
      {header}
      <div className="mt-lg">
        <Amount value={amount} size="xl" />
        {req.f && <p className="mt">{req.f}</p>}
      </div>
      <div className="grow" />

      {state.s === "expired" && (
        <div className="stack">
          <Band kind="warning">
            <p>This request has expired. Ask the shop for a new one.</p>
          </Band>
        </div>
      )}

      {state.s === "no-wallet" && (
        <div className="stack">
          <Band kind="warning">
            <p>No wallet app opened on this phone. You can pay from a wallet on another device by sending exactly {formatAmount(amount)} {config.tokens.map((t) => t.symbol).join(" or ")} on {config.chain.name} to this till.</p>
          </Band>
          <p className="small num" style={{ wordBreak: "break-all" }}>
            {req.t}
          </p>
          <button className="btn btn-outline" onClick={() => navigator.clipboard?.writeText(req.t)}>
            Copy the till&rsquo;s address
          </button>
          <button className="btn btn-outline" onClick={payWithFace}>
            Pay with your face
          </button>
          <button className="btn btn-text" onClick={retry}>
            Try your wallet again
          </button>
        </div>
      )}

      {state.s === "insufficient" && (
        <div className="stack">
          <Band kind="warning">
            <p>
              Your balance is <span className="num">{formatAmount(state.balance)}</span>, which is not enough for this payment. Nothing was sent.
            </p>
          </Band>
          <button className="btn btn-outline" onClick={retry}>
            Try a different way
          </button>
        </div>
      )}

      {state.s === "declined" && (
        <div className="stack">
          <Band kind="error">
            <p>The payment did not go through. {state.msg}</p>
          </Band>
          <button className="btn btn-primary btn-xl" onClick={retry}>
            Try again
          </button>
        </div>
      )}

      {state.s === "exchange" && <ExchangeSteps req={req} amount={amount} onSent={sentFromExchange} onBack={retry} />}

      {state.s === "waiting-exchange" && (
        <div className="stack">
          <p className="statusline center" aria-live="polite">
            Waiting for your exchange. A withdrawal can take a few minutes. This page updates when the money lands.
          </p>
          <p className="small muted center">If your exchange took its fee out of the amount, the shop&rsquo;s screen shows what arrived.</p>
          <button className="btn btn-text" onClick={() => setState({ s: "exchange" })}>
            See the details again
          </button>
        </div>
      )}

      {(state.s === "paying" || state.s === "waiting-wallet") && (
        <div className="stack">
          <p className="statusline center" aria-live="polite">
            {state.s === "waiting-wallet" ? "Approve the payment in your wallet. This page will update when it lands." : state.how === "face" ? "Paying" : "Waiting for your wallet"}
          </p>
          {state.s === "waiting-wallet" && (
            <button className="btn btn-text" onClick={retry}>
              Start again
            </button>
          )}
        </div>
      )}

      {state.s === "ready" && (
        <div className="stack">
          <button className="btn btn-primary btn-xl" onClick={payWithWallet}>
            Pay {formatAmount(amount)} with your wallet
          </button>
          {EXCHANGE_PAY && (
            <button className="btn btn-outline" onClick={openExchange}>
              Pay from an exchange app
            </button>
          )}
          <button className="btn btn-outline" onClick={payWithFace}>
            Pay with your face
          </button>
          <p className="small muted center">Pay with your face if you have used Lane before.</p>
        </div>
      )}
    </main>
  );
}

function CopyRow({ label, value, shown }: { label: string; value: string; shown?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="list-row static" style={{ alignItems: "center", gap: 12 }}>
      <span className="stack" style={{ gap: 2, minWidth: 0 }}>
        <span className="small muted">{label}</span>
        <span className="num" style={{ wordBreak: "break-all" }}>
          {shown ?? value}
        </span>
      </span>
      <button
        className="btn btn-outline"
        style={{ width: "auto", minHeight: 40, flexShrink: 0 }}
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Paying from an exchange account: a withdrawal on the Monad network straight to this till. */
function ExchangeSteps({ req, amount, onSent, onBack }: { req: PaymentRequest; amount: bigint; onSent: () => void; onBack: () => void }) {
  const coins = config.tokens.map((t) => t.symbol.replace(/0$/, "")).join(" or ");
  return (
    <div className="stack" style={{ gap: 16 }}>
      <h2>Pay from an exchange app</h2>
      <p className="small">In an exchange that sends on the {config.chain.name} network, such as Bybit, choose Withdraw, then {coins}, and fill in:</p>
      <div className="list">
        <CopyRow label="Network" value={config.chain.name} />
        <CopyRow label="Address" value={req.t} />
        <CopyRow label="Amount the shop must receive" value={formatAmount(amount).replace(/,/g, "")} />
      </div>
      <Band kind="warning">
        <p className="small">
          Choose the {config.chain.name} network only: money sent on another network will not reach the shop. If your exchange takes its fee out of the amount, add the fee so that {formatAmount(amount)} arrives.
        </p>
      </Band>
      <button className="btn btn-primary btn-xl" onClick={onSent}>
        I have sent it
      </button>
      <button className="btn btn-text" onClick={onBack}>
        Back
      </button>
    </div>
  );
}
