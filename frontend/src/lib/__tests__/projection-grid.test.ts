import { describe, it, expect } from "vitest";

import { computeGridDirections } from "../projection-grid";

// ---------------------------------------------------------------------------
// Grid mode
// ---------------------------------------------------------------------------
describe("computeGridDirections — grid mode", () => {
  it("generates correct count for az_step=30, el_step=15", () => {
    // Az: 0, 30, 60, ..., 330 → 12 values
    // El: 0, 15, 30, 45, 60, 75, 90 → 7 values
    // At El=90° (pole), only 1 point (deduplicated)
    // Total = 12 * 6 + 1 = 73
    const result = computeGridDirections("grid", { az_step: 30, el_step: 15 });
    expect(result.length).toBe(73);
  });

  it("generates correct count for az_step=90, el_step=45", () => {
    // Az: 0, 90, 180, 270 → 4 values
    // El: 0, 45, 90 → 3 values
    // Non-pole: 4 * 2 = 8, pole: 1 → 9
    const result = computeGridDirections("grid", { az_step: 90, el_step: 45 });
    expect(result.length).toBe(9);
  });

  it("all elevations are in [0, 90]", () => {
    const result = computeGridDirections("grid", { az_step: 30, el_step: 15 });
    for (const d of result) {
      expect(d.el).toBeGreaterThanOrEqual(0);
      expect(d.el).toBeLessThanOrEqual(90);
    }
  });

  it("all azimuths are in [0, 360)", () => {
    const result = computeGridDirections("grid", { az_step: 30, el_step: 15 });
    for (const d of result) {
      expect(d.az).toBeGreaterThanOrEqual(0);
      expect(d.az).toBeLessThan(360);
    }
  });

  it("contains the pole (El=90) exactly once", () => {
    const result = computeGridDirections("grid", { az_step: 30, el_step: 15 });
    const poles = result.filter((d) => d.el === 90);
    expect(poles.length).toBe(1);
  });

  it("returns empty for az_step=0", () => {
    const result = computeGridDirections("grid", { az_step: 0, el_step: 15 });
    expect(result).toEqual([]);
  });

  it("returns empty for el_step=0", () => {
    const result = computeGridDirections("grid", { az_step: 30, el_step: 0 });
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fibonacci mode
// ---------------------------------------------------------------------------
describe("computeGridDirections — fibonacci mode", () => {
  it("returns exactly n points", () => {
    const result = computeGridDirections("fibonacci", { n: 50 });
    expect(result.length).toBe(50);
  });

  it("all elevations are in [0, 90]", () => {
    const result = computeGridDirections("fibonacci", { n: 100 });
    for (const d of result) {
      expect(d.el).toBeGreaterThanOrEqual(0);
      expect(d.el).toBeLessThanOrEqual(90);
    }
  });

  it("all azimuths are in [0, 360)", () => {
    const result = computeGridDirections("fibonacci", { n: 100 });
    for (const d of result) {
      expect(d.az).toBeGreaterThanOrEqual(0);
      expect(d.az).toBeLessThan(360);
    }
  });

  it("n=1 returns a single point near the pole", () => {
    const result = computeGridDirections("fibonacci", { n: 1 });
    expect(result.length).toBe(1);
    // Single point should be at El=90 (top of hemisphere)
    expect(result[0].el).toBe(90);
  });

  it("no duplicate directions (min distance > 0 for n=50)", () => {
    const result = computeGridDirections("fibonacci", { n: 50 });
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const azDiff = Math.abs(result[i].az - result[j].az);
        const elDiff = Math.abs(result[i].el - result[j].el);
        // At least one coordinate must differ by more than 0.01°
        expect(azDiff > 0.01 || elDiff > 0.01).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Legacy mode
// ---------------------------------------------------------------------------
describe("computeGridDirections — legacy mode", () => {
  it("produces same output as grid mode for same parameters", () => {
    const gridResult = computeGridDirections("grid", { az_step: 30, el_step: 15 });
    const legacyResult = computeGridDirections("legacy", { az_step: 30, el_step: 15 });
    expect(legacyResult).toEqual(gridResult);
  });
});
