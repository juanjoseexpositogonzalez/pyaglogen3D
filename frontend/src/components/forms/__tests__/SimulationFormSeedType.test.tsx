import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { SimulationForm } from "../SimulationForm";

// --------------------------------------------------------------------------
// Seed Type dropdown tests for CC tunable simulation form (T5.1 / T5.2 / T5.3)
// --------------------------------------------------------------------------

/**
 * Helper: renders the form and selects an algorithm by changing the
 * first <select> (algorithm dropdown, which has no explicit label).
 */
function renderWithAlgorithm(algorithm: string) {
  const onSubmit = vi.fn();
  render(<SimulationForm onSubmit={onSubmit} />);

  // The algorithm <select> is the first combobox in the form.
  const algorithmSelect = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
  fireEvent.change(algorithmSelect, { target: { value: algorithm } });

  return { onSubmit };
}

describe("SimulationForm — Seed Type dropdown (T5.1)", () => {
  it("renders the Seed Type dropdown with 3 options when algorithm is tunable_cc", () => {
    renderWithAlgorithm("tunable_cc");

    // The dropdown should be labelled "Seed Type"
    const seedSelect = screen.getByLabelText(/seed type/i);
    expect(seedSelect).toBeDefined();

    // It should be a <select> with 3 options
    const options = within(seedSelect as HTMLElement).getAllByRole("option");
    expect(options).toHaveLength(3);

    // Check option labels
    const labels = options.map((o) => o.textContent);
    expect(labels).toContain("Monomers (default)");
    expect(labels).toContain("Dimers");
    expect(labels).toContain("Trimers");
  });

  it("has 'monomers' selected by default", () => {
    renderWithAlgorithm("tunable_cc");

    const seedSelect = screen.getByLabelText(/seed type/i) as HTMLSelectElement;
    expect(seedSelect.value).toBe("monomers");
  });

  it("does NOT render Seed Type dropdown for ballistic_cc algorithm", () => {
    renderWithAlgorithm("ballistic_cc");

    const seedSelect = screen.queryByLabelText(/seed type/i);
    expect(seedSelect).toBeNull();
  });

  it("does NOT render Seed Type dropdown for tunable (PC) algorithm", () => {
    renderWithAlgorithm("tunable");

    const seedSelect = screen.queryByLabelText(/seed type/i);
    expect(seedSelect).toBeNull();
  });

  it("renders helper text explaining FZR origin", () => {
    renderWithAlgorithm("tunable_cc");

    expect(
      screen.getByText(/initial particle grouping/i)
    ).toBeDefined();
  });
});

describe("SimulationForm — seed_type state + API payload (T5.2)", () => {
  it("updates seed_type when user selects dimers", () => {
    renderWithAlgorithm("tunable_cc");

    const seedSelect = screen.getByLabelText(/seed type/i) as HTMLSelectElement;
    expect(seedSelect.value).toBe("monomers");

    fireEvent.change(seedSelect, { target: { value: "dimers" } });
    expect(seedSelect.value).toBe("dimers");
  });

  it("includes seed_type in payload when algorithm is tunable_cc", async () => {
    const { onSubmit } = renderWithAlgorithm("tunable_cc");

    // Change seed_type to dimers
    const seedSelect = screen.getByLabelText(/seed type/i) as HTMLSelectElement;
    fireEvent.change(seedSelect, { target: { value: "dimers" } });

    // Submit the form
    const submitBtn = screen.getByRole("button", { name: /run simulation/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const payload = onSubmit.mock.calls[0][0];
    expect(payload.algorithm).toBe("tunable_cc");
    expect(payload.parameters.seed_type).toBe("dimers");
  });

  it("does NOT include seed_type in payload for ballistic algorithm", async () => {
    const { onSubmit } = renderWithAlgorithm("ballistic");

    const submitBtn = screen.getByRole("button", { name: /run simulation/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const payload = onSubmit.mock.calls[0][0];
    expect(payload.algorithm).toBe("ballistic");
    expect(payload.parameters.seed_type).toBeUndefined();
  });
});
