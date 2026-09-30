export const CAPTURE_SCALE = 0.8;

export type CapturedDisc = { at: [number, number, number]; spin: number };

/** Stable, shuffled spots beside the board; each collection sits to its captor’s left, near their end of the table. */
export function capturedLayout(seed: string, pieces: number, mirrored = false): CapturedDisc[] {
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 0x01000193);
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  const columns = 4;
  const rows = 5;
  const sign = mirrored ? -1 : 1;
  const spots = Array.from({ length: columns * rows }, (_, i): CapturedDisc => ({
    at: [sign * (-5.25 - (i % columns) * 0.82 + (next() - 0.5) * 0.12), -0.358 + 0.09 * CAPTURE_SCALE,
      sign * (0.8 + Math.floor(i / columns) * 0.82 + (next() - 0.5) * 0.12)],
    spin: next() * Math.PI * 2,
  }));
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  return spots.slice(0, pieces);
}
