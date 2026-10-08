import { describe, expect, it } from "vitest";
import { planRefund } from "../tx";

const till = "0x1111111111111111111111111111111111111111";
const owner = "0x3333333333333333333333333333333333333333";

describe("refund planning", () => {
  it("uses the till when it still holds enough", () => {
    expect(planRefund(2, till, owner, 500n, 600n, 10_000n)).toEqual({ source: "till", sourceIndex: 2, sourceAddress: till });
  });
  it("falls back to the owner account", () => {
    expect(planRefund(2, till, owner, 500n, 100n, 10_000n)).toEqual({ source: "owner", sourceIndex: 0, sourceAddress: owner });
  });
  it("returns null when neither can cover it", () => {
    expect(planRefund(2, till, owner, 500n, 100n, 100n)).toBeNull();
  });
});
