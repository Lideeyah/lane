import { NextResponse } from "next/server";
import { normaliseCode, PAIR_CODE_LENGTH, type PairRecord } from "@/lib/pairing";
import { allow, clientIp, redis } from "@/lib/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Redeem a pairing code once. Attempts are limited per network address, so
 * guessing a live code out of a million inside its ten minutes is impractical.
 */
export async function POST(req: Request) {
  const r = redis();
  if (!r) return NextResponse.json({ ok: false, error: "Short codes are not available right now. Scan the owner's QR code instead." }, { status: 503 });

  let body: { code?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }
  const code = normaliseCode(String(body.code ?? ""));
  if (code.length !== PAIR_CODE_LENGTH) {
    return NextResponse.json({ ok: false, error: `Enter all ${PAIR_CODE_LENGTH} digits.` }, { status: 400 });
  }
  if (!(await allow(`pair:claim:${clientIp(req)}`, 10, 600))) {
    return NextResponse.json({ ok: false, error: "Too many tries. Wait a few minutes and try again." }, { status: 429 });
  }

  const raw = await r.getdel<PairRecord | string>(`pair:${code}`);
  if (!raw) return NextResponse.json({ ok: false, error: "That code did not work. It may have expired or been used. Ask the owner for a new one." }, { status: 404 });
  const record = typeof raw === "string" ? (JSON.parse(raw) as PairRecord) : raw;
  return NextResponse.json({ ok: true, pairing: record });
}
