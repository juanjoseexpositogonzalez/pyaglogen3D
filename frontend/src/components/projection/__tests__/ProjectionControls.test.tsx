import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

import { ProjectionControls, computeGridCount } from "../ProjectionControls";
import type { ExportProjectionsPayload } from "@/lib/api";

// -----------------------------------------------------------------------------
// Minimal viewer-store shim. The component reads `cameraAzimuth` /
// `cameraElevation` for the "3D View" shortcut; anything else would pull in
// three.js which we don't need for these tests.
vi.mock("@/stores/viewerStore", () => ({
  useViewerStore: () => ({ cameraAzimuth: 0, cameraElevation: 0 }),
}));

// -----------------------------------------------------------------------------

function renderControls(overrides: {
  onPreview?: ReturnType<typeof vi.fn>;
  onDownloadBatch?: ReturnType<typeof vi.fn>;
  onExport?: ReturnType<typeof vi.fn>;
} = {}) {
  const onPreview = overrides.onPreview ?? vi.fn();
  const onDownloadBatch = overrides.onDownloadBatch ?? vi.fn();
  // vi.fn's inferred return type is `unknown`, which doesn't widen to the
  // component's `void | Promise<void>` signature under TS's strict checks.
  // Cast explicitly so the mock is still assertable AND the types line up.
  const onExport =
    overrides.onExport ??
    (vi.fn(async () => undefined) as unknown as ReturnType<typeof vi.fn>);
  const result = render(
    <ProjectionControls
      onPreview={onPreview}
      onDownloadBatch={onDownloadBatch}
      onExport={
        onExport as unknown as (
          payload: unknown,
          onProgress?: unknown,
        ) => Promise<void>
      }
    />,
  );
  return { ...result, onPreview, onDownloadBatch, onExport };
}

function modeSelect(): HTMLSelectElement {
  return screen.getByLabelText(/sampling mode/i) as HTMLSelectElement;
}

function selectMode(value: "grid" | "fibonacci" | "legacy") {
  fireEvent.change(modeSelect(), { target: { value } });
}

function setNumber(label: RegExp, value: number) {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.change(input, { target: { value: String(value) } });
}

// -----------------------------------------------------------------------------

describe("computeGridCount (R1 formula)", () => {
  it("matches n_az*(n_el-2) + 2 for known inputs", () => {
    expect(computeGridCount(10, 5)).toBe(32); // 10*3 + 2
    expect(computeGridCount(4, 3)).toBe(6); // 4*1 + 2
    expect(computeGridCount(1, 2)).toBe(2); // both poles only
    expect(computeGridCount(10, 7)).toBe(52); // 10*5 + 2
  });

  it("returns 0 for invalid inputs (n_el<2, n_az<1, NaN)", () => {
    expect(computeGridCount(10, 1)).toBe(0);
    expect(computeGridCount(0, 5)).toBe(0);
    expect(computeGridCount(NaN, 5)).toBe(0);
  });
});

describe("ProjectionControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with grid mode selected by default", () => {
    renderControls();
    expect(modeSelect().value).toBe("grid");
  });

  it("shows n_az and n_el inputs in grid mode", () => {
    renderControls();
    expect(screen.getByLabelText(/azimuth samples/i)).toBeTruthy();
    expect(screen.getByLabelText(/elevation samples/i)).toBeTruthy();
    // Fibonacci / legacy inputs are NOT in the DOM.
    expect(screen.queryByLabelText(/number of directions/i)).toBeNull();
    expect(screen.queryByText(/^az start$/i)).toBeNull();
  });

  it("preview count for grid mode uses the R1 formula", () => {
    renderControls();
    setNumber(/azimuth samples/i, 10);
    setNumber(/elevation samples/i, 5);

    const preview = screen.getByTestId("projection-count-preview");
    // 10*(5-2) + 2 = 32
    expect(preview.textContent).toMatch(/32/);
  });

  it("switching to fibonacci mode shows only the n input", () => {
    renderControls();
    selectMode("fibonacci");

    expect(screen.getByLabelText(/number of directions/i)).toBeTruthy();
    expect(screen.queryByLabelText(/azimuth samples/i)).toBeNull();
    expect(screen.queryByLabelText(/elevation samples/i)).toBeNull();
    expect(screen.queryByText(/^az start$/i)).toBeNull();
  });

  it("fibonacci preview count matches n exactly", () => {
    renderControls();
    selectMode("fibonacci");
    setNumber(/number of directions/i, 50);

    const preview = screen.getByTestId("projection-count-preview");
    expect(preview.textContent).toMatch(/50/);
    expect(preview.textContent).toMatch(/uniform/i);
  });

  it("switching to legacy mode shows the original 6 sweep inputs", () => {
    renderControls();
    selectMode("legacy");

    // All 6 legacy fields appear as text labels (they use implicit labels,
    // not htmlFor — matching the pre-change component verbatim).
    expect(screen.getByText(/^az start$/i)).toBeTruthy();
    expect(screen.getByText(/^az end$/i)).toBeTruthy();
    expect(screen.getByText(/^az step$/i)).toBeTruthy();
    expect(screen.getByText(/^el start$/i)).toBeTruthy();
    expect(screen.getByText(/^el end$/i)).toBeTruthy();
    expect(screen.getByText(/^el step$/i)).toBeTruthy();
    // Grid/fib inputs are gone
    expect(screen.queryByLabelText(/azimuth samples/i)).toBeNull();
    expect(screen.queryByLabelText(/number of directions/i)).toBeNull();
  });

  it("submit calls onExport with a grid payload matching the inputs", async () => {
    const { onExport } = renderControls();
    setNumber(/azimuth samples/i, 8);
    setNumber(/elevation samples/i, 4);

    const submitBtn = screen.getByRole("button", { name: /download zip/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    const [payload] = onExport.mock.calls[0] as [ExportProjectionsPayload];
    expect(payload.mode).toBe("grid");
    expect(payload.n_az).toBe(8);
    expect(payload.n_el).toBe(4);
    // Fibonacci-only fields are NOT present for grid mode.
    expect(payload.n).toBeUndefined();
  });

  it("submit calls onExport with a fibonacci payload", async () => {
    const { onExport } = renderControls();
    selectMode("fibonacci");
    setNumber(/number of directions/i, 123);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /download zip/i }));
    });

    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    const [payload] = onExport.mock.calls[0] as [ExportProjectionsPayload];
    expect(payload.mode).toBe("fibonacci");
    expect(payload.n).toBe(123);
    // Grid-only fields absent.
    expect(payload.n_az).toBeUndefined();
    expect(payload.n_el).toBeUndefined();
  });

  it("submit in legacy mode calls onExport with a legacy payload", async () => {
    const { onExport } = renderControls();
    selectMode("legacy");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /download zip/i }));
    });

    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    const [payload] = onExport.mock.calls[0] as [ExportProjectionsPayload];
    expect(payload.mode).toBe("legacy");
    expect(payload.azimuth_start).toBe(0);
    expect(payload.azimuth_end).toBe(150);
    expect(payload.azimuth_step).toBe(30);
    expect(payload.elevation_start).toBe(0);
    expect(payload.elevation_end).toBe(90);
    expect(payload.elevation_step).toBe(30);
  });

  it("grid with n_el<2 surfaces an error and disables submit", () => {
    renderControls();
    setNumber(/elevation samples/i, 1);

    expect(screen.getByTestId("grid-n-el-error")).toBeTruthy();
    const submitBtn = screen.getByRole("button", {
      name: /download zip/i,
    }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it("fibonacci with n<1 or n>10000 surfaces an error and disables submit", () => {
    renderControls();
    selectMode("fibonacci");
    setNumber(/number of directions/i, 0);
    expect(screen.getByTestId("fib-n-error")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /download zip/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    setNumber(/number of directions/i, 100000);
    expect(screen.getByTestId("fib-n-error")).toBeTruthy();
  });

  it("falls back to onDownloadBatch in legacy mode when onExport is not provided", async () => {
    const onDownloadBatch = vi.fn();
    render(
      <ProjectionControls
        onPreview={vi.fn()}
        onDownloadBatch={onDownloadBatch}
      />,
    );
    selectMode("legacy");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /download zip/i }));
    });

    await waitFor(() => expect(onDownloadBatch).toHaveBeenCalledTimes(1));
    const [payload] = onDownloadBatch.mock.calls[0];
    expect(payload.azimuth_start).toBe(0);
    expect(payload.elevation_end).toBe(90);
    expect(payload.format).toBe("png");
  });
});
