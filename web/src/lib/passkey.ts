/**
 * WebAuthn with the PRF extension. The 32 bytes the authenticator returns are the
 * only secret in Lane, and they exist in memory for the duration of one call.
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

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(b);
  return b;
}

function toBuffer(u8: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(u8.length));
  out.set(u8);
  return out;
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

function ensureEnvironment(): void {
  if (typeof window === "undefined") throw new PasskeyError("unsupported", "Passkeys need a browser.");
  if (!window.isSecureContext) {
    throw new PasskeyError("insecure", "Lane can only create an account over a secure connection.");
  }
  if (!("PublicKeyCredential" in window) || !navigator.credentials) {
    throw new PasskeyError("unsupported", "This browser cannot create passkeys.");
  }
}

function classify(err: unknown): PasskeyError {
  if (err instanceof PasskeyError) return err;
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") {
    return new PasskeyError("dismissed", "The prompt was dismissed.", err);
  }
  if (name === "SecurityError") return new PasskeyError("insecure", "Lane can only create an account over a secure connection.", err);
  if (name === "NotSupportedError") return new PasskeyError("unsupported", "This browser cannot create passkeys.", err);
  return new PasskeyError("unknown", "Something went wrong with the passkey prompt.", err);
}

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

export interface CreatedPasskey {
  credentialId: string;
  /** 32 PRF bytes. Consume immediately and drop the reference. */
  secret: Uint8Array;
}

/**
 * Create a passkey and obtain its PRF output. If the authenticator evaluates PRF
 * during creation we use that result; otherwise we immediately assert once.
 */
export async function createPasskey(): Promise<CreatedPasskey> {
  ensureEnvironment();
  const salt = await prfSalt();
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        rp: { name: RP_NAME, id: window.location.hostname },
        user: { id: randomBytes(16), name: `lane-${Date.now().toString(36)}`, displayName: "Lane shop" },
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        timeout: 120_000,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw classify(e);
  }
  if (!cred) throw new PasskeyError("dismissed", "The prompt was dismissed.");

  const ext = cred.getClientExtensionResults() as PrfResults;
  const credentialId = toBase64Url(cred.rawId);
  if (ext.prf?.results?.first) {
    return { credentialId, secret: new Uint8Array(ext.prf.results.first) };
  }
  if (ext.prf?.enabled === false) {
    throw new PasskeyError("prf-unsupported", "This phone's passkey store cannot create a Lane account yet.");
  }
  // enabled true (or undefined on some platforms): evaluate with an assertion.
  const secret = await assertPrf(credentialId);
  return { credentialId, secret };
}

/**
 * Assert an existing passkey and return its PRF output. With no credential id,
 * the browser offers any discoverable Lane passkey, which is how a merchant
 * signs in on a different phone (flow §9.2).
 */
export async function assertPrf(credentialId?: string): Promise<Uint8Array> {
  ensureEnvironment();
  const salt = await prfSalt();
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        rpId: window.location.hostname,
        challenge: randomBytes(32),
        allowCredentials: credentialId ? [{ type: "public-key", id: toBuffer(fromBase64Url(credentialId)) }] : [],
        userVerification: "required",
        timeout: 120_000,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw classify(e);
  }
  if (!cred) throw new PasskeyError("dismissed", "The prompt was dismissed.");
  const ext = cred.getClientExtensionResults() as PrfResults;
  const first = ext.prf?.results?.first;
  if (!first) {
    throw new PasskeyError("prf-unsupported", "This phone's passkey store cannot open a Lane account yet.");
  }
  return new Uint8Array(first);
}

/** Return the credential id of whichever discoverable passkey the user picked. */
export async function assertPrfDiscoverable(): Promise<{ credentialId: string; secret: Uint8Array }> {
  ensureEnvironment();
  const salt = await prfSalt();
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        rpId: window.location.hostname,
        challenge: randomBytes(32),
        userVerification: "required",
        timeout: 120_000,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw classify(e);
  }
  if (!cred) throw new PasskeyError("dismissed", "The prompt was dismissed.");
  const ext = cred.getClientExtensionResults() as PrfResults;
  const first = ext.prf?.results?.first;
  if (!first) throw new PasskeyError("prf-unsupported", "This phone's passkey store cannot open a Lane account yet.");
  return { credentialId: toBase64Url(cred.rawId), secret: new Uint8Array(first) };
}
