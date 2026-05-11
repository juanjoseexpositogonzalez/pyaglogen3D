import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { HemisphereGrid } from "../HemisphereGrid";
import { stereographicProject } from "@/lib/stereographic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SIZE = 300;

function gridDirs(count: number) {
  const dirs: Array<{ az: number; el: number }> = [];
  for (let i = 0; i < count; i++) {
    dirs.push({ az: (i * 30) % 360, el: (i * 15) % 90 });
  }
  return dirs;
}

function genDirs(count: number) {
  return gridDirs(count).map((d, i) => ({
    ...d,
    projectionId: `proj-${i}`,
  }));
}

// ---------------------------------------------------------------------------
// R1: SVG Grid Frame
// ---------------------------------------------------------------------------
describe("HemisphereGrid — R1 Grid Frame", () => {
  it("renders SVG with role=img and aria-label", () => {
    render(<HemisphereGrid gridDirections={[]} generatedDirections={[]} size={SIZE} />);
    const svg = screen.getByRole("img");
    expect(svg).toBeDefined();
    expect(svg.getAttribute("aria-label")).toContain("Projection direction coverage");
  });

  it("renders outer circle (equator boundary)", () => {
    const { container } = render(
      <HemisphereGrid gridDirections={[]} generatedDirections={[]} size={SIZE} />,
    );
    // Outer circle = circle with r = SIZE/2 (approximately)
    const circles = container.querySelectorAll("circle[data-grid='parallel']");
    // 5 parallels + outer boundary = at least the outer one
    const outerCircle = container.querySelector("circle[data-grid='boundary']");
    expect(outerCircle).not.toBeNull();
  });

  it("renders 5 parallels (at 15°, 30°, 45°, 60°, 75°)", () => {
    const { container } = render(
      <HemisphereGrid gridDirections={[]} generatedDirections={[]} size={SIZE} />,
    );
    const parallels = container.querySelectorAll("circle[data-grid='parallel']");
    expect(parallels.length).toBe(5);
  });

  it("renders 12 meridians (every 30°)", () => {
    const { container } = render(
      <HemisphereGrid gridDirections={[]} generatedDirections={[]} size={SIZE} />,
    );
    const meridians = container.querySelectorAll("line[data-grid='meridian']");
    expect(meridians.length).toBe(12);
  });

  it("renders center pole marker", () => {
    const { container } = render(
      <HemisphereGrid gridDirections={[]} generatedDirections={[]} size={SIZE} />,
    );
    const pole = container.querySelector("circle[data-grid='pole']");
    expect(pole).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R2: Dot Placement
// ---------------------------------------------------------------------------
describe("HemisphereGrid — R2 Dot Placement", () => {
  it("renders a dot for each grid direction", () => {
    const dirs = gridDirs(5);
    const { container } = render(
      <HemisphereGrid gridDirections={dirs} generatedDirections={[]} size={SIZE} />,
    );
    const dots = container.querySelectorAll("[data-dot='grid']");
    expect(dots.length).toBe(5);
  });

  it("positions dots using stereographic projection formula", () => {
    const dir = { az: 45, el: 30 };
    const expected = stereographicProject(45, 30, SIZE);
    const { container } = render(
      <HemisphereGrid gridDirections={[dir]} generatedDirections={[]} size={SIZE} />,
    );
    const dot = container.querySelector("[data-dot='grid']");
    expect(dot).not.toBeNull();
    const cx = Number(dot!.getAttribute("cx"));
    const cy = Number(dot!.getAttribute("cy"));
    expect(cx).toBeCloseTo(expected.x, 1);
    expect(cy).toBeCloseTo(expected.y, 1);
  });

  it("renders generated dots separately from grid dots", () => {
    const grid = [{ az: 0, el: 0 }, { az: 90, el: 45 }];
    const gen = [{ az: 0, el: 0, projectionId: "p1" }];
    const { container } = render(
      <HemisphereGrid gridDirections={grid} generatedDirections={gen} size={SIZE} />,
    );
    // Grid dots that are NOT generated = 1 (az=90,el=45)
    // Generated dots = 1 (az=0,el=0)
    const gridDots = container.querySelectorAll("[data-dot='grid']");
    const genDots = container.querySelectorAll("[data-dot='generated']");
    expect(gridDots.length).toBe(1);
    expect(genDots.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// R3: Dot States
// ---------------------------------------------------------------------------
describe("HemisphereGrid — R3 Dot States", () => {
  it("grid-only dots have radius 3", () => {
    const { container } = render(
      <HemisphereGrid gridDirections={[{ az: 0, el: 0 }]} generatedDirections={[]} size={SIZE} />,
    );
    const dot = container.querySelector("[data-dot='grid']");
    expect(dot!.getAttribute("r")).toBe("3");
  });

  it("generated dots have radius 5", () => {
    const gen = [{ az: 0, el: 0, projectionId: "p1" }];
    const { container } = render(
      <HemisphereGrid gridDirections={[{ az: 0, el: 0 }]} generatedDirections={gen} size={SIZE} />,
    );
    const dot = container.querySelector("[data-dot='generated']");
    expect(dot!.getAttribute("r")).toBe("5");
  });

  it("selected dot has a stroke ring", () => {
    const gen = [{ az: 0, el: 0, projectionId: "p1" }];
    const { container } = render(
      <HemisphereGrid
        gridDirections={[{ az: 0, el: 0 }]}
        generatedDirections={gen}
        selectedDirection={{ az: 0, el: 0 }}
        size={SIZE}
      />,
    );
    const dot = container.querySelector("[data-dot='selected']");
    expect(dot).not.toBeNull();
    expect(dot!.getAttribute("r")).toBe("5");
    // Selected dot has a stroke
    expect(dot!.getAttribute("stroke")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// R4: Hover Tooltip
// ---------------------------------------------------------------------------
describe("HemisphereGrid — R4 Tooltip", () => {
  it("generated dot has a <title> element with Az/El info", () => {
    const gen = [{ az: 45, el: 30, projectionId: "p1" }];
    const { container } = render(
      <HemisphereGrid gridDirections={[{ az: 45, el: 30 }]} generatedDirections={gen} size={SIZE} />,
    );
    const title = container.querySelector("[data-dot='generated'] title");
    expect(title).not.toBeNull();
    expect(title!.textContent).toContain("Az: 45");
    expect(title!.textContent).toContain("El: 30");
  });

  it("grid-only dot also has a <title> element", () => {
    const { container } = render(
      <HemisphereGrid gridDirections={[{ az: 90, el: 60 }]} generatedDirections={[]} size={SIZE} />,
    );
    const title = container.querySelector("[data-dot='grid'] title");
    expect(title).not.toBeNull();
    expect(title!.textContent).toContain("Az: 90");
    expect(title!.textContent).toContain("El: 60");
  });
});

// ---------------------------------------------------------------------------
// R5: Click Interaction
// ---------------------------------------------------------------------------
describe("HemisphereGrid — R5 Click", () => {
  it("clicking generated dot fires onDirectionClick with correct entry", () => {
    const onClick = vi.fn();
    const gen = [{ az: 45, el: 30, projectionId: "p1" }];
    const { container } = render(
      <HemisphereGrid
        gridDirections={[{ az: 45, el: 30 }]}
        generatedDirections={gen}
        onDirectionClick={onClick}
        size={SIZE}
      />,
    );
    const dot = container.querySelector("[data-dot='generated']");
    fireEvent.click(dot!);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith({ az: 45, el: 30, projectionId: "p1" });
  });

  it("clicking ungenerated dot does NOT fire onDirectionClick", () => {
    const onClick = vi.fn();
    const { container } = render(
      <HemisphereGrid
        gridDirections={[{ az: 90, el: 60 }]}
        generatedDirections={[]}
        onDirectionClick={onClick}
        size={SIZE}
      />,
    );
    const dot = container.querySelector("[data-dot='grid']");
    fireEvent.click(dot!);
    expect(onClick).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R6/R7: Empty state
// ---------------------------------------------------------------------------
describe("HemisphereGrid — R6 Empty State", () => {
  it("renders grid frame with no dots when gridDirections is empty", () => {
    const { container } = render(
      <HemisphereGrid gridDirections={[]} generatedDirections={[]} size={SIZE} />,
    );
    const dots = container.querySelectorAll("[data-dot]");
    expect(dots.length).toBe(0);
    // Frame still present
    const boundary = container.querySelector("[data-grid='boundary']");
    expect(boundary).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R8: Performance warning
// ---------------------------------------------------------------------------
describe("HemisphereGrid — R8 Console Warning", () => {
  it("warns when gridDirections exceeds 500", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dirs = gridDirs(501);
    render(<HemisphereGrid gridDirections={dirs} generatedDirections={[]} size={SIZE} />);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("500"),
    );
    spy.mockRestore();
  });

  it("does NOT warn when gridDirections is 500 or fewer", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dirs = gridDirs(500);
    render(<HemisphereGrid gridDirections={dirs} generatedDirections={[]} size={SIZE} />);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// R9: Accessibility
// ---------------------------------------------------------------------------
describe("HemisphereGrid — R9 Accessibility", () => {
  it("SVG has role=img", () => {
    render(<HemisphereGrid gridDirections={[]} generatedDirections={[]} size={SIZE} />);
    expect(screen.getByRole("img")).toBeDefined();
  });

  it("aria-label includes direction counts", () => {
    const gen = [{ az: 0, el: 0, projectionId: "p1" }];
    render(
      <HemisphereGrid gridDirections={[{ az: 0, el: 0 }, { az: 90, el: 45 }]} generatedDirections={gen} size={SIZE} />,
    );
    const label = screen.getByRole("img").getAttribute("aria-label")!;
    expect(label).toContain("1 of 2");
  });

  it("generated dots have tabindex=0, grid-only dots do not", () => {
    const gen = [{ az: 0, el: 0, projectionId: "p1" }];
    const { container } = render(
      <HemisphereGrid
        gridDirections={[{ az: 0, el: 0 }, { az: 90, el: 45 }]}
        generatedDirections={gen}
        size={SIZE}
      />,
    );
    const genDot = container.querySelector("[data-dot='generated']");
    const gridDot = container.querySelector("[data-dot='grid']");
    expect(genDot!.getAttribute("tabindex")).toBe("0");
    expect(gridDot!.hasAttribute("tabindex")).toBe(false);
  });
});
