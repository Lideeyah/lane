import { describe, expect, it } from "vitest";
import { formatAmount, parseAmount } from "../format";

describe("amounts", () => {
  it("formats base units with two decimals", () => {
    expect(formatAmount(12_500_000n)).toBe("12.50");
    expect(formatAmount(0n)).toBe("0.00");
    expect(formatAmount(1_234_567_000_000n)).toBe("1,234,567.00");
    expect(formatAmount(-250_000n)).toBe("−0.25");
    expect(formatAmount(250_000n, { signed: true })).toBe("+0.25");
  });
  it("parses typed text", () => {
    expect(parseAmount("12.5")).toBe(12_500_000n);
    expect(parseAmount("")).toBe(0n);
    expect(parseAmount("0.01")).toBe(10_000n);
  });
});
