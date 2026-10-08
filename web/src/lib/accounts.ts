import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";
import { assertPrf, assertPrfDiscoverable, createPasskey } from "./passkey";

/**
 * Account derivation. The 32 PRF bytes are BIP-39 entropy, producing a 24 word
 * phrase that is also the recovery phrase. Accounts follow m/44'/60'/0'/0/i:
 * index 0 is the owner, 1 upward are tills, allocated in order and never reused.
 * The derivation is standard, so the phrase opens the same accounts anywhere.
 */

export const OWNER_INDEX = 0;

export function mnemonicFromSecret(secret: Uint8Array): string {
  if (secret.length !== 32) throw new Error("PRF output must be 32 bytes");
  return entropyToMnemonic(secret, wordlist);
}

export function deriveAccount(mnemonic: string, index: number): HDAccount {
  return mnemonicToAccount(mnemonic, { addressIndex: index });
}

export function deriveAddresses(secret: Uint8Array, indices: number[]): `0x${string}`[] {
  const m = mnemonicFromSecret(secret);
  return indices.map((i) => deriveAccount(m, i).address);
}

export interface SigningSession {
  mnemonic: string;
  account(index: number): HDAccount;
}

/**
 * Run `fn` with a signing session that exists only for the duration of the call.
 * One biometric prompt, one function, no key left behind (architecture §3).
 */
export async function withSigner<T>(credentialId: string, fn: (session: SigningSession) => Promise<T>): Promise<T> {
  const secret = await assertPrf(credentialId);
  try {
    const mnemonic = mnemonicFromSecret(secret);
    return await fn({ mnemonic, account: (i) => deriveAccount(mnemonic, i) });
  } finally {
    secret.fill(0);
  }
}

/** First-time creation: returns the credential id and the owner address. */
export async function createOwner(): Promise<{ credentialId: string; owner: `0x${string}` }> {
  const { credentialId, secret } = await createPasskey();
  try {
    const [owner] = deriveAddresses(secret, [OWNER_INDEX]);
    return { credentialId, owner };
  } finally {
    secret.fill(0);
  }
}

/** Sign in on another device with any Lane passkey the browser offers. */
export async function restoreOwner(): Promise<{ credentialId: string; owner: `0x${string}`; mnemonic: string }> {
  const { credentialId, secret } = await assertPrfDiscoverable();
  try {
    const mnemonic = mnemonicFromSecret(secret);
    return { credentialId, owner: deriveAccount(mnemonic, OWNER_INDEX).address, mnemonic };
  } finally {
    secret.fill(0);
  }
}
