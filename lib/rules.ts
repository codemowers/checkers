import type { BoardState, Game, Move, Player, Position } from "./types";

export class InvalidMove extends Error {}

/** Plies without a capture or a man advancing before the game is called a draw. */
const IDLE_PLY_LIMIT = 80;
const DIAGONALS = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;
const SQUARES: Position[] = Array.from({ length: 64 }, (_, i) => ({ row: Math.floor(i / 8), col: i % 8 }));

export function newGame(id: string): Game {
  const board = Array.from({ length: 8 }, () => Array(8).fill(0));
  for (let row = 0; row < 3; row++) for (let col = 0; col < 8; col++) if ((row + col) % 2) board[row][col] = 2;
  for (let row = 5; row < 8; row++) for (let col = 0; col < 8; col++) if ((row + col) % 2) board[row][col] = 1;
  return {
    id,
    players: [{ id: "", name: "" }, { id: "", name: "" }],
    board,
    turn: 0,
    status: "playing",
    idlePlies: 0,
    revision: 1,
    updatedAt: new Date().toISOString(),
  };
}

export function applyMove(source: Game, player: number, move: Move): Game {
  const game: Game = structuredClone(source);
  const { from, to } = move;
  if (game.status !== "playing") throw new InvalidMove("This game is already over.");
  if (game.turn !== player) throw new InvalidMove("Wait for your turn.");
  if (![from, to].every(inside)) throw new InvalidMove("That square is outside the board.");
  if (game.forced && !same(game.forced, from)) throw new InvalidMove("Continue the capture with the same piece.");
  const piece = game.board[from.row][from.col];
  if (owner(piece) !== player || game.board[to.row][to.col] !== 0) throw new InvalidMove("Choose one of your pieces and an empty square.");
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  if (Math.abs(dr) !== Math.abs(dc) || ![1, 2].includes(Math.abs(dr))) throw new InvalidMove("Pieces move diagonally.");
  if (!canTravel(piece, dr)) throw new InvalidMove("Only kings move backwards.");
  const capturing = Math.abs(dr) === 2;
  if (capturing) {
    const middle = game.board[from.row + dr / 2][from.col + dc / 2];
    if (owner(middle) !== 1 - player) throw new InvalidMove("There is no opponent to capture.");
  } else if (game.forced || hasCapture(game, player)) {
    throw new InvalidMove("A capture is available.");
  }

  game.board[to.row][to.col] = piece;
  game.board[from.row][from.col] = 0;
  if (capturing) game.board[from.row + dr / 2][from.col + dc / 2] = 0;
  const crowned = (piece === 1 && to.row === 0) || (piece === 2 && to.row === 7);
  if (crowned) game.board[to.row][to.col] = piece + 2;
  game.idlePlies = capturing || piece < 3 ? 0 : game.idlePlies + 1;
  delete game.forced;
  // Crowning ends the turn: a man promoted mid-jump does not chain on with king moves.
  if (capturing && !crowned && captureTargets(game, to).length) {
    game.forced = to;
  } else {
    game.turn = (1 - game.turn) as 0 | 1;
    if (!playerCanMove(game, game.turn)) {
      game.winner = player as 0 | 1;
      game.status = "finished";
    } else if (game.idlePlies >= IDLE_PLY_LIMIT) {
      game.status = "finished"; // drawn: no winner
    }
  }
  game.revision++;
  game.updatedAt = new Date().toISOString();
  return game;
}

export function playerIndex(game: Game, id: string) {
  // Unassigned seats carry an empty id, which must never match a caller.
  return id ? game.players.findIndex((player: Player) => player.id === id) : -1;
}

/** Every square the given piece may legally move to, mandatory captures included. */
export function legalTargets(game: BoardState, player: number, from: Position): Position[] {
  if (game.status !== "playing" || game.turn !== player || !inside(from)) return [];
  if (owner(game.board[from.row][from.col]) !== player) return [];
  if (game.forced && !same(game.forced, from)) return [];
  if (game.forced || hasCapture(game, player)) return captureTargets(game, from);
  return quietTargets(game, from);
}

/** The pieces a player must move from, when a capture is on the board. */
export function captureSources(game: BoardState, player: number): Position[] {
  return SQUARES.filter((square) => owner(game.board[square.row][square.col]) === player && captureTargets(game, square).length > 0);
}

export function hasCapture(game: BoardState, player: number) {
  return SQUARES.some((square) => owner(game.board[square.row][square.col]) === player && captureTargets(game, square).length > 0);
}

function captureTargets(game: BoardState, from: Position) { return reachable(game, from, 2); }
function quietTargets(game: BoardState, from: Position) { return reachable(game, from, 1); }

function reachable(game: BoardState, from: Position, distance: 1 | 2): Position[] {
  const piece = game.board[from.row][from.col];
  const found: Position[] = [];
  for (const [stepRow, stepCol] of DIAGONALS) {
    const dr = stepRow * distance;
    const dc = stepCol * distance;
    const to = { row: from.row + dr, col: from.col + dc };
    if (!inside(to) || !canTravel(piece, dr) || game.board[to.row][to.col] !== 0) continue;
    if (distance === 2 && owner(game.board[from.row + dr / 2][from.col + dc / 2]) !== 1 - owner(piece)) continue;
    found.push(to);
  }
  return found;
}

function playerCanMove(game: BoardState, player: number) {
  return SQUARES.some((square) => owner(game.board[square.row][square.col]) === player
    && (captureTargets(game, square).length > 0 || quietTargets(game, square).length > 0));
}

export function owner(piece: number) { return piece === 1 || piece === 3 ? 0 : piece === 2 || piece === 4 ? 1 : -1; }
export function same(a?: Position, b?: Position) { return !!a && !!b && a.row === b.row && a.col === b.col; }
function canTravel(piece: number, dr: number) { return piece >= 3 || (piece === 1 && dr < 0) || (piece === 2 && dr > 0); }
function inside(position: Position) { return Number.isInteger(position.row) && Number.isInteger(position.col) && position.row >= 0 && position.row < 8 && position.col >= 0 && position.col < 8; }
