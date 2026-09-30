export const ROBOT_ICON = "🤖";

export const COMPUTER_PAIRS = [
  ["C-3PO", "R2-D2"],
  ["Marvin the Paranoid Android", "Eddie the Computer"],
  ["TARS", "CASE"],
  ["HAL 9000", "SAL 9000"],
  ["Bender", "Calculon"],
  ["Data", "Lore"],
] as const;

export function computerPair(round: number) {
  return COMPUTER_PAIRS[round % COMPUTER_PAIRS.length];
}

export function randomComputerName() {
  const names = COMPUTER_PAIRS.flat();
  return names[Math.floor(Math.random() * names.length)];
}
