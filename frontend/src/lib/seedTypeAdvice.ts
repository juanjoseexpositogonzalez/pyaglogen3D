/**
 * The one place that knows when `monomers` stops reaching a high target (#311, #315,
 * #341).
 *
 * Measured against the engine with the product's own defaults (N=100, kf 1.3, seed 42,
 * range ±0.15 from R27.4):
 *
 *     target      2.5     2.6     2.7     2.8     2.9
 *     monomers   2.526   2.515   2.362   2.493   2.479
 *     dimers     2.465   2.669   2.745   2.857   2.907
 *
 * So the gate starts at **2.7**, not at the band's 2.5: below it every seed type lands
 * inside the tolerance, and overriding there would scold a configuration that passes.
 * `kf` is part of the gate because the lever does not work on its own — dimers measures
 * 2.472 at kf 1.0, outside the band for the same target.
 *
 * Two forms ask this question - the single-simulation one and the parametric study - and
 * they must not drift. The condition and the sentence live here, and both read them:
 * one implementation, one wording, one place to fix the next time the numbers move.
 *
 * Since #341 the answer is not advice but a decision: above the gate both forms *set*
 * the seed type, so the sentence says the selection changed. A sentence that still said
 * "recommended" would describe a choice the reader no longer has on screen.
 */

/** The target Df from which `monomers` stops reaching the band. */
export const HIGH_DF_NEEDS_DIMERS = 2.7

/** The kf floor the measurement assumes; below it the lever stops working. */
export const HIGH_DF_KF_FLOOR = 1.3

/**
 * The sentence both forms show, numbers included: a sentence without them is noise,
 * and one that only suggests would be describing a control that no longer offers it.
 */
export const DIMERS_ADVICE =
  'The seed type was changed to dimers for Df 2.7 and above with kf ≈ 1.3: measured, ' +
  'monomers stays at Df ≈ 2.37 where dimers reaches 2.77–2.80 (N=100 and N=1000, target 2.7).'

/**
 * The sentence for a control the gate holds at `dimers` without having changed
 * it: the reader stored `dimers` and then raised the target. No sentence at all
 * would leave a disabled control with no reason (JD-A-005, #342), and one that
 * said "changed" would claim something that did not happen.
 */
export const DIMERS_HELD =
  'The seed type is held at dimers for Df 2.7 and above with kf ≈ 1.3: measured, ' +
  'monomers stays at Df ≈ 2.37 where dimers reaches 2.77–2.80 (N=100 and N=1000, target 2.7).'

/**
 * The sentence for a study the gate sets with no control on screen to change: the
 * sweep never varies `seed_type`, so the gate adds the one seed type that reaches
 * and no selection was changed — there was no control to change. A sentence that
 * said "changed" would describe a control this screen never rendered (#341,
 * review round 2). The measured numbers are the same sentence's.
 */
export const DIMERS_RUNS =
  'The study will run dimers for Df 2.7 and above with kf ≈ 1.3: measured, ' +
  'monomers stays at Df ≈ 2.37 where dimers reaches 2.77–2.80 (N=100 and N=1000, target 2.7).'

/** Whether a run at this target will miss the band unless the seed type is not monomers. */
export function needsDimers(targetDf: number, targetKf: number): boolean {
  return targetDf >= HIGH_DF_NEEDS_DIMERS && targetKf >= HIGH_DF_KF_FLOOR
}
