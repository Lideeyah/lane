import { describe, expect, it } from "vitest";
import { mnemonicToAccount } from "viem/accounts";
import { deriveAccount, deriveAddresses, mnemonicFromSecret } from "../accounts";

const secret = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 1);

describe("account derivation", () => {
  it("is deterministic and standard", () => {
    const m1 = mnemonicFromSecret(secret);
    const m2 = mnemonicFromSecret(Uint8Array.from(secret));
    expect(m1).toBe(m2);
    expect(m1.split(" ")).toHaveLength(24);
    // Same accounts as any BIP-44 wallet would derive from this phrase.
    expect(deriveAccount(m1, 0).address).toBe(mnemonicToAccount(m1, { path: "m/44'/60'/0'/0/0" }).address);
    expect(deriveAccount(m1, 3).address).toBe(mnemonicToAccount(m1, { path: "m/44'/60'/0'/0/3" }).address);
  });

  it("gives distinct owner and till addresses", () => {
    const [a, b, c] = deriveAddresses(secret, [0, 1, 2]);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("rejects non 32 byte secrets", () => {
    expect(() => mnemonicFromSecret(new Uint8Array(16))).toThrow();
  });
});

describe("Mera signing sessions", () => {
  it("sign as the same address the derivation lists", async () => {
    const { meraSigner } = await import("../accounts");
    const m = mnemonicFromSecret(secret);
    for (const i of [0, 1, 5]) {
      const s = meraSigner(m, i);
      expect(s.account.address).toBe(deriveAccount(m, i).address);
      s.end();
    }
  });

  it("refuses to sign after the session ends", async () => {
    const { meraSigner } = await import("../accounts");
    const s = meraSigner(mnemonicFromSecret(secret), 1);
    const sig = await s.account.signMessage({ message: "lane" });
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
    s.end();
    await expect(s.account.signMessage({ message: "lane" })).rejects.toThrow();
  });
});
