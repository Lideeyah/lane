import type { Address } from "viem";
import { erc20Abi, registryAbi } from "./abi";
import { config, publicClient } from "./chain";
import { salesStore, type MatchKind, type SaleRecord } from "./storage";

/**
 * The ledger is public data keyed by address. It prefers the indexer when one
 * is configured and otherwise reads transfer logs straight from the chain. In
 * either case balances come from the chain, so the merchant always sees what
 * they hold, and an empty ledger is never shown while history is loading.
 */

export interface LedgerEntry {
  id: string;
  txHash: `0x${string}`;
  till: Address;
  /** Counterparty: the payer for a sale, the recipient for a refund. */
  counterparty: Address;
  /** Positive for money in, negative for a refund out. */
  amount: bigint;
  time: number;
  kind: MatchKind;
  reference?: string;
  requestId?: string;
  requestedAmount?: bigint;
  refundOf?: string;
}

export interface Ledger {
  entries: LedgerEntry[];
  balances: Record<Address, bigint>;
  ownerBalance: bigint;
  source: "indexer" | "chain";
  /** True when only balances could be read and history is still loading. */
  catchingUp: boolean;
}

function enrich(e: Omit<LedgerEntry, "kind" | "reference" | "requestId" | "requestedAmount" | "refundOf">, local: SaleRecord | undefined, fallback: MatchKind): LedgerEntry {
  return {
    ...e,
    kind: local?.kind ?? fallback,
    reference: local?.reference,
    requestId: local?.requestId,
    requestedAmount: local?.requestedAmount ? BigInt(local.requestedAmount) : undefined,
    refundOf: local?.refundOf,
  };
}

export async function readBalances(tills: Address[], owner?: Address): Promise<{ balances: Record<Address, bigint>; ownerBalance: bigint }> {
  const client = publicClient();
  const addrs = owner ? [...tills, owner] : tills;
  const results = await Promise.all(
    addrs.map((a) =>
      client.readContract({ address: config.token.address, abi: erc20Abi, functionName: "balanceOf", args: [a] }).catch(() => 0n),
    ),
  );
  const balances: Record<Address, bigint> = {};
  tills.forEach((t, i) => (balances[t] = results[i]));
  return { balances, ownerBalance: owner ? results[results.length - 1] : 0n };
}

/* ---------- block lookup by time (chain fallback) ---------- */

const blockTimeCache = new Map<bigint, number>();
async function blockTimestamp(n: bigint): Promise<number> {
  const c = blockTimeCache.get(n);
  if (c) return c;
  const b = await publicClient().getBlock({ blockNumber: n });
  const t = Number(b.timestamp) * 1000;
  blockTimeCache.set(n, t);
  return t;
}

/** Binary search for the first block at or after `timeMs`. */
export async function blockAtOrAfter(timeMs: number): Promise<bigint> {
  const client = publicClient();
  let hi = await client.getBlockNumber();
  let lo = 0n;
  if ((await blockTimestamp(hi)) < timeMs) return hi + 1n;
  if ((await blockTimestamp(lo)) >= timeMs) return 0n;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if ((await blockTimestamp(mid)) >= timeMs) hi = mid;
    else lo = mid;
  }
  return hi;
}

async function fromChain(tills: Address[], owner: Address | undefined, sinceMs: number): Promise<LedgerEntry[]> {
  const client = publicClient();
  const fromBlock = await blockAtOrAfter(sinceMs);
  const toBlock = await client.getBlockNumber();
  if (fromBlock > toBlock) return [];
  const senders = owner ? [...tills, owner] : tills;
  const [inLogs, outLogs] = await Promise.all([
    client.getContractEvents({ address: config.token.address, abi: erc20Abi, eventName: "Transfer", args: { to: tills }, fromBlock, toBlock }),
    client.getContractEvents({ address: config.token.address, abi: erc20Abi, eventName: "Transfer", args: { from: senders }, fromBlock, toBlock }),
  ]);
  const local = salesStore.all();
  const entries: LedgerEntry[] = [];
  const blocks = new Set<bigint>();
  for (const l of [...inLogs, ...outLogs]) if (l.blockNumber != null) blocks.add(l.blockNumber);
  await Promise.all([...blocks].map((b) => blockTimestamp(b).catch(() => undefined)));

  const tillSet = new Set(tills.map((t) => t.toLowerCase()));
  for (const l of inLogs) {
    if (!l.transactionHash || l.logIndex == null || l.blockNumber == null || !l.args.from || !l.args.to || l.args.value == null) continue;
    // A sweep is a till paying the owner, which is also a transfer *from* a till; skip till→till/owner here.
    if (tillSet.has(l.args.from.toLowerCase()) || (owner && l.args.from.toLowerCase() === owner.toLowerCase())) continue;
    const id = `${l.transactionHash}:${l.logIndex}`;
    entries.push(
      enrich(
        { id, txHash: l.transactionHash, till: l.args.to, counterparty: l.args.from, amount: l.args.value, time: blockTimeCache.get(l.blockNumber) ?? Date.now() },
        local[id],
        "direct",
      ),
    );
  }
  for (const l of outLogs) {
    if (!l.transactionHash || l.logIndex == null || l.blockNumber == null || !l.args.from || !l.args.to || l.args.value == null) continue;
    const toLower = l.args.to.toLowerCase();
    // Sweeps (till → owner) are not ledger lines; refunds (→ a customer) are.
    if (owner && toLower === owner.toLowerCase()) continue;
    if (tillSet.has(toLower)) continue;
    const id = `${l.transactionHash}:${l.logIndex}`;
    entries.push(
      enrich(
        { id, txHash: l.transactionHash, till: l.args.from, counterparty: l.args.to, amount: -l.args.value, time: blockTimeCache.get(l.blockNumber) ?? Date.now() },
        local[id],
        "refund",
      ),
    );
  }
  entries.sort((a, b) => b.time - a.time || (a.id < b.id ? 1 : -1));
  return entries;
}

/* ---------- indexer (Envio GraphQL) ---------- */

interface IndexedTransfer {
  id: string;
  txHash: `0x${string}`;
  from: Address;
  to: Address;
  value: string;
  timestamp: string;
}

async function fromIndexer(tills: Address[], owner: Address | undefined, sinceMs: number): Promise<LedgerEntry[] | null> {
  if (!config.indexerUrl) return null;
  const since = Math.floor(sinceMs / 1000);
  const addrs = (owner ? [...tills, owner] : tills).map((a) => a.toLowerCase());
  const query = `query Ledger($addrs: [String!], $since: numeric!) {
    Transfer(where: {_and: [{timestamp: {_gte: $since}}, {_or: [{to: {_in: $addrs}}, {from: {_in: $addrs}}]}]}, order_by: {timestamp: desc}, limit: 1000) {
      id txHash from to value timestamp
    }
  }`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(config.indexerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { addrs, since } }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { Transfer: IndexedTransfer[] } };
    const rows = json.data?.Transfer;
    if (!rows) return null;
    const local = salesStore.all();
    const tillSet = new Set(tills.map((t) => t.toLowerCase()));
    const ownerLower = owner?.toLowerCase();
    const entries: LedgerEntry[] = [];
    for (const r of rows) {
      const from = r.from.toLowerCase();
      const to = r.to.toLowerCase();
      const time = Number(r.timestamp) * 1000;
      if (tillSet.has(to) && !tillSet.has(from) && from !== ownerLower) {
        entries.push(enrich({ id: r.id, txHash: r.txHash, till: r.to, counterparty: r.from, amount: BigInt(r.value), time }, local[r.id], "direct"));
      } else if ((tillSet.has(from) || from === ownerLower) && !tillSet.has(to) && to !== ownerLower) {
        entries.push(enrich({ id: r.id, txHash: r.txHash, till: r.from, counterparty: r.to, amount: -BigInt(r.value), time }, local[r.id], "refund"));
      }
    }
    return entries;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadLedger(tills: Address[], owner: Address | undefined, sinceMs: number): Promise<Ledger> {
  const balancesP = readBalances(tills, owner);
  const indexed = await fromIndexer(tills, owner, sinceMs);
  if (indexed) {
    const b = await balancesP;
    return { entries: indexed, ...b, source: "indexer", catchingUp: false };
  }
  try {
    const [entries, b] = await Promise.all([fromChain(tills, owner, sinceMs), balancesP]);
    return { entries, ...b, source: "chain", catchingUp: false };
  } catch {
    const b = await balancesP;
    return { entries: [], ...b, source: "chain", catchingUp: true };
  }
}

/** Tills registered on chain by this owner, for restoring on a new device. */
export async function registeredTills(owner: Address): Promise<{ address: Address; label: string; retired: boolean }[]> {
  const client = publicClient();
  const [reg, relabel, retired] = await Promise.all([
    client.getContractEvents({ address: config.registryAddress, abi: registryAbi, eventName: "TillRegistered", args: { owner }, fromBlock: 0n }),
    client.getContractEvents({ address: config.registryAddress, abi: registryAbi, eventName: "TillRelabelled", args: { owner }, fromBlock: 0n }),
    client.getContractEvents({ address: config.registryAddress, abi: registryAbi, eventName: "TillRetired", args: { owner }, fromBlock: 0n }),
  ]);
  const map = new Map<string, { address: Address; label: string; retired: boolean }>();
  for (const l of reg) if (l.args.till) map.set(l.args.till.toLowerCase(), { address: l.args.till, label: l.args.label ?? "", retired: false });
  for (const l of relabel) {
    const t = l.args.till && map.get(l.args.till.toLowerCase());
    if (t && l.args.label != null) t.label = l.args.label;
  }
  for (const l of retired) {
    const t = l.args.till && map.get(l.args.till.toLowerCase());
    if (t) t.retired = true;
  }
  return [...map.values()];
}

/* ---------- unrecognised tokens (flow §4.11) ---------- */

export interface OtherToken {
  token: Address;
  /** From the token itself when it answers; never used for pricing. */
  symbol?: string;
  decimals?: number;
  balances: Record<Address, bigint>;
}

const OTHER_LOOKBACK_BLOCKS = 50_000n;

/**
 * Any ERC-20 other than the shop's token that has arrived at a till. Found from
 * Transfer logs into the tills from any contract, then confirmed by balance, so
 * a token that has since left the till is not shown. Lane does not price these.
 */
export async function otherTokens(tills: Address[]): Promise<OtherToken[]> {
  if (!tills.length) return [];
  const client = publicClient();
  const head = await client.getBlockNumber();
  const fromBlock = head > OTHER_LOOKBACK_BLOCKS ? head - OTHER_LOOKBACK_BLOCKS : 0n;
  const logs = await client.getLogs({
    event: erc20Abi[0],
    args: { to: tills },
    fromBlock,
    toBlock: head,
    strict: true, // skips ERC-721 transfers, whose value is indexed
  });
  const main = config.token.address.toLowerCase();
  const tokens = [...new Set(logs.map((l) => l.address.toLowerCase()))].filter((t) => t !== main) as Address[];
  const out: OtherToken[] = [];
  for (const token of tokens) {
    const balances: Record<Address, bigint> = {};
    let any = false;
    await Promise.all(
      tills.map(async (till) => {
        const b = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [till] }).catch(() => 0n);
        if (b > 0n) {
          balances[till] = b;
          any = true;
        }
      }),
    );
    if (!any) continue;
    const [symbol, decimals] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => undefined),
      client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }).catch(() => undefined),
    ]);
    out.push({ token, symbol: typeof symbol === "string" ? symbol.replace(/[^A-Za-z0-9.$-]/g, "").slice(0, 12) || undefined : undefined, decimals: decimals === undefined ? undefined : Number(decimals), balances });
  }
  return out;
}
