import type { Ruleset } from "./rulesets";
export type Player = { id: string; name: string; avatar?: string };
export type Position = { row: number; col: number };
export type Game = {
  id: string;
  ruleset: Ruleset;
  computer?: boolean;
  waiting?: boolean;
  captured?: Position[];
  repetitions?: Record<string, number>;
  endgamePlies?: number;
  players: [Player, Player];
  board: number[][];
  turn: 0 | 1;
  status: "playing" | "finished";
  /** Absent on a finished game means the game was drawn. */
  winner?: 0 | 1;
  forced?: Position;
  /** Plies since the last capture or man move; at the limit the game is drawn. */
  idlePlies: number;
  recentMoves?: (Move & { revision: number })[];
  revision: number;
  updatedAt: string;
};
export type Move = { from: Position; to: Position };

/** The part of a game the move rules read, shared by the server and the board UI. */
export type BoardState = Pick<Game, "board" | "turn" | "status" | "forced" | "ruleset" | "captured">;

/**
 * What a player is allowed to see. Player ids double as anonymous credentials,
 * so they never leave the server; the recipient's seat is named by `you`.
 */
export type PublicPlayer = { name: string; avatar?: string; anonymous?: boolean; computer?: boolean };
export type PublicGame = Omit<Game, "players"> & { players: [PublicPlayer, PublicPlayer]; you: 0 | 1 | null };

export type GameEvent =
  | { type: "game"; game: PublicGame }
  | { type: "ended"; message: string };
