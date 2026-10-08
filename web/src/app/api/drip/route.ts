import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, isAddress, parseEther, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The treasury. The only server-side secret Lane holds, and it funds gas and
 * nothing else. Drips are serialised through one queue so nonces never collide
 * under concurrent onboarding (architecture §5).
 */

const DRIP_AMOUNT = parseEther(process.env.DRIP_AMOUNT_MON || "0.05");
/** Skip the drip when the target already holds at least this much. */
const SKIP_ABOVE = DRIP_AMOUNT / 2n;
const MAX_PER_ADDRESS_PER_HOUR = 4;
const MAX_PER_IP_PER_HOUR = 30;

type Bucket = { count: number; resetAt: number };
const perAddress = new Map<string, Bucket>();
const perIp = new Map<string, Bucket>();

function take(map: Map<string, Bucket>, key: string, max: number): boolean {
  const now = Date.now();
  const b = map.get(key);
  if (!b || b.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + 3_600_000 });
    return true;
  }
  if (b.count >= max) return false;
  b.count++;
  return true;
}

let queue: Promise<unknown> = Promise.resolve();
function serialise<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

function treasury() {
  const pk = process.env.TREASURY_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) return null;
  const account = privateKeyToAccount(pk as `0x${string}`);
  const transport = http(process.env.RPC_URL || config.rpcUrl);
  return {
    account,
    wallet: createWalletClient({ account, chain: config.chain, transport }),
    pub: createPublicClient({ chain: config.chain, transport }),
  };
}

export async function GET() {
  const t = treasury();
  if (!t) return NextResponse.json({ ok: false, configured: false }, { status: 503 });
  const balance = await t.pub.getBalance({ address: t.account.address });
  const dripsLeft = DRIP_AMOUNT > 0n ? Number(balance / DRIP_AMOUNT) : 0;
  return NextResponse.json({ ok: true, configured: true, dripsLeft, low: dripsLeft < 20 });
}

export async function POST(req: Request) {
  const t = treasury();
  if (!t) return NextResponse.json({ ok: false, error: "Treasury not configured" }, { status: 503 });

  let body: { address?: unknown };
  try {
    body = (await req.json()) as { address?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }
  const address = body.address;
  if (typeof address !== "string" || !isAddress(address)) {
    return NextResponse.json({ ok: false, error: "Bad address" }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!take(perIp, ip, MAX_PER_IP_PER_HOUR) || !take(perAddress, address.toLowerCase(), MAX_PER_ADDRESS_PER_HOUR)) {
    return NextResponse.json({ ok: false, error: "Too many requests, try again later" }, { status: 429 });
  }

  try {
    const result = await serialise(async (): Promise<{ hash?: Hash; skipped?: boolean }> => {
      const current = await t.pub.getBalance({ address: address as Address });
      if (current >= SKIP_ABOVE) return { skipped: true };
      const treasuryBalance = await t.pub.getBalance({ address: t.account.address });
      if (treasuryBalance < DRIP_AMOUNT * 2n) throw new Error("Treasury is empty");
      // A native transfer costs exactly 21000 gas: the one case where the limit is known, not estimated.
      const hash = await t.wallet.sendTransaction({ to: address as Address, value: DRIP_AMOUNT, gas: 21_000n });
      await t.pub.waitForTransactionReceipt({ hash, timeout: 45_000 });
      // Reserve rule: if the treasury is under the reserve, keep three blocks between its sends.
      if (treasuryBalance < parseEther("10")) await new Promise((r) => setTimeout(r, 1600));
      return { hash };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = (e as Error).message ?? "Drip failed";
    const status = msg.includes("Treasury is empty") ? 503 : 502;
    return NextResponse.json({ ok: false, error: msg.slice(0, 200) }, { status });
  }
}
