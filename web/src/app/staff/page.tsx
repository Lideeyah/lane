"use client";
import { useEffect, useMemo, useState } from "react";
import { Counter } from "@/components/Counter";
import { LedgerSection } from "@/components/merchant/LedgerSection";
import { SaleDetail } from "@/components/merchant/SaleDetail";
import { Band, Field } from "@/components/ui";
import type { LedgerEntry } from "@/lib/ledger";
import { parsePairing } from "@/lib/staff";
import { staffStore, type Shop, type StaffPairing } from "@/lib/storage";
import { useLedger } from "@/lib/useLedger";

/**
 * A staff phone: one till, its sales today, and nothing else. It holds the
 * till's public address and label. It never holds a key and cannot move money.
 */
export default function Staff() {
  const [pairing, setPairing] = useState<StaffPairing | null>(null);
  const [ready, setReady] = useState(false);
  const [link, setLink] = useState("");
  const [bad, setBad] = useState(false);
  const [tab, setTab] = useState<"pad" | "sales">("pad");
  const [sale, setSale] = useState<LedgerEntry | null>(null);

  function adopt(fragment: string): boolean {
    const p = parsePairing(fragment);
    if (!p) return false;
    const rec: StaffPairing = { version: 1, till: p.t, label: p.n, shop: p.s, pairedAt: Date.now() };
    staffStore.set(rec);
    setPairing(rec);
    return true;
  }

  useEffect(() => {
    if (window.location.hash && adopt(window.location.hash)) {
      // Keep the pairing payload out of history and screenshots of the address bar.
      history.replaceState(null, "", "/staff");
    } else {
      setPairing(staffStore.get());
    }
    setReady(true);
  }, []);

  const fakeShop: Shop | null = useMemo(
    () =>
      pairing
        ? { version: 1, credentialId: "", owner: "0x0000000000000000000000000000000000000000", name: pairing.shop, createdAt: 0, tills: [{ index: 0, address: pairing.till, label: pairing.label, registered: true }] }
        : null,
    [pairing],
  );
  const tills = useMemo(() => (pairing ? [pairing.till] : []), [pairing]);
  const ledger = useLedger(tills);

  if (!ready) return <main className="screen" />;

  if (!pairing || !fakeShop) {
    return (
      <main className="screen">
        <form
          className="stack grow"
          style={{ gap: 20 }}
          onSubmit={(e) => {
            e.preventDefault();
            const hash = link.includes("#") ? link.slice(link.indexOf("#")) : link;
            setBad(!adopt(hash));
          }}
        >
          <h1>Take payments for a shop</h1>
          <p className="lede">Ask the owner to open the till in Lane and tap Hand to staff. Scan their code with this phone&rsquo;s camera, or paste the pairing link here.</p>
          <Field label="Pairing link">
            <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste the link" autoComplete="off" />
          </Field>
          {bad && (
            <Band kind="error">
              <p>That link could not be read. Ask the owner to show the code again.</p>
            </Band>
          )}
          <div className="grow" />
          <button className="btn btn-primary btn-xl" disabled={!link.trim()}>
            Pair this phone
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="screen">
      {tab === "pad" ? (
        <Counter
          till={{ address: pairing.till, label: pairing.label }}
          shopName={pairing.shop}
          header={
            <div className="row between small">
              <span style={{ fontWeight: 600 }}>{pairing.label}</span>
              <span className="muted">{pairing.shop}</span>
            </div>
          }
        />
      ) : (
        <div className="stack grow" style={{ gap: 20 }}>
          <div className="row between small">
            <span style={{ fontWeight: 600 }}>{pairing.label}</span>
            <span className="muted">{pairing.shop}</span>
          </div>
          <LedgerSection shop={fakeShop} state={ledger} onOpen={setSale} only={pairing.till} />
          <div className="grow" />
          <button
            className="btn btn-text"
            onClick={() => {
              staffStore.clear();
              setPairing(null);
            }}
          >
            Unpair this phone
          </button>
        </div>
      )}
      <nav className="tabs" style={{ gridTemplateColumns: "1fr 1fr" }} aria-label="Sections">
        <button className={tab === "pad" ? "active" : ""} onClick={() => setTab("pad")}>
          Pad
        </button>
        <button className={tab === "sales" ? "active" : ""} onClick={() => setTab("sales")}>
          Sales today
        </button>
      </nav>
      {sale && <SaleDetail entry={sale} tills={fakeShop.tills} refunds={[]} onBack={() => setSale(null)} />}
    </main>
  );
}
