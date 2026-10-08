import { describe, expect, it } from "vitest";
import { decodePayload, eip681, encodePayload, isExpired, isPaymentRequest, matchTransfer, type PaymentRequest } from "../request";

const req: PaymentRequest = {
  v: 1,
  t: "0x1111111111111111111111111111111111111111",
  a: "12500000",
  k: "0x2222222222222222222222222222222222222222",
  c: 143,
  r: "abcd2345",
  ts: 1_700_000_000_000,
  s: "Ama's Kiosk",
  n: "Till 1",
};

describe("payment request codec", () => {
  it("round trips through the fragment", () => {
    const enc = encodePayload(req);
    expect(enc).not.toMatch(/[+/=]/);
    expect(decodePayload<PaymentRequest>(`#${enc}`)).toEqual(req);
    expect(isPaymentRequest(decodePayload(enc))).toBe(true);
  });

  it("rejects garbage", () => {
    expect(decodePayload("#not-base64!!")).toBeNull();
    expect(isPaymentRequest({ ...req, t: "0x12" })).toBe(false);
    expect(isPaymentRequest({ ...req, a: "1.5" })).toBe(false);
    expect(isPaymentRequest(null)).toBe(false);
  });

  it("expiry is display only and time based", () => {
    expect(isExpired(req, req.ts + 1000)).toBe(false);
    expect(isExpired(req, req.ts + 16 * 60 * 1000)).toBe(true);
  });

  it("builds an EIP-681 link", () => {
    expect(eip681(req)).toBe(`ethereum:${req.k}@143/transfer?address=${req.t}&uint256=12500000`);
  });
});

describe("matching", () => {
  it("classifies exact, short, over and unmatched", () => {
    const open = { amount: 1000n };
    expect(matchTransfer(open, 1000n)).toBe("exact");
    expect(matchTransfer(open, 999n)).toBe("short");
    expect(matchTransfer(open, 1001n)).toBe("over");
    expect(matchTransfer(null, 1000n)).toBe("unmatched");
  });
});
