export const RULESETS = {
  international: {
    name: "International · 10×10",
    description: "Men capture forwards and backwards. Kings move any distance. Capture the most pieces; promotion happens at the end of the turn.",
    size: 10,
    pieces: 20,
  },
  english: {
    name: "English / American · 8×8",
    description: "Men move and capture forwards. Kings move one square. Any capture sequence is allowed; crowning ends the turn.",
    size: 8,
    pieces: 12,
  },
} as const;
export type Ruleset = keyof typeof RULESETS;
export function isRuleset(value: unknown): value is Ruleset {
  return value === "english" || value === "international";
}
