import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

// Mock the API client BEFORE importing the component so the module reads the
// mocked implementation. `simulationsApi.create` is what the dialog hits.
const createMock = vi.fn();
vi.mock("@/lib/api", () => {
  class MockApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public details?: Record<string, string[]>,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return {
    simulationsApi: {
      create: (...args: unknown[]) => createMock(...args),
    },
    ApiError: MockApiError,
  };
});

import { ImportAggregateDialog } from "../ImportAggregateDialog";

// -----------------------------------------------------------------------------
// Helpers

const US_CSV = [
  "#unit=nm",
  "x,y,z,radius",
  "0.0,0.0,0.0,1.0",
  "2.0,0.0,0.0,1.0",
  "4.0,0.0,0.0,1.0",
  "6.0,0.0,0.0,1.0",
  "8.0,0.0,0.0,1.0",
  "10.0,0.0,0.0,1.0",
].join("\n");

const SMALL_CSV = ["x,y,z,radius", "0.0,0.0,0.0,1.0", "2.0,0.0,0.0,1.0"].join(
  "\n",
);

function makeFile(name: string, content: string, sizeOverride?: number): File {
  const f = new File([content], name, { type: "text/plain" });
  if (sizeOverride !== undefined) {
    Object.defineProperty(f, "size", { value: sizeOverride, configurable: true });
  }
  return f;
}

function renderOpen(onSuccess = vi.fn(), onClose = vi.fn()) {
  return render(
    <ImportAggregateDialog
      projectId="proj-1"
      open={true}
      onClose={onClose}
      onSuccess={onSuccess}
    />,
  );
}

// -----------------------------------------------------------------------------

describe("ImportAggregateDialog", () => {
  beforeEach(() => {
    createMock.mockReset();
  });
  afterEach(() => {
    createMock.mockReset();
  });

  it("renders both CSV and MATLAB tabs", () => {
    renderOpen();
    expect(screen.getByRole("button", { name: /^CSV$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /MATLAB/i })).toBeTruthy();
  });

  it("CSV tab is active by default (shows CSV file input)", () => {
    renderOpen();
    expect(screen.getByLabelText(/CSV file/i)).toBeTruthy();
  });

  it("selecting a CSV file shows metadata + locale preview", async () => {
    renderOpen();
    const input = screen.getByLabelText(/CSV file/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [makeFile("agg.csv", US_CSV)] },
      });
    });
    // Preview heading and metadata section appear.
    await waitFor(() => {
      expect(screen.getByText(/Detected locale/i)).toBeTruthy();
    });
    expect(screen.getByText(/^Metadata$/)).toBeTruthy();
  });

  it("small-sample CSV shows the locale warning callout", async () => {
    renderOpen();
    const input = screen.getByLabelText(/CSV file/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [makeFile("small.csv", SMALL_CSV)] },
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("csv-locale-warning")).toBeTruthy();
    });
  });

  it("CSV metadata (#unit=nm) is extracted and rendered", async () => {
    renderOpen();
    const input = screen.getByLabelText(/CSV file/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [makeFile("agg.csv", US_CSV)] },
      });
    });
    await waitFor(() => {
      // The metadata dt/dd list renders the unit value.
      expect(screen.getByText("nm")).toBeTruthy();
    });
  });

  it("decimal and delimiter overrides are toggleable", async () => {
    renderOpen();
    const input = screen.getByLabelText(/CSV file/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [makeFile("agg.csv", US_CSV)] },
      });
    });
    await waitFor(() => screen.getByText(/Detected locale/i));

    // Flip decimal override to "," and delimiter to ";".
    const commaRadio = screen
      .getAllByRole("radio")
      .find(
        (el) =>
          (el as HTMLInputElement).name === "decimal-override" &&
          (el as HTMLInputElement).value === ",",
      ) as HTMLInputElement;
    const semicolonRadio = screen
      .getAllByRole("radio")
      .find(
        (el) =>
          (el as HTMLInputElement).name === "delimiter-override" &&
          (el as HTMLInputElement).value === ";",
      ) as HTMLInputElement;

    fireEvent.click(commaRadio);
    fireEvent.click(semicolonRadio);

    expect(commaRadio.checked).toBe(true);
    expect(semicolonRadio.checked).toBe(true);
  });

  it(".dat file is rejected client-side and no backend call is made", async () => {
    renderOpen();
    const input = screen.getByLabelText(/CSV file/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [makeFile("foo.dat", "irrelevant")] },
      });
    });
    await waitFor(() => {
      expect(
        screen.getByText(/The \.dat format from Box-Counter/i),
      ).toBeTruthy();
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("file over 10 MB is rejected client-side", async () => {
    renderOpen();
    const input = screen.getByLabelText(/CSV file/i) as HTMLInputElement;
    const big = makeFile("big.csv", "x,y,z,radius\n0,0,0,1\n", 11 * 1024 * 1024);
    await act(async () => {
      fireEvent.change(input, { target: { files: [big] } });
    });
    await waitFor(() => {
      expect(screen.getByText(/larger than 10 MB/i)).toBeTruthy();
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("MATLAB tab file upload triggers POST with format=mat", async () => {
    createMock.mockResolvedValue({ id: "sim-42" });
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    renderOpen(onSuccess, onClose);

    // Switch to MATLAB tab.
    fireEvent.click(screen.getByRole("button", { name: /MATLAB/i }));
    const matInput = screen.getByLabelText(/MATLAB file/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(matInput, {
        target: { files: [makeFile("agg.mat", "\x00\x01\x02")] },
      });
    });

    const submitBtn = screen.getByRole("button", { name: /Import \.mat/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    const [projectId, payload] = createMock.mock.calls[0];
    expect(projectId).toBe("proj-1");
    expect(payload.algorithm).toBe("imported");
    expect(payload.parameters.format).toBe("mat");
    expect(payload.parameters.original_filename).toBe("agg.mat");
    expect(typeof payload.csv_data).toBe("string");
    expect(onSuccess).toHaveBeenCalledWith("sim-42");
  });

  it("CSV submit POSTs with format=csv and base64 payload", async () => {
    createMock.mockResolvedValue({ id: "sim-99" });
    const onSuccess = vi.fn();
    renderOpen(onSuccess);

    const input = screen.getByLabelText(/CSV file/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [makeFile("agg.csv", US_CSV)] },
      });
    });
    await waitFor(() => screen.getByText(/Detected locale/i));

    const submitBtn = screen.getByRole("button", { name: /Import CSV/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    const [projectId, payload] = createMock.mock.calls[0];
    expect(projectId).toBe("proj-1");
    expect(payload.algorithm).toBe("imported");
    expect(payload.parameters.format).toBe("csv");
    expect(payload.parameters.original_filename).toBe("agg.csv");
    expect(typeof payload.csv_data).toBe("string");
    // No override was set → locale_override must not be sent.
    expect(payload.parameters.locale_override).toBeUndefined();
    expect(onSuccess).toHaveBeenCalledWith("sim-99");
  });
});
