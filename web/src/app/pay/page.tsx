"use client";
import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, numberToHex, type Address, type Hash } from "viem";
import { Amount, Band } from "@/components/ui";
import { erc20Abi } from "@/lib/abi";
import { deriveAccount, mnemonicFromSecret } from "@/lib/accounts";
import { config, publicClient } from "@/lib/chain";
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
  | { s: "confirmed"; hash?: Hash }
  | { s: "declined"; msg?: string }
  | { s: "insufficient"; balance: bigint }
  | { s: "no-wallet" };

const pendingKey = (r: string) => `lane.pay.${r}`;

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
    let pending: { hash?: Hash; at: number } | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(pendingKey(p.r)) ?? "null");
    } catch {}
    if (pending) return setState(pending.hash ? { s: "paying", how: "wallet" } : { s: "waiting-wallet" });
    if (isExpired(p)) return setState({ s: "expired" });
    setState({ s: "ready" });
  }, [fragment]);

  const amount = req ? BigInt(req.a) : 0n;

  const markPending = useCallback(async (r: PaymentRequest, hash?: Hash) => {
    const write = (block?: string) => {
      try {
        sessionStorage.setItem(pendingKey(r.r), JSON.stringify({ hash, at: Date.now(), block }));
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
    if (!req || (state.s !== "paying" && state.s !== "waiting-wallet")) return;
    let stop = false;
    const client = publicClient();
    const tick = async () => {
      let pending: { hash?: Hash; at: number; block?: string } | null = null;
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
          const head = await client.getBlockNumber();
          const logs = await client.getContractEvents({
            address: req.k,
            abi: erc20Abi,
            eventName: "Transfer",
            args: { to: req.t },
            fromBlock: pending.block ? BigInt(pending.block) : head > 300n ? head - 300n : 0n,
          });
          const hit = logs.find((l) => l.args.value === amount);
          if (hit && !stop) return setState({ s: "confirmed", hash: hit.transactionHash ?? undefined });
        }
      } catch {
        /* offline: keep trying, the payment lands regardless (flow §4.7) */
      }
      if (!stop) setTimeout(tick, 1200);
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
      const balance = await client.readContract({ address: req.k, abi: erc20Abi, functionName: "balanceOf", args: [from] });
      if (balance < amount) return setState({ s: "insufficient", balance });
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [req.t, amount] });
      const gas = await client.estimateGas({ account: from, to: req.k, data });
      const hash = (await eth.request({
        method: "eth_sendTransaction",
        params: [{ from, to: req.k, data, gas: numberToHex(gas) }],
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
    try {
      const got = await assertPrfDiscoverable();
      secret = got.secret;
      const account = deriveAccount(mnemonicFromSecret(secret), 0);
      secret.fill(0);
      const client = publicClient();
      const balance = await client.readContract({ address: req.k, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
      if (balance < amount) return setState({ s: "insufficient", balance });
      await ensureGas(account.address);
      const hash = await sendToken(account, req.t, amount);
      markPending(req, hash);
      setState({ s: "confirmed", hash });
    } catch (e) {
      if (e instanceof PasskeyError) {
        if (e.kind === "dismissed") return setState({ s: "ready" });
        return setState({ s: "declined", msg: "This phone has no Lane account that can pay. Pay with your wallet instead." });
      }
      setState({ s: "declined", msg: describe(e) });
    } finally {
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
            <p>No wallet app opened on this phone. You can pay from a wallet on another device by sending exactly {formatAmount(amount)} {config.token.symbol} to this till.</p>
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
          <button className="btn btn-outline" onClick={payWithFace}>
            Pay with your face
          </button>
          <p className="small muted center">Pay with your face if you have used Lane before.</p>
        </div>
      )}
    </main>
  );
}
