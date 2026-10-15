/**
 * End-to-end money path against the local Anvil chain and a running Lane server.
 * Run: scripts/dev-chain.sh, then `npm run build && npm run start`, then `npm run e2e`.
 */
import { describe, expect, it } from "vitest";
import { createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi } from "@/lib/abi";
import { meraSigner, mnemonicFromSecret, type SigningSession } from "@/lib/accounts";
import { config, publicClient } from "@/lib/chain";
import { requestDrip } from "@/lib/drip-client";
import { loadLedger, readBalances, tillsFromRegistry } from "@/lib/ledger";
import { planRefund, refund, registerTillOnChain, sweepTills } from "@/lib/tx";
import { startOfToday } from "@/lib/format";

const secret = crypto.getRandomValues(new Uint8Array(32));
const mnemonic = mnemonicFromSecret(secret);
// Real Mera signing sessions, as the app uses them.
const signers = new Map<number, ReturnType<typeof meraSigner>>();
const session: SigningSession = { mnemonic, account: (i) => (signers.get(i) ?? signers.set(i, meraSigner(mnemonic, i)).get(i)!).account };
const owner = session.account(0);
const till = session.account(1);
// Anvil default account #2: a public, well-known development key. Local chain only.
const customer = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const client = publicClient();

async function customerPays(to: Address, amount: bigint) {
  const w = createWalletClient({ account: customer, chain: config.chain, transport: http(config.rpcUrl) });
  const hash = await w.writeContract({ address: config.token.address, abi: erc20Abi, functionName: "transfer", args: [to, amount] });
  await client.waitForTransactionReceipt({ hash });
  return hash;
}
const bal = (a: Address) => client.readContract({ address: config.token.address, abi: erc20Abi, functionName: "balanceOf", args: [a] });

describe("Lane money path", () => {
  it("drips gas to a new owner account", async () => {
    const res = await requestDrip(owner.address);
    expect(res.ok).toBe(true);
    expect(await client.getBalance({ address: owner.address })).toBeGreaterThan(0n);
  });

  it("registers the first till against the owner", async () => {
    await registerTillOnChain(owner, till.address, "Till 1");
    const [found] = await tillsFromRegistry([till.address]);
    expect(found.owner).toBe(owner.address);
    expect(found.label).toBe("Till 1");
  });

  it("receives a customer payment into the till with no signature from the merchant", async () => {
    await customerPays(till.address, 12_500_000n);
    expect(await bal(till.address)).toBe(12_500_000n);
  });

  it("shows the sale in the ledger read from the chain", async () => {
    const l = await loadLedger([till.address], owner.address, startOfToday());
    expect(l.catchingUp).toBe(false);
    const sale = l.entries.find((e) => e.amount === 12_500_000n);
    expect(sale?.counterparty).toBe(customer.address);
    expect(sale?.kind).toBe("direct");
  });

  it("sweeps the till into the owner, queueing a second sweep inside the window", async () => {
    await customerPays(till.address, 3_000_000n);
    const { holdings } = await readBalances([till.address], owner.address);
    const t0 = Date.now();
    const [a, b] = await Promise.all([
      sweepTills(session, [{ index: 1, address: till.address }], holdings),
      sweepTills(session, [{ index: 1, address: till.address }], { [till.address]: [] }),
    ]);
    expect(a[0].error).toBeUndefined();
    expect(a[0].moved[0]?.hash).toBeDefined();
    expect(b[0].amount).toBe(0n);
    expect(await bal(till.address)).toBe(0n);
    expect(await bal(owner.address)).toBe(15_500_000n);
    expect(Date.now() - t0).toBeLessThan(60_000);
  });

  it("queues back-to-back sweeps of one till rather than sending them together", async () => {
    await customerPays(till.address, 1_000_000n);
    const half = { [till.address]: [{ token: config.token.address, amount: 500_000n }] };
    const first = sweepTills(session, [{ index: 1, address: till.address }], half);
    const second = sweepTills(session, [{ index: 1, address: till.address }], half);
    const t0 = Date.now();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1[0].error ?? r1[0].moved[0]?.error).toBeUndefined();
    expect(r2[0].error ?? r2[0].moved[0]?.error).toBeUndefined();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(config.sweepWindowMs - 50);
    expect(await bal(till.address)).toBe(0n);
  });

  it("refunds from the owner account when the till is empty, and the ledger shows it", async () => {
    const before = await bal(customer.address);
    const plan = planRefund(1, till.address, owner.address, 2_000_000n, await bal(till.address), await bal(owner.address));
    expect(plan?.source).toBe("owner");
    await refund(session, plan!, customer.address, 2_000_000n);
    expect(await bal(customer.address)).toBe(before + 2_000_000n);
    const l = await loadLedger([till.address], owner.address, startOfToday());
    expect(l.entries.some((e) => e.amount === -2_000_000n && e.kind === "refund")).toBe(true);
    // Sweeps are not ledger lines.
    expect(l.entries.filter((e) => e.amount > 0n)).toHaveLength(3);
  });

  it("takes a second stablecoin into the same till and counts it as dollars", async () => {
    const usdt = config.tokens[1];
    expect(usdt, "the local chain should accept a second stablecoin (scripts/dev-chain.sh)").toBeDefined();
    const w = createWalletClient({ account: customer, chain: config.chain, transport: http(config.rpcUrl) });
    const hash = await w.writeContract({ address: usdt.address, abi: erc20Abi, functionName: "transfer", args: [till.address, 4_500_000n] });
    await client.waitForTransactionReceipt({ hash });
    const { balances, holdings } = await readBalances([till.address], owner.address);
    expect(holdings[till.address]).toEqual([{ token: usdt.address, amount: 4_500_000n }]);
    expect(balances[till.address]).toBe(4_500_000n);
    const l = await loadLedger([till.address], owner.address, startOfToday());
    const sale = l.entries.find((e) => e.txHash === hash);
    expect(sale?.token.toLowerCase()).toBe(usdt.address.toLowerCase());
    expect(sale?.amount).toBe(4_500_000n);
  });

  it("closes the day by moving each stablecoin in its own transaction", async () => {
    const usdt = config.tokens[1];
    await customerPays(till.address, 1_500_000n);
    const { holdings } = await readBalances([till.address], owner.address);
    const ownerUsdt = await client.readContract({ address: usdt.address, abi: erc20Abi, functionName: "balanceOf", args: [owner.address] });
    const [r] = await sweepTills(session, [{ index: 1, address: till.address }], holdings);
    expect(r.amount).toBe(6_000_000n);
    expect(r.moved.map((m) => [m.token, m.amount, !!m.hash, m.error])).toEqual([
      [config.token.address, 1_500_000n, true, undefined],
      [usdt.address, 4_500_000n, true, undefined],
    ]);
    const after = await readBalances([till.address], owner.address);
    expect(after.balances[till.address]).toBe(0n);
    expect(await client.readContract({ address: usdt.address, abi: erc20Abi, functionName: "balanceOf", args: [owner.address] })).toBe(ownerUsdt + 4_500_000n);
  });

  it("refunds in the stablecoin the customer paid with", async () => {
    const usdt = config.tokens[1];
    const read = (a: Address) => client.readContract({ address: usdt.address, abi: erc20Abi, functionName: "balanceOf", args: [a] });
    const before = await read(customer.address);
    const plan = planRefund(1, till.address, owner.address, 1_000_000n, 0n, await read(owner.address));
    expect(plan?.source).toBe("owner");
    await refund(session, plan!, customer.address, 1_000_000n, usdt.address);
    expect(await read(customer.address)).toBe(before + 1_000_000n);
  });
});
