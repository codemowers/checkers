import { expect, it } from "vitest";
import { advanceTableAngle } from "./table-orientation";

function advance(angle: number, seconds: number, player: number, offering: boolean) {
  for (let i = 0; i < Math.round(seconds * 60); i++) angle = advanceTableAngle(angle, player, offering, 1 / 60, false);
  return angle;
}

it("starts turning from Red toward Black while an offer is pending", () => {
  const angle = advance(0, 1, 1, true);
  expect(angle).toBeCloseTo(Math.PI / 8);
  expect(advance(angle, 8, 1, true)).toBe(Math.PI);
});

it("accepting finishes the same half-turn swiftly without jumping back", () => {
  const pending = advance(0, 2, 1, true);
  const accepted = advanceTableAngle(pending, 1, false, 1 / 60, false);
  expect(accepted).toBeGreaterThan(pending);
  expect(accepted - pending).toBeLessThan(0.12);
  expect(advance(accepted, 0.45, 1, false)).toBe(Math.PI);
});

it("starting a new game turns back to Red and honors reduced motion", () => {
  expect(advance(Math.PI, 0.5, 0, false)).toBe(0);
  expect(advanceTableAngle(0, 1, true, 1 / 60, true)).toBe(Math.PI);
  expect(advanceTableAngle(Math.PI, 0, false, 1 / 60, true)).toBe(0);
});
