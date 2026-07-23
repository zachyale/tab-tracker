import { describe, expect, it } from "vitest";
import { crossedTriggers, DEFAULT_TRIGGERS_CENTS } from "../src/lib/notifications.js";

describe("crossedTriggers", () => {
  it("defaults to a single $20 trigger", () => {
    expect(DEFAULT_TRIGGERS_CENTS).toEqual([2000]);
  });

  it("fires when the balance crosses a trigger from below", () => {
    expect(crossedTriggers(1900, 2100, [2000])).toEqual([2000]);
  });

  it("fires when landing exactly on the trigger", () => {
    expect(crossedTriggers(1700, 2000, [2000])).toEqual([2000]);
  });

  it("does not fire when already at or above the trigger", () => {
    expect(crossedTriggers(2000, 2300, [2000])).toEqual([]);
    expect(crossedTriggers(2500, 2800, [2000])).toEqual([]);
  });

  it("does not fire when the balance decreases", () => {
    expect(crossedTriggers(2100, 1900, [2000])).toEqual([]);
  });

  it("can cross several triggers in one jump", () => {
    expect(crossedTriggers(500, 5500, [1000, 2000, 5000])).toEqual([1000, 2000, 5000]);
  });

  it("ignores non-positive triggers", () => {
    expect(crossedTriggers(-100, 100, [0, -500])).toEqual([]);
  });
});
