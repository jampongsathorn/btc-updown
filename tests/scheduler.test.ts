import { describe, it, expect } from "vitest";
import { SlotScheduler } from "../src/scheduler";

describe("Slot Scheduler", () => {
  const scheduler = new SlotScheduler({ warmupSeconds: 45 });

  it("should calculate correct 300s slot boundaries", () => {
    // 1790158330 = 10:12:10 UTC -> slot 1790158200 (10:10:00 UTC)
    const slot = scheduler.getCurrentSlot(1790158330 * 1000);
    expect(slot.epoch).toBe(1790158200);
    expect(slot.slug).toBe("btc-updown-5m-1790158200");
    expect(slot.secondsRemaining).toBe(300 - 130); // 170s
    expect(slot.warmupPhase).toBe(false);
  });

  it("should trigger warmupPhase when remaining seconds <= warmupSeconds", () => {
    // 1790158460 -> 40 seconds remaining (< 45s)
    const slot = scheduler.getCurrentSlot(1790158460 * 1000);
    expect(slot.secondsRemaining).toBe(40);
    expect(slot.warmupPhase).toBe(true);
  });

  it("should calculate next slot accurately", () => {
    const next = scheduler.getNextSlot(1790158330 * 1000);
    expect(next.epoch).toBe(1790158500);
    expect(next.slug).toBe("btc-updown-5m-1790158500");
  });

  it("should trigger onWarmup and onRollover callbacks", () => {
    let warmupTriggered = false;
    let rolloverTriggered = false;

    const s = new SlotScheduler({ warmupSeconds: 45 });

    // Tick at 1790158400 (remaining 100s, no warmup)
    s.tick(1790158400 * 1000, {
      onWarmup: () => { warmupTriggered = true; },
      onRollover: () => { rolloverTriggered = true; },
    });
    expect(warmupTriggered).toBe(false);
    expect(rolloverTriggered).toBe(false);

    // Tick at 1790158460 (remaining 40s -> enters warmup)
    s.tick(1790158460 * 1000, {
      onWarmup: () => { warmupTriggered = true; },
      onRollover: () => { rolloverTriggered = true; },
    });
    expect(warmupTriggered).toBe(true);
    expect(rolloverTriggered).toBe(false);

    // Tick across boundary at 1790158501 (slot rollover)
    s.tick(1790158501 * 1000, {
      onWarmup: () => {},
      onRollover: () => { rolloverTriggered = true; },
    });
    expect(rolloverTriggered).toBe(true);
  });
});
