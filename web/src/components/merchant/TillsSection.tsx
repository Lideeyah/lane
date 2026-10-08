"use client";
import { useEffect, useState } from "react";
import { Band, Field } from "../ui";
import { QR } from "../QR";
import { formatAmount } from "@/lib/format";
import { PasskeyError } from "@/lib/passkey";
import { addTill, getActiveTill, renameTillLocal, setActiveTill } from "@/lib/shop";
import { pairingLink } from "@/lib/staff";
import { displayCode, PAIR_TTL_SECONDS } from "@/lib/pairing";
import { shopStore, type Shop, type Till } from "@/lib/storage";
import { describe } from "@/lib/tx";
import { todays, total, type LedgerState } from "@/lib/useLedger";

export function TillsSection({ shop, ledger, onUse }: { shop: Shop; ledger: LedgerState; onUse: () => void }) {
  const [open, setOpen] = useState<Till | null>(null);
  const [adding, setAdding] = useState(false);
  const active = getActiveTill(shop);
  const today = todays(ledger.ledger?.entries ?? []);

  if (open) {
    const fresh = shop.tills.find((t) => t.address === open.address) ?? open;
    return <TillDetail shop={shop} till={fresh} onBack={() => setOpen(null)} onUse={() => (setActiveTill(fresh.address), onUse())} />;
  }
  if (adding) return <AddTill onDone={() => setAdding(false)} />;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <h2>Tills</h2>
      <div className="list">
        {shop.tills.map((t) => {
          const tt = today.filter((e) => e.till.toLowerCase() === t.address.toLowerCase());
          return (
            <button key={t.address} className={`list-row${t.address === active.address ? " selected" : ""}`} onClick={() => setOpen(t)}>
              <span className="stack" style={{ gap: 2 }}>
                <span style={{ fontWeight: 600 }}>{t.label}</span>
                <span className="small muted">
                  {t.address === active.address ? "On this phone" : t.pairedAt ? "Handed to staff" : "Not in use"}
                  {!t.registered && " · Finishing setup"}
                </span>
              </span>
              <span className="stack" style={{ gap: 2, textAlign: "right" }}>
                <span className="num" style={{ fontWeight: 600 }}>
                  {ledger.ledger && !ledger.ledger.catchingUp ? formatAmount(total(tt)) : "—"}
                </span>
                <span className="small muted">today</span>
              </span>
            </button>
          );
        })}
      </div>
      <button className="btn btn-outline" onClick={() => setAdding(true)}>
        Add a till
      </button>
    </div>
  );
}

function AddTill({ onDone }: { onDone: () => void }) {
  const shop = shopStore.get();
  const [name, setName] = useState(`Till ${(shop?.tills.reduce((m, t) => Math.max(m, t.index), 0) ?? 0) + 1}`);
  const [state, setState] = useState<{ s: "idle" } | { s: "working" } | { s: "error"; msg: string }>({ s: "idle" });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ s: "working" });
    try {
      await addTill(name);
      onDone();
    } catch (err) {
      if (err instanceof PasskeyError && err.kind === "dismissed") return setState({ s: "idle" });
      setState({ s: "error", msg: describe(err) });
    }
  }
  return (
    <form className="stack" style={{ gap: 20 }} onSubmit={submit}>
      <button type="button" className="btn btn-text" style={{ justifyContent: "flex-start", padding: 0, width: "auto" }} onClick={onDone}>
        Back
      </button>
      <h2>Add a till</h2>
      <Field label="Till name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} autoFocus />
      </Field>
      <p className="small muted">Your fingerprint confirms the new till.</p>
      {state.s === "error" && (
        <Band kind="error">
          <p>The till was saved on this phone and will finish setting up later. {state.msg}</p>
        </Band>
      )}
      <button className="btn btn-primary btn-xl" disabled={!name.trim() || state.s === "working"}>
        {state.s === "working" ? "Adding" : "Add till"}
      </button>
    </form>
  );
}

function TillDetail({ shop, till, onBack, onUse }: { shop: Shop; till: Till; onBack: () => void; onUse: () => void }) {
  const [label, setLabel] = useState(till.label);
  const [pairing, setPairing] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const link = pairingLink({ till: till.address, label: till.label, shop: shop.name }, origin);

  function save() {
    if (label.trim() && label.trim() !== till.label) renameTillLocal(till.address, label);
  }
  function handToStaff() {
    shopStore.update((s) => ({ ...s, tills: s.tills.map((t) => (t.address === till.address ? { ...t, pairedAt: Date.now() } : t)) }));
    setPairing(true);
  }
  function unpair() {
    shopStore.update((s) => ({ ...s, tills: s.tills.map((t) => (t.address === till.address ? { ...t, pairedAt: undefined } : t)) }));
    setPairing(false);
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <button className="btn btn-text" style={{ justifyContent: "flex-start", padding: 0, width: "auto" }} onClick={onBack}>
        Back
      </button>
      <h2>{till.label}</h2>
      <Field label="Name">
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={save} maxLength={32} />
      </Field>
      <button className="btn btn-outline" onClick={onUse}>
        Use this till on this phone
      </button>

      {pairing ? (
        <div className="stack">
          <h3>Hand {till.label} to staff</h3>
          <p>
            On the staff phone, go to <span className="num">{origin.replace(/^https?:\/\//, "")}/staff</span> and type this code. That phone will be able to take payments into {till.label}. It will never hold a key and can never move money.
          </p>
          <ShortCode shop={shop} till={till} />
          <p className="small muted mt">Or scan this with the staff phone&rsquo;s camera.</p>
          {origin && <QR value={link} label={`Pairing code for ${till.label}`} />}
          <button className="btn btn-outline" onClick={() => navigator.clipboard?.writeText(link)}>
            Copy pairing link
          </button>
          <button className="btn btn-text" onClick={() => setPairing(false)}>
            Hide code
          </button>
        </div>
      ) : (
        <button className="btn btn-outline" onClick={handToStaff}>
          Hand to staff
        </button>
      )}

      {till.pairedAt && (
        <div className="stack">
          <p className="small">Handed to staff. To take it back, unpair it here and tap Unpair this phone on the staff phone. The till keeps every sale it has taken.</p>
          <button className="btn btn-outline" onClick={unpair}>
            Unpair staff phone
          </button>
        </div>
      )}
    </div>
  );
}

type CodeState = { s: "loading" } | { s: "ready"; code: string; expiresAt: number } | { s: "expired" } | { s: "error"; msg: string };

/** Six digits the staff member types. One-time, ten minutes, issued by the server. */
function ShortCode({ shop, till }: { shop: Shop; till: Till }) {
  const [state, setState] = useState<CodeState>({ s: "loading" });
  const [now, setNow] = useState(() => Date.now());

  async function issue() {
    setState({ s: "loading" });
    try {
      const res = await fetch("/api/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ till: till.address, label: till.label, shop: shop.name }),
      });
      const json = (await res.json()) as { ok: boolean; code?: string; expiresAt?: number; error?: string };
      if (!json.ok || !json.code || !json.expiresAt) return setState({ s: "error", msg: json.error ?? "Could not make a code." });
      setState({ s: "ready", code: json.code, expiresAt: json.expiresAt });
    } catch {
      setState({ s: "error", msg: "No connection. Use the QR code below." });
    }
  }

  useEffect(() => {
    void issue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [till.address]);

  useEffect(() => {
    if (state.s !== "ready") return;
    const t = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= state.expiresAt) setState({ s: "expired" });
    }, 1000);
    return () => window.clearInterval(t);
  }, [state]);

  if (state.s === "loading") return <p className="statusline">Making a code.</p>;
  if (state.s === "error")
    return (
      <Band kind="warning">
        <p>{state.msg}</p>
      </Band>
    );
  if (state.s === "expired")
    return (
      <div className="stack">
        <p className="statusline">That code has expired.</p>
        <button className="btn btn-outline" onClick={issue}>
          Make a new code
        </button>
      </div>
    );
  // Capped at the full lifetime, since this phone's clock may run slightly behind the server's.
  const left = Math.min(PAIR_TTL_SECONDS, Math.max(0, Math.ceil((state.expiresAt - now) / 1000)));
  return (
    <div className="stack center" style={{ gap: 6, padding: "12px 0" }}>
      <p className="amount-display" style={{ fontSize: 52, letterSpacing: "0.08em" }} aria-label={`Pairing code ${state.code.split("").join(" ")}`}>
        {displayCode(state.code)}
      </p>
      <p className="small muted">
        Works once. Expires in <span className="num">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>
      </p>
    </div>
  );
}
