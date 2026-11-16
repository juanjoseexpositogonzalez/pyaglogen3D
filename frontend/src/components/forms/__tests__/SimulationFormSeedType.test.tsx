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
    expect(labels).toContain("Monomers");
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

/**
 * Choose a seed type the way a reader does.
 *
 * Since #341 the control follows the gate: above Df 2.7 it is disabled at `dimers`,
 * so a test that wants `monomers` stored has to choose it *below* the gate and raise
 * the target afterwards. That is also the reader's real path, and the one that tells
 * `params.seed_type` apart from what the control shows.
 */
const chooseSeedType = (value: "monomers" | "dimers" | "trimers") =>
  fireEvent.change(screen.getByLabelText(/seed type/i), { target: { value } });

/**
 * The value that actually travels (#342, S7): for `tunable_cc` the payload's
 * `target_kf` is the distribution's fixed value, not the slider. The dpo
 * selector renders the same "valor" box first, so the prefactor's is the
 * second one.
 */
const setCarriedKf = (value: string) =>
  fireEvent.change(screen.getAllByLabelText("valor")[1], {
    target: { value },
  });

/**
 * Open the prefactor distribution. A `normal` entry is the open case: no
 * single kf can be promised for it, so the gate abstains instead of
 * inventing a mean or a minimum.
 */
const openKfDistribution = () =>
  fireEvent.change(screen.getByLabelText("target_kf: modo de distribución"), {
    target: { value: "normal" },
  });

describe("SimulationForm — the dimers gate above the high-Df band (#311, #341)", () => {
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

  it("explains the change where monomers stops reaching", () => {
    renderWithAlgorithm("tunable_cc");
    // The choice is made where it is still the reader's, then the target is raised
    // past the gate - which is the only order the disabled control allows (#341).
    chooseSeedType("monomers");
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

  it("explains the hold when the reader already stored dimers", () => {
    // JD-A-005 (#342): the reader stored `dimers` and then raised the target —
    // nothing was changed, but the gate holds the control all the same, and a
    // held control with no reason is a disabled control that does not explain
    // itself. The sentence may claim a change only when one happened.
    renderWithAlgorithm("tunable_cc");
    chooseSeedType("dimers");
    setTargetDf(2.7);

    const control = screen.getByLabelText(/seed type/i) as HTMLSelectElement;
    expect(control.value).toBe("dimers");
    expect(control.disabled).toBe(true);
    expect(recommendation()).toMatch(/held/i);
    expect(recommendation()).not.toMatch(/changed/i);
    expect(control.getAttribute("aria-describedby")).toBe("seed-type-note");
  });

  it("says nothing at a kf where dimers misses the band too", () => {
    renderWithAlgorithm("tunable_cc");
    // #342 (S7): the value that travels is the distribution's, so that is the
    // one lowered here. The previous witness moved the slider while the
    // request still carried the distribution's 1.3.
    setCarriedKf("1.0");
    setTargetDf(2.7);
    chooseSeedType("monomers");

    // Dimers measures 2.472 at kf 1.0 — outside the band for a 2.7 target. Advice
    // that sent the reader to a lever that does not fix their run is worse than
    // silence, so the gate follows the evidence and the sentence names the kf.
    expect(recommendation()).toBe("");
  });

  it("says nothing below the band", () => {
    renderWithAlgorithm("tunable_cc");
    setTargetDf(1.8);
    chooseSeedType("monomers");

    expect(recommendation()).toBe("");
  });

  it("sends dimers by default where monomers cannot reach the target", async () => {
    // The half #311 added. A reader who sets Df 2.7 and submits without touching
    // the dropdown used to get 2.37; the payload now carries the seed type that
    // reaches the band.
    const { onSubmit } = renderWithAlgorithm("tunable_cc");
    setTargetDf(2.7);

    fireEvent.click(screen.getByRole("button", { name: /run simulation/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].parameters.seed_type).toBe("dimers");
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
    chooseSeedType("monomers");
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

  // ------------------------------------------------------------------------
  // #341 — the gate decides, not the reader. This reverses half of #311 on
  // purpose: above the gate the control shows and the payload carries `dimers`
  // even when the reader picked `monomers` by hand.
  // ------------------------------------------------------------------------

  it("shows and sends dimers at the gate without touching the dropdown", async () => {
    // S1: a reader who asks for 2.7 and never opens the dropdown gets the seed
    // type that reaches it, and the control says so instead of showing the
    // untouched `monomers` default.
    const { onSubmit } = renderWithAlgorithm("tunable_cc");
    setTargetDf(2.7);
    setTargetKf(1.3);

    const control = screen.getByLabelText(/seed type/i) as HTMLSelectElement;
    expect(control.value).toBe("dimers");
    expect(control.disabled).toBe(true);
    expect(recommendation()).toMatch(/changed/i);

    fireEvent.click(screen.getByRole("button", { name: /run simulation/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].parameters.seed_type).toBe("dimers");
    // The gate and the payload read the same kf (#342, S7).
    expect(onSubmit.mock.calls[0][0].parameters.target_kf).toBe(1.3);
  });

  it("overrides a hand-picked monomers in the control and in the request body", async () => {
    // S2: the reader's own choice is made below the gate, then the target is
    // raised past it. What is asserted is the *request body*, not the internal
    // state: a control that showed dimers while the payload carried monomers is
    // exactly the lie this issue is about.
    const { onSubmit } = renderWithAlgorithm("tunable_cc");
    chooseSeedType("monomers");
    setTargetDf(2.7);
    setTargetKf(1.3);

    const control = screen.getByLabelText(/seed type/i) as HTMLSelectElement;
    // A disabled control still receives a dispatched change in jsdom, so this is
    // the question S2 asks: try to pick monomers where it cannot reach, and read
    // what leaves the form afterwards.
    fireEvent.change(control, { target: { value: "monomers" } });

    expect(control.value).toBe("dimers");
    expect(control.disabled).toBe(true);
    expect(recommendation()).toMatch(/changed to dimers/i);

    fireEvent.click(screen.getByRole("button", { name: /run simulation/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].parameters.seed_type).toBe("dimers");
    expect(onSubmit.mock.calls[0][0].parameters.target_kf).toBe(1.3);
  });

  it("respects monomers at 2.6, where it still lands inside the band", async () => {
    // S3, first half: 2.6 is below the gate, so the reader keeps what they chose
    // and nothing is announced. Measured: monomers lands at 2.515 there.
    const { onSubmit } = renderWithAlgorithm("tunable_cc");
    chooseSeedType("monomers");
    setTargetDf(2.6);

    const control = screen.getByLabelText(/seed type/i) as HTMLSelectElement;
    expect(control.value).toBe("monomers");
    expect(control.disabled).toBe(false);
    expect(recommendation()).toBe("");

    fireEvent.click(screen.getByRole("button", { name: /run simulation/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].parameters.seed_type).toBe("monomers");
    // The witness asserts the kf that travels, not only the seed type (#342).
    expect(onSubmit.mock.calls[0][0].parameters.target_kf).toBe(1.3);
  });

  it("respects monomers at kf 1.2, where dimers misses the band too", async () => {
    // S3, second half: the gate needs both halves. At kf 1.2 the lever does not
    // work for either seed type (dimers measures 2.472 at kf 1.0), so overriding
    // the reader there would buy nothing and scold a configuration that passes.
    // #342 (S7): the witness lowers the value that travels — the distribution's
    // — and asserts it in the request body. The previous witness moved the
    // slider while the payload still carried the distribution's 1.3.
    const { onSubmit } = renderWithAlgorithm("tunable_cc");
    chooseSeedType("monomers");
    setTargetDf(2.7);
    setCarriedKf("1.2");

    const control = screen.getByLabelText(/seed type/i) as HTMLSelectElement;
    expect(control.value).toBe("monomers");
    expect(control.disabled).toBe(false);
    expect(recommendation()).toBe("");

    fireEvent.click(screen.getByRole("button", { name: /run simulation/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].parameters.seed_type).toBe("monomers");
    expect(onSubmit.mock.calls[0][0].parameters.target_kf).toBe(1.2);
  });

  it("gives the reader their choice back when the target drops below the gate", () => {
    // S3, and the constraint that makes the override honest: it is applied to
    // what the control shows, not to the stored choice. Destroying the choice at
    // 2.7 would leave the reader at `dimers` after moving the slider back.
    renderWithAlgorithm("tunable_cc");
    chooseSeedType("monomers");

    setTargetDf(2.7);
    const control = screen.getByLabelText(/seed type/i) as HTMLSelectElement;
    expect(control.value).toBe("dimers");
    expect(control.disabled).toBe(true);

    setTargetDf(2.6);
    expect(control.value).toBe("monomers");
    expect(control.disabled).toBe(false);
    expect(recommendation()).toBe("");
  });

  it("overrides a stored trimers too, because the control cannot offer one", async () => {
    // Triangulation: the contract names the hand-picked `monomers`, but the
    // control is disabled above the gate and therefore cannot display `trimers`
    // either. Sending the stored value while showing `dimers` is the same lie in
    // the other direction, so the gate answers for every non-dimers choice.
    const { onSubmit } = renderWithAlgorithm("tunable_cc");
    chooseSeedType("trimers");
    setTargetDf(2.7);

    const control = screen.getByLabelText(/seed type/i) as HTMLSelectElement;
    expect(control.value).toBe("dimers");
    expect(control.disabled).toBe(true);
    expect(recommendation()).toMatch(/changed/i);

    fireEvent.click(screen.getByRole("button", { name: /run simulation/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].parameters.seed_type).toBe("dimers");
  });
});

// ------------------------------------------------------------------------
// #342 (S7) — the gate reads the kf the request carries, not the slider.
// JD-A-002 + JD-B-001 (both major): for `tunable_cc` the payload overwrites
// `target_kf` with the distribution's value when the mode is `fixed`, and
// the worker expands `normal`/`uniform` and ignores the scalar — so a gate
// on the slider could disable a control over a number that never travels.
// ------------------------------------------------------------------------

describe("SimulationForm — the gate reads the kf the request carries (#342, S7)", () => {
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

  it("holds the gate on the fixed value the request carries, whatever the slider says", async () => {
    // One derivation feeds both the gate and the payload: with a `fixed`
    // distribution, the number that travels is the distribution's value — a
    // slider parked at 1.0 cannot open a gate the request's 1.5 closes.
    const { onSubmit } = renderWithAlgorithm("tunable_cc");
    setTargetDf(2.7);
    setTargetKf(1.0); // the slider, which nothing reads here
    setCarriedKf("1.5"); // the distribution's value, which travels

    const control = screen.getByLabelText(/seed type/i) as HTMLSelectElement;
    expect(control.value).toBe("dimers");
    expect(control.disabled).toBe(true);
    expect(recommendation()).toMatch(/changed to dimers/i);

    fireEvent.click(screen.getByRole("button", { name: /run simulation/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].parameters.seed_type).toBe("dimers");
    expect(onSubmit.mock.calls[0][0].parameters.target_kf).toBe(1.5);
  });

  it("abstains on an open distribution: no override, no held control, no sentence", async () => {
    // An open distribution cannot promise that the kf which travels respects
    // the floor, so the gate asserts nothing — no mean and no minimum is
    // invented for it. A mean of 1.5 is deliberately placed above the floor
    // so a later "fix" that reads it is caught here.
    const { onSubmit } = renderWithAlgorithm("tunable_cc");
    chooseSeedType("monomers");
    setTargetDf(2.7);
    openKfDistribution();
    fireEvent.change(screen.getByLabelText("media"), { target: { value: "1.5" } });

    const control = screen.getByLabelText(/seed type/i) as HTMLSelectElement;
    expect(control.value).toBe("monomers");
    expect(control.disabled).toBe(false);
    expect(recommendation()).toBe("");

    fireEvent.click(screen.getByRole("button", { name: /run simulation/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].parameters.seed_type).toBe("monomers");
    expect(
      onSubmit.mock.calls[0][0].parameters.target_kf_distribution.mode
    ).toBe("normal");
    // S7: the witness also asserts the kf the request carries. With an open
    // distribution there is no single promised kf — that is why the gate
    // abstains — so the scalar that travels is the slider's legacy alias,
    // left at its default.
    expect(onSubmit.mock.calls[0][0].parameters.target_kf).toBe(1.3);
  });
});
