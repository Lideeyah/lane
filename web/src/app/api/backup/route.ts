import { NextResponse } from "next/server";
import { checkPut, isCredentialId, type StoredBackup } from "@/lib/backupServer";
import { allow, clientIp, redis } from "@/lib/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Encrypted records backups (see lib/backup.ts). Lane stores the Mera vault and
 * cannot read it: the key is derived from the passkey on the owner's phone.
 */
const TTL_SECONDS = 400 * 24 * 3600;
const keyFor = (credentialId: string) => `backup:${credentialId}`;

function unavailable() {
  return NextResponse.json({ ok: false, error: "Backups are not available right now." }, { status: 503 });
}

async function load(credentialId: string): Promise<StoredBackup | null> {
  const v = await redis()!.get<StoredBackup | string>(keyFor(credentialId));
  if (!v) return null;
  return typeof v === "string" ? (JSON.parse(v) as StoredBackup) : v;
}

export async function GET(req: Request) {
  if (!redis()) return unavailable();
  const c = new URL(req.url).searchParams.get("c");
  if (!isCredentialId(c)) return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  if (!(await allow(`backup:get:${clientIp(req)}`, 60, 3600))) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again later." }, { status: 429 });
  }
  const stored = await load(c);
  if (!stored) return NextResponse.json({ ok: false, error: "No backup yet" }, { status: 404 });
  return NextResponse.json({ ok: true, vault: stored.vault, at: stored.at }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(req: Request) {
  if (!redis()) return unavailable();
  if (!(await allow(`backup:put:${clientIp(req)}`, 30, 3600))) {
    return NextResponse.json({ ok: false, error: "Too many backups. Try again later." }, { status: 429 });
  }
  const raw = await req.text();
  // Parse once to find the key, then check against what is stored there.
  const first = checkPut(raw, null);
  if (!first.ok) return NextResponse.json({ ok: false, error: first.error }, { status: first.status });
  const check = checkPut(raw, await load(first.credentialId));
  if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: check.status });
  const record: StoredBackup = { vault: check.vault, th: check.th, at: Date.now() };
  await redis()!.set(keyFor(check.credentialId), JSON.stringify(record), { ex: TTL_SECONDS });
  return NextResponse.json({ ok: true, at: record.at });
}
