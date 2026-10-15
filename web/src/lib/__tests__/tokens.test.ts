import { afterEach, describe, expect, it, vi } from "vitest";

const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const USDT0 = "0xe7cd86e13AC4309349F30B3435a9d337750fC82D";

async function chainWith(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("../chain");
}

afterEach(() => vi.unstubAllEnvs());

describe("accepted stablecoins", () => {
  it("is the shop's token alone by default, shown in its own symbol", async () => {
    const { config } = await chainWith({ NEXT_PUBLIC_TOKEN_ADDRESS: USDC, NEXT_PUBLIC_TOKEN_SYMBOL: "USDC", NEXT_PUBLIC_EXTRA_TOKENS: "" });
    expect(config.tokens.map((t) => t.symbol)).toEqual(["USDC"]);
    expect(config.unit).toBe("USDC");
  });

  it("adds USDT0 after the shop's token, with the same decimals, and shows amounts in USD", async () => {
    const { config, acceptedToken } = await chainWith({
      NEXT_PUBLIC_TOKEN_ADDRESS: USDC,
      NEXT_PUBLIC_TOKEN_SYMBOL: "USDC",
      NEXT_PUBLIC_TOKEN_DECIMALS: "6",
      NEXT_PUBLIC_EXTRA_TOKENS: ` ${USDT0}:USDT0 , ${USDC}:USDC`,
    });
    expect(config.tokens).toEqual([
      { address: USDC, symbol: "USDC", decimals: 6 },
      { address: USDT0, symbol: "USDT0", decimals: 6 },
    ]);
    expect(config.unit).toBe("USD");
    expect(acceptedToken(USDT0.toLowerCase())?.symbol).toBe("USDT0");
    expect(acceptedToken("0x0000000000000000000000000000000000000001")).toBeUndefined();
  });

  it("refuses an extra token that is not a valid address", async () => {
    const { config } = await chainWith({ NEXT_PUBLIC_TOKEN_ADDRESS: USDC, NEXT_PUBLIC_EXTRA_TOKENS: "0x1234:USDT0" });
    expect(() => config.tokens).toThrow("NEXT_PUBLIC_EXTRA_TOKENS");
  });
});
