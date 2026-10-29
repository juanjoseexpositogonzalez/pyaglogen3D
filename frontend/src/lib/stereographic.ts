/**
 * Stereographic projection math for hemisphere visualization.
 *
 * Convention: Az=0° → right (3 o'clock), increases counter-clockwise
 * (matches atan2 / Rust engine convention).
 *
 * Projection from south pole onto equatorial plane:
 *   r = (size/2) * cos(El) / (1 + sin(El))
 *   x = size/2 + r * cos(Az)
 *   y = size/2 - r * sin(Az)   (y inverted: SVG origin is top-left)
 */

export interface Direction {
  az: number;
  el: number;
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * Project a direction (azimuth, elevation in degrees) to SVG coordinates
 * using stereographic projection from the south pole.
 */
export function stereographicProject(
  az: number,
  el: number,
  size: number,
): { x: number; y: number } {
  const azRad = az * DEG_TO_RAD;
  const elRad = el * DEG_TO_RAD;
  const center = size / 2;
  const r = center * Math.cos(elRad) / (1 + Math.sin(elRad));
  const x = center + r * Math.cos(azRad);
  const y = center - r * Math.sin(azRad);
  return { x, y };
}

/**
 * Check if two directions match within a tolerance (degrees).
 * Handles azimuth wraparound at 360°.
 */
export function directionsMatch(
  a: Direction,
  b: Direction,
  tolerance: number,
): boolean {
  // Elevation comparison — simple absolute difference
  if (Math.abs(a.el - b.el) > tolerance) return false;

  // Azimuth comparison — handle wraparound
  let azDiff = Math.abs(a.az - b.az);
  if (azDiff > 180) azDiff = 360 - azDiff;

  return azDiff <= tolerance;
}
