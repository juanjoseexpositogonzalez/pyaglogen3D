import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SimulationForm } from "../SimulationForm";

// --------------------------------------------------------------------------
// PYA-11 T3.3 — Sintering UI verification tests
// --------------------------------------------------------------------------

/**
 * Helper: renders the form and selects an algorithm by changing the
 * first <select> (algorithm dropdown).
 */
function renderWithAlgorithm(algorithm: string) {
  const onSubmit = vi.fn();
  render(<SimulationForm onSubmit={onSubmit} />);

  const algorithmSelect = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
  fireEvent.change(algorithmSelect, { target: { value: algorithm } });

  return { onSubmit };
}

describe("SimulationForm — Sintering UI (PYA-11 T3.3)", () => {
  it("renders sintering toggle for tunable_cc algorithm", () => {
    renderWithAlgorithm("tunable_cc");

    // "Sintering (Necking)" label should be present
    expect(screen.getByText(/sintering \(necking\)/i)).toBeDefined();

    // Toggle button should show "Disabled" by default
    const toggleBtn = screen.getByRole("button", { name: /disabled/i });
    expect(toggleBtn).toBeDefined();
  });

  it("sintering toggle shows 'Enabled' after click", () => {
    renderWithAlgorithm("tunable_cc");

    const toggleBtn = screen.getByRole("button", { name: /disabled/i });
    fireEvent.click(toggleBtn);

    // After click, should show "Enabled"
    expect(screen.getByRole("button", { name: /enabled/i })).toBeDefined();

    // Distribution type buttons should appear
    expect(screen.getByRole("button", { name: /^fixed$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^uniform$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^normal$/i })).toBeDefined();
  });

  it("sintering section hidden for 'limiting' algorithm", () => {
    renderWithAlgorithm("limiting");

    expect(screen.queryByText(/sintering \(necking\)/i)).toBeNull();
  });

  it("payload includes sintering_coeff when sintering is enabled", async () => {
    const { onSubmit } = renderWithAlgorithm("tunable_cc");

    // Enable sintering
    const toggleBtn = screen.getByRole("button", { name: /disabled/i });
    fireEvent.click(toggleBtn);

    // Submit the form
    const submitBtn = screen.getByRole("button", { name: /run simulation/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const payload = onSubmit.mock.calls[0][0];
    // Default sintering_coeff is 0.9 per form defaults (L206)
    expect(payload.parameters.sintering_coeff).toBe(0.9);
    expect(payload.parameters.sintering_type).toBe("fixed");
  });

  it("payload does NOT include sintering params when sintering is disabled", async () => {
    const { onSubmit } = renderWithAlgorithm("tunable_cc");

    // Leave sintering disabled (default)
    const submitBtn = screen.getByRole("button", { name: /run simulation/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const payload = onSubmit.mock.calls[0][0];
    expect(payload.parameters.sintering_coeff).toBeUndefined();
    expect(payload.parameters.sintering_type).toBeUndefined();
  });
});
