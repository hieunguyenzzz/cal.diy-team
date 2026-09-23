import { describe, expect, it } from "vitest";
import { hasOnlyZeroWeightRoundRobinHosts } from "./roundRobinWeights";

const rr = (weight: number | null) => ({ isFixed: false, weight });
const fixed = (weight: number | null) => ({ isFixed: true, weight });

describe("hasOnlyZeroWeightRoundRobinHosts", () => {
  it("is true when weights are on and every round-robin host is at 0", () => {
    expect(
      hasOnlyZeroWeightRoundRobinHosts({ isRRWeightsEnabled: true, hosts: [rr(0), rr(0), fixed(100)] })
    ).toBe(true);
  });

  it("is false once any round-robin host has weight above 0", () => {
    expect(hasOnlyZeroWeightRoundRobinHosts({ isRRWeightsEnabled: true, hosts: [rr(0), rr(1)] })).toBe(false);
  });

  it("treats a missing weight as the default, not 0", () => {
    expect(hasOnlyZeroWeightRoundRobinHosts({ isRRWeightsEnabled: true, hosts: [rr(0), rr(null)] })).toBe(
      false
    );
  });

  it("ignores weights when they are off, and events without round-robin hosts", () => {
    expect(hasOnlyZeroWeightRoundRobinHosts({ isRRWeightsEnabled: false, hosts: [rr(0)] })).toBe(false);
    expect(hasOnlyZeroWeightRoundRobinHosts({ isRRWeightsEnabled: true, hosts: [fixed(0)] })).toBe(false);
    expect(hasOnlyZeroWeightRoundRobinHosts({ isRRWeightsEnabled: true, hosts: [] })).toBe(false);
  });
});
