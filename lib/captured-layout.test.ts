import { expect, it } from "vitest";
import { CAPTURE_SCALE, capturedLayout } from "./captured-layout";

it.each([12, 20])("lays out %i captures flat without overlaps or touching the board", (count) => {
  for (let seed = 0; seed < 100; seed++) {
    const discs = capturedLayout(String(seed), count);
    expect(discs).toHaveLength(count);
    for (const [i, disc] of discs.entries()) {
      expect(disc.at[1]).toBe(-0.358 + 0.09 * CAPTURE_SCALE);
      expect(disc.at[0] + 0.42 * CAPTURE_SCALE).toBeLessThan(-4.625);
      expect(Math.abs(disc.at[0]) + 0.42 * CAPTURE_SCALE).toBeLessThan(8.2);
      expect(Math.abs(disc.at[2]) + 0.42 * CAPTURE_SCALE).toBeLessThan(5);
      expect(Math.hypot(disc.at[0] + 5.85, disc.at[2] + 2.8)).toBeGreaterThanOrEqual(1.15);
      for (const other of discs.slice(i + 1)) expect(Math.hypot(disc.at[0] - other.at[0], disc.at[2] - other.at[2])).toBeGreaterThan(0.84 * CAPTURE_SCALE);
    }
  }
});
it.each(["215", "1014"])("reserves enough spots around drinks for seed %s", seed => {
  expect(capturedLayout(seed, 12)).toHaveLength(12);
  expect(capturedLayout(seed, 20)).toHaveLength(20);
});
it("keeps positions stable and mirrors the other seat", () => {
  const layout = capturedLayout("table:red", 20);
  expect(capturedLayout("table:red", 20)).toEqual(layout);
  expect(capturedLayout("table:black", 20)).not.toEqual(layout);
  expect(capturedLayout("table:red", 20, true)).toEqual(layout.map(disc => ({ ...disc, at: [-disc.at[0], disc.at[1], -disc.at[2]] })));
});

it("places each colour on its captor's left and near their seat", () => {
  for (const mirrored of [false, true]) {
    const sign = mirrored ? -1 : 1;
    for (const disc of capturedLayout("seats", 20, mirrored)) {
      expect(sign * disc.at[0]).toBeLessThan(-4.625);
      expect(sign * disc.at[2]).toBeGreaterThan(0);
    }
  }
});
