import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { PAIR_CODE_LENGTH, PAIR_TTL_SECONDS, type PairRecord } from "@/lib/pairing";
import { allow, clientIp, redis } from "@/lib/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Issue a short pairing code for a till. The record holds the till's public
 * address and two labels, all of which the staff phone would see anyway. It is
 * one-time and expires after ten minutes.
 */
function newCode(): string {
  const max = 10 ** PAIR_CODE_LENGTH;
  const limit = Math.floor(0xffffffff / max) * max; // reject to avoid modulo bias
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return String(buf[0] % max).padStart(PAIR_CODE_LENGTH, "0");
}

export async function POST(req: Request) {
  const r = redis();
  if (!r) return NextResponse.json({ ok: false, error: "Short codes are not available right now. Use the QR code." }, { status: 503 });

  let body: { till?: unknown; label?: unknown; shop?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }
  if (typeof body.till !== "string" || !isAddress(body.till)) {
    return NextResponse.json({ ok: false, error: "Bad till" }, { status: 400 });
  }
  if (!(await allow(`pair:issue:${clientIp(req)}`, 30, 3600))) {
    return NextResponse.json({ ok: false, error: "Too many codes. Try again later." }, { status: 429 });
  }

  const record: PairRecord = {
    v: 1,
    t: body.till as `0x${string}`,
    n: String(body.label ?? "Till").slice(0, 32),
    s: String(body.shop ?? "").slice(0, 64),
  };
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    // NX: never overwrite a live code that belongs to someone else.
    const set = await r.set(`pair:${code}`, JSON.stringify(record), { nx: true, ex: PAIR_TTL_SECONDS });
    if (set === "OK") return NextResponse.json({ ok: true, code, expiresAt: Date.now() + PAIR_TTL_SECONDS * 1000 });
  }
  return NextResponse.json({ ok: false, error: "Could not make a code. Try again." }, { status: 503 });
}
