/**
 * Unit scaling helpers for Rg display (frontend boundary).
 *
 * The engine emits dimensionless Rg. Display/export paths multiply by
 *   scale = primary_particle_diameter_nm / 2
 * to produce nm.
 *
 * This module MUST match backend/apps/simulations/services/params.py
 * byte-for-byte on every input. Fallback order:
 *   1. v2: params.primary_particle_diameter_nm (if positive finite)
 *   2. v1: params.primary_particle_radius_nm * 2 (if positive finite)
 *   3. default 50.0 nm (historical legacy default radius 25 × 2)
 *
 * Non-positive values (0, negatives) and non-finite values (NaN, ±Infinity)
 * fall through to the next step.
 */

export const PARAM_KEY_DIAMETER = "primary_particle_diameter_nm";
export const PARAM_KEY_RADIUS_LEGACY = "primary_particle_radius_nm";
export const PARAM_KEY_SCHEMA_VERSION = "parameters_schema_version";
export const DEFAULT_DIAMETER_NM = 50.0;
export const SCHEMA_VERSION_CURRENT = "v2" as const;

export type SchemaVersion = "v1" | "v2";

/**
 * Return `true` when `value` is a finite number strictly greater than zero.
 * Rejects NaN, ±Infinity, 0, negatives, and non-numbers (strings, booleans,
 * null, undefined, objects).
 */
function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Resolve the primary-particle diameter in nm from either schema version.
 *
 * Fallback order:
 *   1. v2 key `primary_particle_diameter_nm` — returned as-is if positive finite
 *   2. v1 key `primary_particle_radius_nm` — returned × 2 if positive finite
 *   3. `DEFAULT_DIAMETER_NM` (50.0)
 */
export function getPrimaryParticleDiameterNm(
  params: Record<string, unknown> | null | undefined,
): number {
  if (params === null || params === undefined || typeof params !== "object") {
    return DEFAULT_DIAMETER_NM;
  }

  const diameter = (params as Record<string, unknown>)[PARAM_KEY_DIAMETER];
  if (isPositiveFiniteNumber(diameter)) {
    return diameter;
  }

  const radius = (params as Record<string, unknown>)[PARAM_KEY_RADIUS_LEGACY];
  if (isPositiveFiniteNumber(radius)) {
    return radius * 2;
  }

  return DEFAULT_DIAMETER_NM;
}

/**
 * Return the scale factor (nm per dimensionless Rg unit): `diameter / 2`.
 * Single source of truth for nm scaling on the frontend.
 */
export function getScaleFactorNm(
  params: Record<string, unknown> | null | undefined,
): number {
  return getPrimaryParticleDiameterNm(params) / 2;
}

/**
 * Detect the parameter-schema version of a stored simulation.
 *
 * Rules (mirror the Python shim byte-for-byte):
 *   - Explicit `parameters_schema_version === "v2"` → "v2"
 *   - Explicit `parameters_schema_version === "v1"` → "v1"
 *   - Otherwise infer from KEY PRESENCE (not value validity):
 *       - `primary_particle_diameter_nm` key present → "v2"
 *       - `primary_particle_diameter_nm` absent and
 *         `primary_particle_radius_nm` key present → "v1"
 *       - Neither key present → null (fully ambiguous)
 *
 * The inference step checks presence, not positivity: a stored `0` or `NaN`
 * still identifies the schema that wrote the record.
 */
export function getSchemaVersion(
  params: Record<string, unknown> | null | undefined,
): SchemaVersion | null {
  if (params === null || params === undefined || typeof params !== "object") {
    return null;
  }

  const p = params as Record<string, unknown>;

  const explicit = p[PARAM_KEY_SCHEMA_VERSION];
  if (explicit === "v2") return "v2";
  if (explicit === "v1") return "v1";

  // Inference from key presence (matches Python ``key in dict``).
  if (Object.prototype.hasOwnProperty.call(p, PARAM_KEY_DIAMETER)) {
    return "v2";
  }
  if (Object.prototype.hasOwnProperty.call(p, PARAM_KEY_RADIUS_LEGACY)) {
    return "v1";
  }

  return null;
}
