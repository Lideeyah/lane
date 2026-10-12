import { createSecp256k1SigningSession } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type { LocalAccount } from "viem";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";
import { assertPrf } from "./passkey";

/**
 * One passkey, many keys. Mera returns the passkey's 32 PRF bytes; Lane treats
 * them as BIP-39 entropy, producing a 24-word phrase that is also the recovery
 * phrase, and derives accounts at m/44'/60'/0'/0/i: index 0 is the shop owner,
 * 1 upward are tills, allocated in order and never reused. The derivation is
 * standard, so the phrase opens the same accounts in any wallet.
 *
 * Signing goes through Mera's secp256k1 signing sessions and its viem adapter.
 * Each session holds its own copy of one key and zeroes it when ended, and every
 * session opened for a signed action is ended before that action returns.
 */

export const OWNER_INDEX = 0;

export function mnemonicFromSecret(secret: Uint8Array): string {
  if (secret.length !== 32) throw new Error("PRF output must be 32 bytes");
  return entropyToMnemonic(secret, wordlist);
}

/** Address-only derivation, for listing tills. Never used to sign. */
export function deriveAccount(mnemonic: string, index: number): HDAccount {
  return mnemonicToAccount(mnemonic, { addressIndex: index });
}

export function deriveAddresses(secret: Uint8Array, indices: number[]): `0x${string}`[] {
  const m = mnemonicFromSecret(secret);
  return indices.map((i) => deriveAccount(m, i).address);
}

export interface MeraSigner {
  account: LocalAccount;
  /** Zero the session's key. Signing after this throws. */
  end(): void;
}

/** A Mera signing session for account `index`, adapted for viem. */
export function meraSigner(mnemonic: string, index: number): MeraSigner {
  const seed = mnemonicToSeedSync(mnemonic);
  const node = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/0'/0/${index}`);
  const privateKey = node.privateKey;
  if (!privateKey) throw new Error("Could not derive a key for this account");
  try {
    const session = createSecp256k1SigningSession({ privateKey });
    return { account: toViemAccount(session), end: () => session.end() };
  } finally {
    // Mera copies the key into a session-owned snapshot; wipe the derivation's copies.
    privateKey.fill(0);
    seed.fill(0);
    node.wipePrivateData();
  }
}

export interface SigningSession {
  mnemonic: string;
  account(index: number): LocalAccount;
}

/**
 * Run `fn` with signing sessions that exist only for the duration of the call.
 * One biometric prompt, one function, no key left behind (architecture §3).
 */
export async function withSigner<T>(credentialId: string, fn: (session: SigningSession) => Promise<T>): Promise<T> {
  const secret = await assertPrf(credentialId);
  const signers = new Map<number, MeraSigner>();
  try {
    const mnemonic = mnemonicFromSecret(secret);
    return await fn({
      mnemonic,
      account: (i) => {
        let s = signers.get(i);
        if (!s) signers.set(i, (s = meraSigner(mnemonic, i)));
        return s.account;
      },
    });
  } finally {
    for (const s of signers.values()) s.end();
    secret.fill(0);
  }
}
