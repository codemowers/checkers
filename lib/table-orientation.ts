/** Offer a slow half-turn; accepting or returning to Red completes it quickly. */
export function advanceTableAngle(angle: number, player: number, offering: boolean, delta: number, calm: boolean): number {
  const target = offering || player === 1 ? Math.PI : 0;
  if (calm) return target;
  const distance = target - angle;
  const step = (offering ? Math.PI / 8 : Math.PI / 0.45) * Math.max(0, Math.min(delta, 0.1));
  return Math.abs(distance) <= step ? target : angle + Math.sign(distance) * step;
}
