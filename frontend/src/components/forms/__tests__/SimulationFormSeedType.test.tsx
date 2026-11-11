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

describe("SimulationForm — Comprehensive seed_type tests (T5.3)", () => {
  // 1. Visibility — CC tunable (covered in T5.1 but explicit here for T5.3)
  it("shows seed_type dropdown with all 3 options for tunable_cc", () => {
    renderWithAlgorithm("tunable_cc");

    const seedSelect = screen.getByLabelText(/seed type/i);
    const options = within(seedSelect as HTMLElement).getAllByRole("option");
    expect(options).toHaveLength(3);

    const values = options.map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(["monomers", "dimers", "trimers"]);
  });

  // 2. Visibility — other algorithm (DLA)
  it("does NOT show seed_type dropdown for DLA algorithm", () => {
    renderWithAlgorithm("dla");
    expect(screen.queryByLabelText(/seed type/i)).toBeNull();
  });

  // 3. Default monomers on initial render
  it("default seed_type is monomers on initial tunable_cc render", () => {
    renderWithAlgorithm("tunable_cc");
    const seedSelect = screen.getByLabelText(/seed type/i) as HTMLSelectElement;
    expect(seedSelect.value).toBe("monomers");
  });

  // 4. User selects trimers
  it("updates to trimers when user selects trimers", () => {
    renderWithAlgorithm("tunable_cc");
    const seedSelect = screen.getByLabelText(/seed type/i) as HTMLSelectElement;

    fireEvent.change(seedSelect, { target: { value: "trimers" } });
    expect(seedSelect.value).toBe("trimers");
  });

  // 5. API payload includes seed_type=monomers (default) for tunable_cc
  it("includes seed_type=monomers in payload when left at default", async () => {
    const { onSubmit } = renderWithAlgorithm("tunable_cc");

    const submitBtn = screen.getByRole("button", { name: /run simulation/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const payload = onSubmit.mock.calls[0][0];
    expect(payload.parameters.seed_type).toBe("monomers");
  });

  // 6. API payload omits seed_type for non-tunable (DLA)
  it("does NOT include seed_type in payload for DLA algorithm", async () => {
    const { onSubmit } = renderWithAlgorithm("dla");

    const submitBtn = screen.getByRole("button", { name: /run simulation/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const payload = onSubmit.mock.calls[0][0];
    expect(payload.parameters.seed_type).toBeUndefined();
  });

  // 7. Helper text rendered
  it("displays helper text about initial particle grouping", () => {
    renderWithAlgorithm("tunable_cc");

    const helperText = screen.getByText(/initial particle grouping/i);
    expect(helperText.textContent).toContain("dimers/trimers");
    expect(helperText.textContent).toContain("FZR");
  });
});

// --------------------------------------------------------------------------
// #311 — the form says which seed type reaches a high Df target
// --------------------------------------------------------------------------

/**
 * The recommendation is judged on the sentence the form shows, not on the role of
 * whatever wraps it: `role="note"` is the kit's informative-Callout role too, so a
 * form-global query would break the day a second note exists (and would not tell
 * this one from it).
 */
const recommendation = (): string =>
  document.getElementById("seed-type-note")?.textContent ?? "";

describe("SimulationForm — dimers recommendation above the high-Df band (#311)", () => {
  /**
   * The target Df control is a native range input under a label that carries its
   * value, so it is addressed through that label instead of a guessed index.
   */
  const sliderUnder = (label: RegExp) => {
    const node = screen.getByText(label).closest("div")?.querySelector(
      'input[type="range"]'
    );
    if (!node) throw new Error(`no range input under ${label}`);
    return node as HTMLInputElement;
  };

  const setTargetDf = (value: number) =>
    fireEvent.change(sliderUnder(/Target Fractal Dimension \(Df\)/), {
      target: { value: String(value) },
    });

  const setTargetKf = (value: number) =>
    fireEvent.change(sliderUnder(/Target Prefactor \(kf\)/), {
      target: { value: String(value) },
    });

  it("recommends dimers from the target monomers stops reaching, with its numbers", () => {
    renderWithAlgorithm("tunable_cc");
    setTargetDf(2.7);

    // Measured: monomers lands at 2.37 and dimers at 2.77–2.80 for a 2.7 target
    // (N=100 and N=1000, kf 1.3). The numbers are asserted, not just the word:
    // a sentence that lost them would still say "dimers" and still be useless.
    const note = recommendation();
    expect(note).toMatch(/dimers/i);
    expect(note).toMatch(/2\.37/);
    expect(note).toMatch(/2\.7[789]|2\.8/);
  });

  it("says nothing at 2.6, where monomers still lands inside the tolerance", () => {
    renderWithAlgorithm("tunable_cc");
    setTargetDf(2.6);

    // Measured, five seeds: monomers 2.515 for a 2.6 target, inside ±0.15. The
    // threshold is 2.7 because that is where the measurement starts failing —
    // warning at 2.5 would scold a configuration that passes.
    expect(recommendation()).toBe("");
  });

  it("says nothing once dimers is chosen", () => {
    renderWithAlgorithm("tunable_cc");
    setTargetDf(2.7);
    fireEvent.change(screen.getByLabelText(/seed type/i), {
      target: { value: "dimers" },
    });

    expect(recommendation()).toBe("");
  });

  it("says nothing at a kf where dimers misses the band too", () => {
    renderWithAlgorithm("tunable_cc");
    setTargetDf(2.7);
    setTargetKf(1.0);

    // Dimers measures 2.472 at kf 1.0 — outside the band for a 2.7 target. Advice
    // that sent the reader to a lever that does not fix their run is worse than
    // silence, so the gate follows the evidence and the sentence names the kf.
    expect(recommendation()).toBe("");
  });

  it("says nothing below the band", () => {
    renderWithAlgorithm("tunable_cc");
    setTargetDf(1.8);

    expect(recommendation()).toBe("");
  });

  it("keeps the note inside the only branch that has a seed type", () => {
    // This guards placement, not the predicate: the note is rendered inside the
    // `tunable_cc` block, which is what keeps it off algorithms that never read
    // `seed_type`. Hoisting it out of that block is the regression this catches.
    renderWithAlgorithm("ballistic_cc");

    expect(recommendation()).toBe("");
  });

  it("links the sentence to the control it is about", () => {
    renderWithAlgorithm("tunable_cc");
    setTargetDf(2.7);

    // A note that appears while the slider moves is not announced on its own, so
    // the control it is about names it: the container is a live region and the
    // select points at it.
    const region = document.getElementById("seed-type-note");
    expect(region?.getAttribute("role")).toBe("status");
    expect(screen.getByLabelText(/seed type/i).getAttribute("aria-describedby")).toBe(
      "seed-type-note"
    );
  });
});
