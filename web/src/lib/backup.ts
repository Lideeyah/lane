import {
  createSecretVaultWithExistingPasskey,
  decryptSecretVaultWithPasskey,
  isMeraError,
  parseSecretVault,
  type PasskeySecretVault,
  type WebAuthnClient,
} from "@category-labs/mera";
import { classify, ensureEnvironment, PasskeyError, toBase64Url } from "./passkey";
import { backupStore, salesStore, shopStore, type SaleRecord, type Shop } from "./storage";

/**
 * Encrypted backup of the records that exist only on the owner's phone: what was
 * sold, and which payment matched which request. The chain has every transfer,
 * but not these, so without a backup a new phone shows the money and loses the
 * story behind it.
 *
 * This is the passkey's non-account work. The account keys come from the PRF
 * output for Lane's account salt (passkey.ts). Each backup is a Mera secret
 * vault: Mera evaluates the same passkey's PRF under a fresh random salt and
 * derives an AES-256-GCM key from it, so the encryption key is unrelated to any
 * account key. Lane's server stores the vault and cannot read it.
 *
 * A backup is found by the passkey's credential id. Replacing it needs a write
 * token, which lives on the phone and inside the encrypted backup, so a phone
 * that restores the backup can also replace it, and nobody else can.
 */

export const BACKUP_VERSION = 1;

export interface RecordsBackup {
  v: typeof BACKUP_VERSION;
  token: string;
  savedAt: number;
  name: string;
  sales: Record<string, SaleRecord>;
}

export function newToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function encodeBackup(b: RecordsBackup): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(b));
}

export function decodeBackup(bytes: Uint8Array): RecordsBackup {
  const b = JSON.parse(new TextDecoder().decode(bytes)) as Partial<RecordsBackup>;
  if (b?.v !== BACKUP_VERSION || typeof b.token !== "string" || typeof b.sales !== "object" || !b.sales) {
    throw new Error("This backup is not one Lane can read.");
  }
  return { v: BACKUP_VERSION, token: b.token, savedAt: Number(b.savedAt) || 0, name: String(b.name ?? ""), sales: b.sales };
}

/**
 * Restored records fill in what this phone does not know. Where both have a
 * record, the backup's matching wins: it was made when the request was open,
 * while a fresh phone can only see the bare transfer.
 */
export function mergeSales(local: Record<string, SaleRecord>, restored: Record<string, SaleRecord>): Record<string, SaleRecord> {
  const out = { ...local };
  for (const [id, rec] of Object.entries(restored)) out[id] = { ...local[id], ...rec };
  return out;
}

function credentialOf(shop: Shop) {
  return { credentialId: shop.credentialId };
}

function toBackupError(e: unknown): Error {
  if (isMeraError(e) && e.code === "DECRYPT_FAILED") return new Error("This backup was made with a different passkey.");
  if (isMeraError(e) && e.code === "VAULT_FORMAT_INVALID") return new Error("This backup is not one Lane can read.");
  return classify(e);
}

export interface BackupResult {
  sales: number;
  savedAt: number;
}

/** One fingerprint: encrypt this phone's records into a Mera vault and store it. */
export async function backUpRecords(shop: Shop, opts: { webAuthnClient?: WebAuthnClient; fetch?: typeof fetch } = {}): Promise<BackupResult> {
  if (!opts.webAuthnClient) ensureEnvironment();
  const token = backupStore.get()?.token ?? newToken();
  const sales = salesStore.all();
  const savedAt = Date.now();
  let vault: PasskeySecretVault;
  try {
    vault = await createSecretVaultWithExistingPasskey({
      rpId: window.location.hostname,
      credential: credentialOf(shop),
      secret: encodeBackup({ v: BACKUP_VERSION, token, savedAt, name: shop.name, sales }),
      timeout: 120_000,
      ...(opts.webAuthnClient ? { webAuthnClient: opts.webAuthnClient } : {}),
    });
  } catch (e) {
    throw toBackupError(e);
  }
  const res = await (opts.fetch ?? fetch)("/api/backup", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vault, token }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? "The backup could not be saved. Try again.");
  backupStore.set({ token, savedAt });
  return { sales: Object.keys(sales).length, savedAt };
}

/** One fingerprint: fetch this passkey's vault, decrypt it on the phone and merge it in. */
export async function restoreRecords(shop: Shop, opts: { webAuthnClient?: WebAuthnClient; fetch?: typeof fetch } = {}): Promise<BackupResult | null> {
  if (!opts.webAuthnClient) ensureEnvironment();
  const res = await (opts.fetch ?? fetch)(`/api/backup?c=${encodeURIComponent(shop.credentialId)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; vault?: unknown; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? "The backup could not be fetched. Try again.");
  let backup: RecordsBackup;
  try {
    const vault = parseSecretVault(body.vault);
    if (vault.credential.credentialId !== shop.credentialId) throw new PasskeyError("unknown", "This backup belongs to a different passkey.");
    const bytes = await decryptSecretVaultWithPasskey({
      rpId: window.location.hostname,
      vault,
      timeout: 120_000,
      ...(opts.webAuthnClient ? { webAuthnClient: opts.webAuthnClient } : {}),
    });
    backup = decodeBackup(bytes);
    bytes.fill(0);
  } catch (e) {
    throw toBackupError(e);
  }
  salesStore.putMany(Object.values(mergeSales(salesStore.all(), backup.sales)));
  if (backup.name && !shop.name) shopStore.update((s) => ({ ...s, name: backup.name }));
  backupStore.set({ token: backup.token, savedAt: backup.savedAt });
  return { sales: Object.keys(backup.sales).length, savedAt: backup.savedAt };
}
