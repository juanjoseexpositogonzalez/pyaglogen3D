import { describe, it, expect } from "vitest";
import { formatNumber } from "../utils";

/**
 * Regression guards for `formatNumber`.
 *
 * The backend's `compute_import_metrics` (apps/simulations/tasks.py) legally
 * emits `fractal_dimension: null` / `fractal_dimension_std: null` for imported
 * agglomerates with < 50 particles (box-counting is not stable at that size).
 * Before this guard, calling `formatNumber(null, 3)` ran `null.toExponential`
 * which threw a TypeError and surfaced as the opaque Next.js "Application
 * error: a client-side exception has occurred" after successful CSV imports.
 */
describe("formatNumber", () => {
  it("formats positive numbers with fixed decimals", () => {
    expect(formatNumber(1.23456, 3)).toBe("1.235");
    expect(formatNumber(42, 0)).toBe("42");
    expect(formatNumber(1.5, 1)).toBe("1.5");
  });

  it("formats negative numbers", () => {
    expect(formatNumber(-1.5, 2)).toBe("-1.50");
  });

  it("uses exponential for very small non-zero values", () => {
    expect(formatNumber(0.0001, 3)).toBe("1.000e-4");
    expect(formatNumber(-0.0005, 2)).toBe("-5.00e-4");
  });

  it("formats exact zero with fixed decimals (not exponential)", () => {
    // Pre-fix bug: `Math.abs(0) < 0.001` was true, so `(0).toExponential(3)`
    // was returned as "0.000e+0" — ugly and inconsistent with other zeros.
    expect(formatNumber(0, 3)).toBe("0.000");
  });

  it("returns em-dash for null (backend's 'not computed' sentinel)", () => {
    expect(formatNumber(null, 3)).toBe("—");
  });

  it("returns em-dash for undefined (missing field in response)", () => {
    expect(formatNumber(undefined, 3)).toBe("—");
  });

  it("returns em-dash for NaN", () => {
    expect(formatNumber(NaN, 3)).toBe("—");
  });

  it("returns em-dash for ±Infinity", () => {
    expect(formatNumber(Infinity, 3)).toBe("—");
    expect(formatNumber(-Infinity, 3)).toBe("—");
  });

  it("uses a default of 2 decimals", () => {
    expect(formatNumber(1.236)).toBe("1.24");
  });
});
