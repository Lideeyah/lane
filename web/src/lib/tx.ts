import { createWalletClient, http, type Address, type Hash, type HDAccount } from "viem";
import { erc20Abi, registryAbi } from "./abi";
import { config, publicClient } from "./chain";
import { requestDrip } from "./drip-client";
import type { SigningSession } from "./accounts";

/**
 * Every transaction Lane sends passes an explicit gas limit, because this
 * network charges the limit declared rather than the gas used (architecture
 * §5). The limit is the estimate for this exact call, never a padded number.
 */

/**
 * The reserve rule (architecture §6): an account under the 10 MON reserve may
 * only send if it sent nothing in the previous three blocks, about 1.2 seconds.
 * Lane's accounts hold dust, so consecutive sends from one sender are spaced.
 */
const SAME_SENDER_GAP_MS = 1600;
const lastSendAt = new Map<string, number>();
const senderChain = new Map<string, Promise<unknown>>();

export function paced<T>(sender: Address, fn: () => Promise<T>): Promise<T> {
  const key = sender.toLowerCase();
  const run = async () => {
    const wait = (lastSendAt.get(key) ?? 0) + SAME_SENDER_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastSendAt.set(key, Date.now());
    }
  };
  const next = (senderChain.get(key) ?? Promise.resolve()).then(run, run);
  senderChain.set(key, next.catch(() => undefined));
  return next;
}

function wallet(account: HDAccount) {
  return createWalletClient({ account, chain: config.chain, transport: http(config.rpcUrl) });
}

async function waitFor(hash: Hash) {
  const receipt = await publicClient().waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new TxError("reverted", `Transaction ${hash} reverted`);
  return receipt;
}

export class TxError extends Error {
  constructor(
    public readonly code: "no-gas" | "reverted" | "insufficient" | "unknown",
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TxError";
  }
}

/** Ensure the account can pay for one transaction, dripping from the treasury if needed. */
export async function ensureGas(address: Address): Promise<void> {
  const client = publicClient();
  const bal = await client.getBalance({ address });
  const needed = 200_000n * 100n * 10n ** 9n; // ~200k gas at 100 gwei: comfortably one ERC-20 transfer
  if (bal >= needed) return;
  const res = await requestDrip(address);
  if (!res.ok) throw new TxError("no-gas", res.error ?? "Could not fund this transaction yet.");
  if (res.hash) await client.waitForTransactionReceipt({ hash: res.hash, timeout: 60_000 });
}

export function sendToken(from: HDAccount, to: Address, amount: bigint, token: Address = config.token.address): Promise<Hash> {
  return paced(from.address, () => sendTokenNow(from, to, amount, token));
}

async function sendTokenNow(from: HDAccount, to: Address, amount: bigint, token: Address): Promise<Hash> {
  const client = publicClient();
  const gas = await client.estimateContractGas({
    address: token,
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
    account: from,
  });
  const hash = await wallet(from).writeContract({
    address: token,
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
    gas,
  });
  await waitFor(hash);
  return hash;
}

export async function registerTillOnChain(owner: HDAccount, till: Address, label: string): Promise<Hash> {
  await ensureGas(owner.address);
  return paced(owner.address, () => registerNow(owner, till, label));
}

async function registerNow(owner: HDAccount, till: Address, label: string): Promise<Hash> {
  const client = publicClient();
  const gas = await client.estimateContractGas({
    address: config.registryAddress,
    abi: registryAbi,
    functionName: "registerTill",
    args: [till, label],
    account: owner,
  });
  const hash = await wallet(owner).writeContract({
    address: config.registryAddress,
    abi: registryAbi,
    functionName: "registerTill",
    args: [till, label],
    gas,
  });
  await waitFor(hash);
  return hash;
}

export async function relabelTillOnChain(owner: HDAccount, till: Address, label: string): Promise<Hash> {
  await ensureGas(owner.address);
  return paced(owner.address, () => relabelNow(owner, till, label));
}

async function relabelNow(owner: HDAccount, till: Address, label: string): Promise<Hash> {
  const client = publicClient();
  const gas = await client.estimateContractGas({ address: config.registryAddress, abi: registryAbi, functionName: "relabelTill", args: [till, label], account: owner });
  const hash = await wallet(owner).writeContract({ address: config.registryAddress, abi: registryAbi, functionName: "relabelTill", args: [till, label], gas });
  await waitFor(hash);
  return hash;
}

/* ---------- sweep ---------- */

export interface SweepResult {
  till: Address;
  index: number;
  amount: bigint;
  hash?: Hash;
  error?: string;
  /** Unrecognised tokens moved alongside, or the reason they were not. */
  others?: { token: Address; amount: bigint; hash?: Hash; error?: string }[];
}

/** Balances of tokens other than the shop's own, per till. Lane moves them but never prices them. */
export type OtherBalances = Record<Address, { token: Address; amount: bigint }[]>;

const lastSweep = new Map<string, number>();
const sweepQueue = new Map<string, Promise<unknown>>();

/**
 * Sweep each till into the owner account with its own transaction, so a
 * failure affects exactly one till. A second sweep of the same till inside the
 * window is queued behind the first rather than sent (architecture §6).
 */
export async function sweepTills(
  session: SigningSession,
  tills: { index: number; address: Address }[],
  balances: Record<Address, bigint>,
  onProgress?: (r: SweepResult) => void,
  others: OtherBalances = {},
): Promise<SweepResult[]> {
  const owner = session.account(0).address;
  const results = await Promise.all(
    tills.map(async (t): Promise<SweepResult> => {
      const amount = balances[t.address] ?? 0n;
      const extra = (others[t.address] ?? []).filter((o) => o.amount > 0n);
      if (amount === 0n && extra.length === 0) return { till: t.address, index: t.index, amount };
      const key = t.address.toLowerCase();
      const run = async (): Promise<SweepResult> => {
        const since = Date.now() - (lastSweep.get(key) ?? 0);
        if (since < config.sweepWindowMs) await new Promise((r) => setTimeout(r, config.sweepWindowMs - since));
        lastSweep.set(key, Date.now());
        try {
          const acct = session.account(t.index);
          await ensureGas(acct.address);
          const hash = amount > 0n ? await sendToken(acct, owner, amount) : undefined;
          // Same sender, so these go one after another; each waits for its receipt.
          const moved: NonNullable<SweepResult["others"]> = [];
          for (const o of extra) {
            try {
              moved.push({ ...o, hash: await sendToken(acct, owner, o.amount, o.token) });
            } catch (e) {
              moved.push({ ...o, error: describe(e) });
            }
          }
          const r: SweepResult = { till: t.address, index: t.index, amount, hash, ...(moved.length ? { others: moved } : {}) };
          onProgress?.(r);
          return r;
        } catch (e) {
          const r = { till: t.address, index: t.index, amount, error: describe(e) };
          onProgress?.(r);
          return r;
        }
      };
      const prev = sweepQueue.get(key) ?? Promise.resolve();
      const next = prev.then(run, run);
      sweepQueue.set(key, next);
      return next;
    }),
  );
  return results;
}

/* ---------- refund ---------- */

export interface RefundPlan {
  source: "till" | "owner";
  sourceIndex: number;
  sourceAddress: Address;
}

/** The till if it still holds enough, otherwise the owner account (flow §8.2). */
export function planRefund(tillIndex: number, till: Address, owner: Address, amount: bigint, tillBalance: bigint, ownerBalance: bigint): RefundPlan | null {
  if (tillBalance >= amount) return { source: "till", sourceIndex: tillIndex, sourceAddress: till };
  if (ownerBalance >= amount) return { source: "owner", sourceIndex: 0, sourceAddress: owner };
  return null;
}

export async function refund(session: SigningSession, plan: RefundPlan, payer: Address, amount: bigint): Promise<Hash> {
  const acct = session.account(plan.sourceIndex);
  await ensureGas(acct.address);
  return sendToken(acct, payer, amount);
}

export function describe(e: unknown): string {
  if (e instanceof TxError) return e.message;
  const msg = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? String(e);
  return msg.length > 160 ? msg.slice(0, 157) + "…" : msg;
}
