function enabled(name: "ENABLE_COMPUTER" | "ENABLE_DEMO") {
  const value = process.env[name];
  if (value !== undefined && value !== "true" && value !== "false") {
    throw new Error(`${name} must be true or false`);
  }
  return value !== "false";
}

export const computerEnabled = () => enabled("ENABLE_COMPUTER");
export const demoEnabled = () => enabled("ENABLE_DEMO");

export type SpectatorMode = "disabled" | "invite";

export function spectatorMode(): SpectatorMode {
  const value = process.env.SPECTATOR_MODE ?? "invite";
  if (value !== "disabled" && value !== "invite") {
    throw new Error("SPECTATOR_MODE must be disabled or invite");
  }
  return value;
}
