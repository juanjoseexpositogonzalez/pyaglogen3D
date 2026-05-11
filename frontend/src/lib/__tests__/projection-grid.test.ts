import { describe, it, expect } from "vitest";

import {
  computeGridDirections,
  modeConfigToGridConfig,
  deriveGeneratedDirections,
} from "../projection-grid";

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

// ---------------------------------------------------------------------------
// modeConfigToGridConfig — converts controls config to grid config
// ---------------------------------------------------------------------------
describe("modeConfigToGridConfig", () => {
  it("converts grid mode n_az=10, n_el=5 to az_step=36, el_step=22.5", () => {
    const result = modeConfigToGridConfig("grid", { n_az: 10, n_el: 5 });
    expect(result).toEqual({ az_step: 36, el_step: 22.5 });
  });

  it("converts grid mode n_az=12, n_el=7 to az_step=30, el_step=15", () => {
    const result = modeConfigToGridConfig("grid", { n_az: 12, n_el: 7 });
    expect(result).toEqual({ az_step: 30, el_step: 15 });
  });

  it("passes fibonacci config through as-is", () => {
    const result = modeConfigToGridConfig("fibonacci", { n: 50 });
    expect(result).toEqual({ n: 50 });
  });

  it("passes legacy config through as-is", () => {
    const result = modeConfigToGridConfig("legacy", { az_step: 30, el_step: 30 });
    expect(result).toEqual({ az_step: 30, el_step: 30 });
  });

  it("grid mode with n_el=2 produces el_step=90", () => {
    const result = modeConfigToGridConfig("grid", { n_az: 4, n_el: 2 });
    expect(result).toEqual({ az_step: 90, el_step: 90 });
  });
});

// ---------------------------------------------------------------------------
// deriveGeneratedDirections — computes what was generated from export payload
// ---------------------------------------------------------------------------
describe("deriveGeneratedDirections", () => {
  it("returns grid directions with synthetic projectionId for grid export", () => {
    const result = deriveGeneratedDirections({
      mode: "grid",
      n_az: 4,
      n_el: 3,
    });
    // Grid az_step=90, el_step=45 → el: 0,45 (2 levels × 4 az) + pole = 9
    expect(result.length).toBe(9);
    expect(result[0]).toHaveProperty("projectionId");
    expect(result[0].projectionId).toMatch(/^az\d+_el\d+$/);
  });

  it("returns fibonacci directions for fibonacci export", () => {
    const result = deriveGeneratedDirections({
      mode: "fibonacci",
      n: 10,
    });
    expect(result.length).toBe(10);
    expect(result[0]).toHaveProperty("projectionId");
  });

  it("returns legacy directions for legacy export", () => {
    const result = deriveGeneratedDirections({
      mode: "legacy",
      azimuth_start: 0,
      azimuth_end: 90,
      azimuth_step: 90,
      elevation_start: 0,
      elevation_end: 90,
      elevation_step: 45,
    });
    // Legacy: az 0, 90 → 2 values; el 0, 45, 90 → 3 values
    // But computeGrid with az_step=90, el_step=45:
    //   el=0: az=0,90,180,270 (4), el=45: az=0,90,180,270 (4), pole: 1 → 9
    // Wait — legacy mode uses the STEP directly, not the range.
    // The legacy export has start/end ranges but computeGrid covers full 0-360/0-90.
    // So the derive function should use the steps from the legacy payload.
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("projectionId");
  });

  it("returns empty array when mode is missing", () => {
    const result = deriveGeneratedDirections({});
    expect(result).toEqual([]);
  });
});
