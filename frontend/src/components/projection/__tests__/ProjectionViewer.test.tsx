import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ProjectionViewer } from "../ProjectionViewer";

// ---------------------------------------------------------------------------
// Basic rendering (existing behavior regression)
// ---------------------------------------------------------------------------
describe("ProjectionViewer — basic rendering", () => {
  it("renders preview image when imageUrl is provided", () => {
    render(
      <ProjectionViewer
        imageUrl="/test.png"
        azimuth={45}
        elevation={30}
        format="png"
      />,
    );
    const img = screen.getByAltText(/2D Projection at Az=45°, El=30°/);
    expect(img).toBeDefined();
  });

  it("renders placeholder when imageUrl is null", () => {
    render(
      <ProjectionViewer
        imageUrl={null}
        azimuth={0}
        elevation={0}
        format="png"
      />,
    );
    expect(screen.getByText(/Generate a preview/)).toBeDefined();
  });

  it("shows download button when imageUrl is present", () => {
    render(
      <ProjectionViewer
        imageUrl="/test.png"
        azimuth={45}
        elevation={30}
        format="png"
      />,
    );
    expect(screen.getByText("Save")).toBeDefined();
  });

  it("does NOT render HemisphereGrid when gridDirections is omitted", () => {
    const { container } = render(
      <ProjectionViewer
        imageUrl="/test.png"
        azimuth={45}
        elevation={30}
        format="png"
      />,
    );
    expect(container.querySelector("[role='img']")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HemisphereGrid integration (Phase 3)
// ---------------------------------------------------------------------------
describe("ProjectionViewer — HemisphereGrid integration", () => {
  const gridDirs = [
    { az: 0, el: 0 },
    { az: 90, el: 45 },
    { az: 180, el: 90 },
  ];
  const genDirs = [
    { az: 0, el: 0, projectionId: "p1" },
    { az: 90, el: 45, projectionId: "p2" },
  ];

  it("renders HemisphereGrid when gridDirections is provided", () => {
    const { container } = render(
      <ProjectionViewer
        imageUrl="/test.png"
        azimuth={0}
        elevation={0}
        format="png"
        gridDirections={gridDirs}
        generatedDirections={genDirs}
      />,
    );
    const svg = container.querySelector("svg[role='img']");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-label")).toContain("2 of 3");
  });

  it("passes selectedDirection from current azimuth/elevation", () => {
    const { container } = render(
      <ProjectionViewer
        imageUrl="/test.png"
        azimuth={0}
        elevation={0}
        format="png"
        gridDirections={gridDirs}
        generatedDirections={genDirs}
      />,
    );
    // The dot at az=0,el=0 should be marked as selected
    const selectedDot = container.querySelector("[data-dot='selected']");
    expect(selectedDot).not.toBeNull();
  });

  it("fires onDirectionClick when generated dot is clicked", () => {
    const onClick = vi.fn();
    const { container } = render(
      <ProjectionViewer
        imageUrl="/test.png"
        azimuth={180}
        elevation={90}
        format="png"
        gridDirections={gridDirs}
        generatedDirections={genDirs}
        onDirectionClick={onClick}
      />,
    );
    // Click first generated dot (az=0, el=0 or az=90, el=45)
    const genDots = container.querySelectorAll("[data-dot='generated']");
    expect(genDots.length).toBeGreaterThan(0);
    fireEvent.click(genDots[0]);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0]).toHaveProperty("projectionId");
  });

  it("does NOT render HemisphereGrid when gridDirections is empty array", () => {
    const { container } = render(
      <ProjectionViewer
        imageUrl="/test.png"
        azimuth={45}
        elevation={30}
        format="png"
        gridDirections={[]}
        generatedDirections={[]}
      />,
    );
    expect(container.querySelector("[role='img']")).toBeNull();
  });
});
