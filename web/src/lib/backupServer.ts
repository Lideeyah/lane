import { createHash, timingSafeEqual } from "node:crypto";
import { parseSecretVault, type PasskeySecretVault } from "@category-labs/mera";

/**
 * Server-side rules for the records backup. The server stores a Mera vault it
 * cannot decrypt, keyed by the passkey's credential id, plus a hash of the
 * write token so only a phone holding that token can replace it.
 */

export interface StoredBackup {
  vault: PasskeySecretVault;
  /** sha256 of the write token, hex. */
  th: string;
  at: number;
}

/** Cap on the request, in bytes of JSON: a few thousand sales, under Redis's 1 MB value limit. */
export const MAX_BACKUP_BYTES = 900 * 1024;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const CREDENTIAL = /^[A-Za-z0-9_-]{16,1366}$/;

export function isCredentialId(c: unknown): c is string {
  return typeof c === "string" && CREDENTIAL.test(c);
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type PutCheck = { ok: true; credentialId: string; vault: PasskeySecretVault; th: string } | { ok: false; status: number; error: string };

export function checkPut(raw: string, existing: StoredBackup | null): PutCheck {
  if (raw.length > MAX_BACKUP_BYTES) return { ok: false, status: 413, error: "This backup is too large." };
  let body: { vault?: unknown; token?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return { ok: false, status: 400, error: "Bad request" };
  }
  if (typeof body.token !== "string" || !TOKEN.test(body.token)) return { ok: false, status: 400, error: "Bad request" };
  let vault: PasskeySecretVault;
  try {
    vault = parseSecretVault(body.vault);
  } catch {
    return { ok: false, status: 400, error: "This backup is not one Lane can read." };
  }
  const th = tokenHash(body.token);
  if (existing && !timingSafeEqual(Buffer.from(existing.th, "hex"), Buffer.from(th, "hex"))) {
    return { ok: false, status: 409, error: "This passkey already has a backup from another phone. Restore it here first, then back up." };
  }
  return { ok: true, credentialId: vault.credential.credentialId, vault, th };
}
