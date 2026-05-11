import { describe, it, expect } from "vitest";

import { stereographicProject, directionsMatch } from "../stereographic";

// ---------------------------------------------------------------------------
// stereographicProject
// ---------------------------------------------------------------------------
describe("stereographicProject", () => {
  const SIZE = 300;
  const CENTER = SIZE / 2; // 150

  it("projects the pole (El=90°) to center", () => {
    const { x, y } = stereographicProject(0, 90, SIZE);
    expect(x).toBeCloseTo(CENTER, 5);
    expect(y).toBeCloseTo(CENTER, 5);
  });

  it("projects equator Az=0° to 3 o'clock (right edge)", () => {
    // Az=0° → right, El=0° → outer edge: r = (SIZE/2) * cos(0)/(1+sin(0)) = SIZE/2
    // x = CENTER + r*cos(0) = CENTER + SIZE/2 = SIZE
    // y = CENTER - r*sin(0) = CENTER
    const { x, y } = stereographicProject(0, 0, SIZE);
    expect(x).toBeCloseTo(SIZE, 5);
    expect(y).toBeCloseTo(CENTER, 5);
  });

  it("projects equator Az=90° to top (12 o'clock)", () => {
    // Az=90° counter-clockwise → top
    // x = CENTER + r*cos(90°) = CENTER + 0 = CENTER
    // y = CENTER - r*sin(90°) = CENTER - SIZE/2 = 0
    const { x, y } = stereographicProject(90, 0, SIZE);
    expect(x).toBeCloseTo(CENTER, 5);
    expect(y).toBeCloseTo(0, 5);
  });

  it("projects equator Az=180° to left (9 o'clock)", () => {
    // x = CENTER + r*cos(180°) = CENTER - SIZE/2 = 0
    // y = CENTER - r*sin(180°) = CENTER
    const { x, y } = stereographicProject(180, 0, SIZE);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(CENTER, 5);
  });

  it("projects equator Az=270° to bottom (6 o'clock)", () => {
    // x = CENTER + r*cos(270°) = CENTER + 0 = CENTER
    // y = CENTER - r*sin(270°) = CENTER + SIZE/2 = SIZE
    const { x, y } = stereographicProject(270, 0, SIZE);
    expect(x).toBeCloseTo(CENTER, 5);
    expect(y).toBeCloseTo(SIZE, 5);
  });

  it("projects 45° elevation to intermediate radius", () => {
    // r = (SIZE/2) * cos(45°)/(1+sin(45°))
    const r = (SIZE / 2) * Math.cos(Math.PI / 4) / (1 + Math.sin(Math.PI / 4));
    // At Az=0°: x = CENTER + r, y = CENTER
    const { x, y } = stereographicProject(0, 45, SIZE);
    expect(x).toBeCloseTo(CENTER + r, 5);
    expect(y).toBeCloseTo(CENTER, 5);
  });
});

// ---------------------------------------------------------------------------
// directionsMatch
// ---------------------------------------------------------------------------
describe("directionsMatch", () => {
  it("exact match returns true", () => {
    expect(directionsMatch({ az: 45, el: 30 }, { az: 45, el: 30 }, 0.5)).toBe(
      true,
    );
  });

  it("within tolerance returns true", () => {
    expect(
      directionsMatch({ az: 0, el: 0 }, { az: 0.4, el: 0.4 }, 0.5),
    ).toBe(true);
  });

  it("outside tolerance returns false", () => {
    expect(
      directionsMatch({ az: 0, el: 0 }, { az: 0.6, el: 0 }, 0.5),
    ).toBe(false);
  });

  it("handles azimuth wraparound (359.9° vs 0.0°)", () => {
    expect(
      directionsMatch({ az: 359.9, el: 0 }, { az: 0.0, el: 0 }, 0.5),
    ).toBe(true);
  });

  it("handles azimuth wraparound other way (0.1° vs 359.8°)", () => {
    expect(
      directionsMatch({ az: 0.1, el: 0 }, { az: 359.8, el: 0 }, 0.5),
    ).toBe(true);
  });

  it("no wraparound false positive for distant azimuths", () => {
    expect(
      directionsMatch({ az: 1, el: 0 }, { az: 358, el: 0 }, 0.5),
    ).toBe(false);
  });
});
