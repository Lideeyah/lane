"use client";
import type { Address } from "viem";
import { deriveAccount, mnemonicFromSecret, OWNER_INDEX, withSigner, type SigningSession } from "./accounts";
import { requestDrip } from "./drip-client";
import { registeredTills } from "./ledger";
import { assertPrfDiscoverable, createPasskey } from "./passkey";
import { shopStore, type Shop, type Till } from "./storage";
import { registerTillOnChain, relabelTillOnChain, describe } from "./tx";

/**
 * Shop orchestration: creation, restore, and keeping the on-chain registry in
 * step with the device. Registration is never on the critical path of taking
 * a payment, so anything that fails here is retried on the next signed action.
 */

export interface Till_ extends Till {
  /** Label last written on chain, when it differs from `label` a relabel is pending. */
  chainLabel?: string;
}

export type SetupProgress = "funding" | "registering" | "ready" | "deferred";

/**
 * Create the passkey, derive the owner and first till, and in the background
 * fund the owner and register Till 1. The key lives only inside this one
 * function's scope and is zeroed when the background registration settles.
 */
export async function createShop(onProgress: (p: SetupProgress) => void): Promise<Shop> {
  const { credentialId, secret } = await createPasskey();
  const mnemonic = mnemonicFromSecret(secret);
  const owner = deriveAccount(mnemonic, OWNER_INDEX);
  const till1 = deriveAccount(mnemonic, 1);
  const shop: Shop = {
    version: 1,
    credentialId,
    owner: owner.address,
    name: "",
    tills: [{ index: 1, address: till1.address, label: "Till 1", registered: false }],
    createdAt: Date.now(),
  };
  shopStore.set(shop);

  void (async () => {
    try {
      onProgress("funding");
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        const drip = await requestDrip(owner.address);
        if (!drip.ok) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        onProgress("registering");
        try {
          // Use whatever label the merchant has typed by now.
          const label = shopStore.get()?.tills.find((t) => t.index === 1)?.label ?? "Till 1";
          await registerTillOnChain(owner, till1.address, label);
          markRegistered(till1.address, label);
          ok = true;
        } catch {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      onProgress(ok ? "ready" : "deferred");
    } finally {
      secret.fill(0);
    }
  })();

  return shop;
}

function markRegistered(address: Address, label: string) {
  shopStore.update((s) => ({
    ...s,
    tills: s.tills.map((t) => (t.address === address ? ({ ...t, registered: true, chainLabel: label } as Till_) : t)),
  }));
}

/**
 * Sign in on another phone with the same passkey. Tills come back from the
 * registry; Till 1 is always restored even if it was never registered.
 */
export async function restoreShop(name: string): Promise<Shop> {
  const { credentialId, secret } = await assertPrfDiscoverable();
  try {
    const mnemonic = mnemonicFromSecret(secret);
    const owner = deriveAccount(mnemonic, OWNER_INDEX).address;
    let onChain: { address: Address; label: string; retired: boolean }[] = [];
    try {
      onChain = await registeredTills(owner);
    } catch {
      /* offline: Till 1 alone, registry is reread later */
    }
    const want = new Map(onChain.map((t) => [t.address.toLowerCase(), t]));
    const tills: Till_[] = [];
    const scan = Math.max(20, onChain.length + 10);
    for (let i = 1; i <= scan; i++) {
      const addr = deriveAccount(mnemonic, i).address;
      const hit = want.get(addr.toLowerCase());
      if (hit && !hit.retired) tills.push({ index: i, address: addr, label: hit.label || `Till ${i}`, registered: true, chainLabel: hit.label });
      else if (i === 1 && !hit) tills.push({ index: 1, address: addr, label: "Till 1", registered: false });
    }
    const shop: Shop = { version: 1, credentialId, owner, name: name.trim(), tills, createdAt: Date.now() };
    shopStore.set(shop);
    return shop;
  } finally {
    secret.fill(0);
  }
}

/** Register or relabel any tills the chain does not yet know about, inside an open session. */
export async function syncRegistry(session: SigningSession): Promise<void> {
  const shop = shopStore.get();
  if (!shop) return;
  const owner = session.account(OWNER_INDEX);
  for (const t of shop.tills as Till_[]) {
    try {
      if (!t.registered) {
        await registerTillOnChain(owner, t.address, t.label);
        markRegistered(t.address, t.label);
      } else if (t.chainLabel !== undefined && t.chainLabel !== t.label) {
        await relabelTillOnChain(owner, t.address, t.label);
        markRegistered(t.address, t.label);
      }
    } catch (e) {
      console.warn("registry sync deferred", describe(e));
    }
  }
}

export function nextTillIndex(shop: Shop): number {
  return shop.tills.reduce((m, t) => Math.max(m, t.index), 0) + 1;
}

/** One biometric prompt: derive the next till and register it. */
export async function addTill(label: string): Promise<Till> {
  const shop = shopStore.get();
  if (!shop) throw new Error("No shop on this device");
  const index = nextTillIndex(shop);
  return withSigner(shop.credentialId, async (session) => {
    const acct = session.account(index);
    const till: Till_ = { index, address: acct.address, label: label.trim() || `Till ${index}`, registered: false };
    shopStore.update((s) => ({ ...s, tills: [...s.tills, till] }));
    await syncRegistry(session);
    return shopStore.get()!.tills.find((t) => t.index === index)!;
  });
}

export function renameTillLocal(address: Address, label: string) {
  shopStore.update((s) => ({ ...s, tills: s.tills.map((t) => (t.address === address ? { ...t, label: label.trim() || t.label } : t)) }));
}

export function setActiveTill(address: Address) {
  try {
    localStorage.setItem("lane.activeTill", address);
    window.dispatchEvent(new CustomEvent("lane:storage", { detail: "activeTill" }));
  } catch {}
}

export function getActiveTill(shop: Shop): Till {
  let a: string | null = null;
  try {
    a = localStorage.getItem("lane.activeTill");
  } catch {}
  return shop.tills.find((t) => t.address === a) ?? shop.tills[0];
}
