/** Allowlisted helper available to handler code (`clamp(value, min, max)`). */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
