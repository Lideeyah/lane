import { createPasskeyWithPrfOutput, getPasskeyPrfOutput, isMeraError } from "@category-labs/mera";

/**
 * Passkeys, through Mera (Category Labs' passkey library). Mera runs the WebAuthn
 * ceremonies and returns the passkey's 32-byte PRF output; Lane keeps account
 * derivation in its own hands (see accounts.ts), which is the split Mera is
 * designed for.
 *
 * The PRF salt is Lane's own, not Mera's default, so every account created
 * before Lane moved onto Mera derives to the same addresses.
 *
 * Nothing here is stored except the credential id, which carries no key material.
 */

export type PasskeyFailure =
  | "insecure" // not a secure context: refuse and say why (flow §1.7)
  | "unsupported" // no WebAuthn at all
  | "dismissed" // the user closed the prompt (flow §1.5)
  | "prf-unsupported" // authenticator did not return PRF (flow §1.6)
  | "unknown";

export class PasskeyError extends Error {
  constructor(
    public readonly kind: PasskeyFailure,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PasskeyError";
  }
}

const PRF_SALT_LABEL = "lane.account.v1";
const RP_NAME = "Lane";

async function prfSalt(): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new TextEncoder().encode(PRF_SALT_LABEL);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function ensureEnvironment(): void {
  if (typeof window === "undefined") throw new PasskeyError("unsupported", "Passkeys need a browser.");
  if (!window.isSecureContext) {
    throw new PasskeyError("insecure", "Lane can only create an account over a secure connection.");
  }
  if (!("PublicKeyCredential" in window) || !navigator.credentials) {
    throw new PasskeyError("unsupported", "This browser cannot create passkeys.");
  }
}

/** Map Mera's error codes (and the WebAuthn error underneath) onto Lane's recovery states. */
export function classify(err: unknown): PasskeyError {
  if (err instanceof PasskeyError) return err;
  if (isMeraError(err)) {
    if (err.code === "PRF_UNAVAILABLE") {
      return new PasskeyError("prf-unsupported", "This phone's passkey store cannot create a Lane account yet.", err);
    }
    if (err.code === "CRYPTO_UNAVAILABLE") return new PasskeyError("unsupported", "This browser cannot create passkeys.", err);
    if (err.code === "PASSKEY_OPERATION_FAILED") {
      const name = (err.cause as { name?: string } | undefined)?.name;
      if (name === "SecurityError") return new PasskeyError("insecure", "Lane can only create an account over a secure connection.", err);
      if (name === "NotSupportedError") return new PasskeyError("unsupported", "This browser cannot create passkeys.", err);
      // Cancelled, timed out, or no matching passkey: the person can simply try again.
      return new PasskeyError("dismissed", "The prompt was dismissed.", err);
    }
  }
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") return new PasskeyError("dismissed", "The prompt was dismissed.", err);
  return new PasskeyError("unknown", "Something went wrong with the passkey prompt.", err);
}

export interface CreatedPasskey {
  credentialId: string;
  /** 32 PRF bytes. Consume immediately and drop the reference. */
  secret: Uint8Array;
}

/**
 * Create a passkey and obtain its PRF output. Mera evaluates PRF during creation
 * where the authenticator supports it, and otherwise asserts once more.
 */
export async function createPasskey(): Promise<CreatedPasskey> {
  ensureEnvironment();
  try {
    const result = await createPasskeyWithPrfOutput({
      rp: { id: window.location.hostname, name: RP_NAME },
      user: { name: `lane-${Date.now().toString(36)}`, displayName: "Lane shop" },
      prfSalt: await prfSalt(),
      timeout: 120_000,
    });
    return { credentialId: result.credentialId, secret: result.prfOutput };
  } catch (e) {
    throw classify(e);
  }
}

/**
 * Assert an existing passkey and return its PRF output. With no credential id,
 * the browser offers any discoverable Lane passkey, which is how a merchant
 * signs in on a different phone (flow §9.2).
 */
export async function assertPrf(credentialId?: string): Promise<Uint8Array> {
  return (await assertPrfDiscoverable(credentialId)).secret;
}

/** Return the credential id of whichever passkey the user picked, with its PRF output. */
export async function assertPrfDiscoverable(credentialId?: string): Promise<{ credentialId: string; secret: Uint8Array }> {
  ensureEnvironment();
  try {
    const result = await getPasskeyPrfOutput({
      rpId: window.location.hostname,
      ...(credentialId ? { credential: { credentialId } } : {}),
      prfSalt: await prfSalt(),
      timeout: 120_000,
    });
    return { credentialId: result.credentialId, secret: result.prfOutput };
  } catch (e) {
    throw classify(e);
  }
}
