"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Counter } from "@/components/Counter";
import { LedgerSection } from "@/components/merchant/LedgerSection";
import { RefundSheet, type RefundTarget } from "@/components/merchant/RefundSheet";
import { SaleDetail } from "@/components/merchant/SaleDetail";
import { Recovery, SettingsSection } from "@/components/merchant/SettingsSection";
import { SweepSheet } from "@/components/merchant/SweepSheet";
import { TillsSection } from "@/components/merchant/TillsSection";
import { useShop } from "@/lib/hooks";
import type { LedgerEntry } from "@/lib/ledger";
import { getActiveTill } from "@/lib/shop";
import { useLedger } from "@/lib/useLedger";

type Tab = "till" | "tills" | "ledger" | "settings";

export default function TillHome() {
  const router = useRouter();
  const { shop, ready } = useShop();
  const [tab, setTab] = useState<Tab>("till");
  const [sale, setSale] = useState<LedgerEntry | null>(null);
  const [refund, setRefund] = useState<RefundTarget | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!shop) router.replace("/start");
    else if (!shop.name) router.replace("/start");
  }, [ready, shop, router]);

  const tillAddrs = useMemo(() => shop?.tills.map((t) => t.address) ?? [], [shop]);
  const ledger = useLedger(tillAddrs, shop?.owner);

  if (!shop || !shop.name) return <main className="screen" />;
  const active = getActiveTill(shop);

  const refundsOf = (id: string) => (ledger.ledger?.entries ?? []).filter((e) => e.refundOf === id);

  return (
    <main className="screen">
      {tab === "till" && (
        <Counter
          key={active.address}
          till={active}
          shopName={shop.name}
          header={
            <div className="row between small">
              <button className="btn btn-text" style={{ width: "auto", padding: 0, minHeight: 32, textDecoration: "none", fontWeight: 600 }} onClick={() => setTab("tills")}>
                {active.label}
              </button>
              <span className="muted">{shop.name}</span>
            </div>
          }
          onRefundDifference={({ payer, amount, saleId }) => setRefund({ saleId, till: active.address, payer, amount, max: amount })}
        />
      )}
      {tab === "tills" && <TillsSection shop={shop} ledger={ledger} onUse={() => setTab("till")} />}
      {tab === "ledger" && <LedgerSection shop={shop} state={ledger} onOpen={setSale} onSweep={() => setSweeping(true)} onRecovery={() => setRecovery(true)} />}
      {tab === "settings" && <SettingsSection shop={shop} onTills={() => setTab("tills")} />}

      {tab !== "till" && <div className="grow" style={{ minHeight: 24 }} />}
      <nav className="tabs" aria-label="Sections">
        {(["till", "tills", "ledger", "settings"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>
            {t === "till" ? "Pad" : t === "tills" ? "Tills" : t === "ledger" ? "Ledger" : "Settings"}
          </button>
        ))}
      </nav>

      {sale && !refund && (
        <SaleDetail
          entry={sale}
          tills={shop.tills}
          refunds={refundsOf(sale.id)}
          onBack={() => setSale(null)}
          onRefund={() => {
            const already = refundsOf(sale.id).reduce((s, r) => s - r.amount, 0n);
            const max = sale.amount - already;
            setRefund({ saleId: sale.id, till: sale.till, payer: sale.counterparty, amount: max, max });
          }}
        />
      )}
      {refund && (
        <RefundSheet
          shop={shop}
          target={refund}
          onClose={() => {
            setRefund(null);
            setSale(null);
            ledger.refresh();
          }}
        />
      )}
      {sweeping && <SweepSheet shop={shop} ledger={ledger} onClose={() => setSweeping(false)} />}
      {recovery && (
        <div className="sheet">
          <main className="screen">
            <Recovery shop={shop} onBack={() => setRecovery(false)} />
          </main>
        </div>
      )}
    </main>
  );
}
