export type ConnectionRole = "player" | "spectator";
export type ConnectionAuth = "anonymous" | "authenticated";

export function trackOpenConnection(role: ConnectionRole | undefined, auth: ConnectionAuth): {
  set(nextRole: ConnectionRole | undefined, nextAuth?: ConnectionAuth): void;
  close(): void;
};

export function collectOpenConnections(): Promise<{
  player: Record<ConnectionAuth, number>;
  spectator: Record<ConnectionAuth, number>;
}>;
