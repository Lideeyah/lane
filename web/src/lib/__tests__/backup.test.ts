import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { WebAuthnClient } from "@category-labs/mera";
import { backUpRecords, mergeSales, restoreRecords } from "../backup";
import { checkPut, type StoredBackup } from "../backupServer";
import { toBase64Url } from "../passkey";
import { backupStore, salesStore, type SaleRecord, type Shop } from "../storage";

/* A phone: in-memory localStorage behind a minimal window. */
function newPhone() {
  const mem = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    location: { hostname: "lane.test" },
    localStorage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    },
    dispatchEvent: () => true,
  };
  return mem;
}

/* A passkey: PRF output is HMAC(secret, salt), like the authenticator's. Records each salt it is asked for. */
const credentialBytes = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
function passkey(secret: string) {
  const salts: string[] = [];
  const client: WebAuthnClient = {
    createCredential: async () => {
      throw new Error("not used");
    },
    getCredential: async (req) => {
      salts.push(toBase64Url(req.prfSalt));
      return { credentialId: credentialBytes, prfOutput: new Uint8Array(createHmac("sha256", secret).update(req.prfSalt).digest()) };
    },
  };
  return { client, salts };
}

/* Lane's server: the real put rules over a Map. */
function server() {
  const db = new Map<string, StoredBackup>();
  const f = (async (url: string, init?: RequestInit) => {
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (init?.method === "PUT") {
      const raw = String(init.body);
      const first = checkPut(raw, null);
      if (!first.ok) return json(first.status, first);
      const check = checkPut(raw, db.get(first.credentialId) ?? null);
      if (!check.ok) return json(check.status, check);
      db.set(check.credentialId, { vault: check.vault, th: check.th, at: Date.now() });
      return json(200, { ok: true });
    }
    const c = new URL(url, "https://lane.test").searchParams.get("c")!;
    const stored = db.get(c);
    return stored ? json(200, { ok: true, vault: stored.vault }) : json(404, { ok: false });
  }) as typeof fetch;
  return { db, fetch: f };
}

const shop: Shop = {
  version: 1,
  credentialId: toBase64Url(credentialBytes),
  owner: "0x0000000000000000000000000000000000000001",
  name: "Ama's Kiosk",
  tills: [],
  createdAt: 0,
};
const sale: SaleRecord = {
  id: "0xabc:0",
  txHash: "0xabc",
  till: "0x0000000000000000000000000000000000000002",
  payer: "0x0000000000000000000000000000000000000003",
  amount: "4500000",
  time: 1,
  kind: "exact",
  requestId: "r1",
  reference: "Two jollof rice",
  requestedAmount: "4500000",
};

describe("records backup (Mera secret vault)", () => {
  beforeEach(() => void newPhone());

  it("restores a phone's records on a new phone with the same passkey", async () => {
    const pk = passkey("passkey-1");
    const srv = server();
    salesStore.put(sale);
    const r = await backUpRecords(shop, { webAuthnClient: pk.client, fetch: srv.fetch });
    expect(r.sales).toBe(1);
    // Lane's server holds ciphertext only.
    expect(JSON.stringify([...srv.db.values()])).not.toContain("jollof");

    newPhone();
    expect(salesStore.get(sale.id)).toBeUndefined();
    const back = await restoreRecords(shop, { webAuthnClient: pk.client, fetch: srv.fetch });
    expect(back?.sales).toBe(1);
    expect(salesStore.get(sale.id)?.reference).toBe("Two jollof rice");
    expect(backupStore.get()?.token).toBeTruthy();
  });

  it("encrypts under a PRF salt of its own, never the account salt", async () => {
    const pk = passkey("passkey-1");
    const srv = server();
    salesStore.put(sale);
    await backUpRecords(shop, { webAuthnClient: pk.client, fetch: srv.fetch });
    await backUpRecords(shop, { webAuthnClient: pk.client, fetch: srv.fetch });
    const accountSalt = toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("lane.account.v1"))));
    expect(pk.salts).toHaveLength(2);
    expect(pk.salts).not.toContain(accountSalt);
    expect(pk.salts[0]).not.toBe(pk.salts[1]); // a fresh salt per backup
  });

  it("cannot be read with a different passkey", async () => {
    const srv = server();
    salesStore.put(sale);
    await backUpRecords(shop, { webAuthnClient: passkey("passkey-1").client, fetch: srv.fetch });
    newPhone();
    await expect(restoreRecords(shop, { webAuthnClient: passkey("someone-else").client, fetch: srv.fetch })).rejects.toThrow(
      "different passkey",
    );
    expect(salesStore.get(sale.id)).toBeUndefined();
  });

  it("can only be replaced by a phone holding its write token", async () => {
    const pk = passkey("passkey-1");
    const srv = server();
    salesStore.put(sale);
    await backUpRecords(shop, { webAuthnClient: pk.client, fetch: srv.fetch });

    newPhone(); // no token yet
    await expect(backUpRecords(shop, { webAuthnClient: pk.client, fetch: srv.fetch })).rejects.toThrow("Restore it here first");
    await restoreRecords(shop, { webAuthnClient: pk.client, fetch: srv.fetch });
    await expect(backUpRecords(shop, { webAuthnClient: pk.client, fetch: srv.fetch })).resolves.toMatchObject({ sales: 1 });
  });

  it("lets the backup's matching win, and keeps records only this phone has", () => {
    const bare: SaleRecord = { ...sale, kind: "unmatched", requestId: undefined, reference: undefined, requestedAmount: undefined };
    const other: SaleRecord = { ...sale, id: "0xdef:0", txHash: "0xdef" };
    const merged = mergeSales({ [bare.id]: bare, [other.id]: other }, { [sale.id]: sale });
    expect(merged[sale.id]).toMatchObject({ kind: "exact", reference: "Two jollof rice" });
    expect(merged[other.id]).toEqual(other);
  });
});
