import type { PublicGame } from "./types";

/** HTTP responses and live events share the same monotonic snapshot rule. */
export function acceptSnapshot(current: PublicGame | undefined, incoming: PublicGame): PublicGame {
  if (!current) return incoming;
  return incoming.id === current.id && incoming.revision > current.revision ? incoming : current;
}
