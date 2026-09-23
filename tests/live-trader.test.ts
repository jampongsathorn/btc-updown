import { describe, it, expect } from "vitest";
import { interpretOrderResponse } from "../src/live-trader.js";

describe("interpretOrderResponse", () => {
  it("reproduces the observed 2026-09-23 incident: a rejected order was previously reported as success", () => {
    // Real shape returned by clob-client's postOrder() for a rejected order:
    // HTTP call did not throw, but the body says success:false. The code
    // before this fix ignored the body and always returned success:true,
    // which is why "[live-trader] BUY_DOWN order placed: undefined" logged
    // even though the wallet's on-chain activity showed nothing happened.
    const rejected = { success: false, errorMsg: "not enough balance / allowance", orderID: "" };
    const result = interpretOrderResponse(rejected);

    expect(result.success).toBe(false);
    expect(result.error).toBe("not enough balance / allowance");
    expect(result.orderId).toBeUndefined();
  });

  it("reports success with the real orderID when the CLOB actually accepts the order", () => {
    const accepted = { success: true, errorMsg: "", orderID: "0xabc123" };
    const result = interpretOrderResponse(accepted);

    expect(result.success).toBe(true);
    expect(result.orderId).toBe("0xabc123");
  });

  it("fails closed (never claims success) when the response is null/undefined", () => {
    expect(interpretOrderResponse(null).success).toBe(false);
    expect(interpretOrderResponse(undefined).success).toBe(false);
  });

  it("falls back to a clear message when success is false but errorMsg is missing", () => {
    const result = interpretOrderResponse({ success: false });
    expect(result.success).toBe(false);
    expect(result.error).toBe("order rejected (no errorMsg returned)");
  });
});
