import type { Address, Hash } from "viem";

export interface DripResponse {
  ok: boolean;
  hash?: Hash;
  skipped?: boolean;
  error?: string;
}

/** Ask the treasury to fund one account with enough native currency for a transaction or two. */
export async function requestDrip(address: Address): Promise<DripResponse> {
  try {
    const base = typeof window === "undefined" ? (process.env.LANE_ORIGIN ?? "http://localhost:3000") : "";
    const res = await fetch(`${base}/api/drip`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    });
    const json = (await res.json()) as DripResponse;
    if (!res.ok) return { ok: false, error: json.error ?? `Treasury returned ${res.status}` };
    return json;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
