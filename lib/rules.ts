import { RULESETS, type Ruleset } from "./rulesets";
import type { BoardState, Game, Move, Position } from "./types";

export class InvalidMove extends Error {}
const DIAGONALS = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;
type Step = Move & { captured?: Position };
const international = (game: BoardState) => game.ruleset === "international";
const squares = (game: BoardState): Position[] => game.board.flatMap((row, r) => row.map((_, col) => ({ row: r, col })));
const positionKey = (game: Game) => `${game.turn}:${game.board.flat().join("")}`;

export function newGame(id: string, ruleset: Ruleset = "english"): Game {
  const size = RULESETS[ruleset].size;
  const board = Array.from({ length: size }, () => Array<number>(size).fill(0));
  for (let row = 0; row < size / 2 - 1; row++) for (let col = 0; col < size; col++) {
    if ((row + col) % 2) board[row][col] = 2;
  }
  for (let row = size / 2 + 1; row < size; row++) for (let col = 0; col < size; col++) {
    if ((row + col) % 2) board[row][col] = 1;
  }
  const game: Game = {
    id, ruleset, players: [{ id: "", name: "" }, { id: "", name: "" }], board,
    turn: 0, status: "playing", idlePlies: 0, revision: 1, updatedAt: new Date().toISOString(),
  };
  game.repetitions = { [positionKey(game)]: 1 };
  return game;
}

/** Raw single jumps or quiet moves. Captured International pieces remain blockers until turn end. */
function steps(game: BoardState, from: Position, capture: boolean): Step[] {
  const piece = game.board[from.row][from.col];
  const flying = international(game) && piece >= 3;
  const found: Step[] = [];
  for (const [dr, dc] of DIAGONALS) {
    if (piece < 3 && !(capture && international(game)) && !canTravel(piece, dr)) continue;
    let victim: Position | undefined;
    for (let distance = 1; distance < game.board.length; distance++) {
      const to = { row: from.row + dr * distance, col: from.col + dc * distance };
      if (!inside(game, to)) break;
      const target = game.board[to.row][to.col];
      if (target) {
        if (!capture || victim || owner(target) === owner(piece) || game.captured?.some((p) => same(p, to))) break;
        victim = to;
      } else {
        if (!capture || victim) found.push({ from, to, ...(victim ? { captured: victim } : {}) });
        if (!flying) break;
      }
      if (!flying && distance >= (capture ? 2 : 1)) break;
    }
  }
  return found;
}

function jumpState(game: BoardState, step: Step): BoardState {
  const board = game.board.map((row) => [...row]);
  board[step.to.row][step.to.col] = board[step.from.row][step.from.col];
  board[step.from.row][step.from.col] = 0;
  const captured = [...(game.captured ?? []), step.captured!];
  if (!international(game)) board[step.captured!.row][step.captured!.col] = 0;
  return { ...game, board, captured, forced: step.to };
}

function captureLength(game: BoardState, step: Step): number {
  const next = jumpState(game, step);
  return 1 + Math.max(0, ...steps(next, step.to, true).map((jump) => captureLength(next, jump)));
}

function legalSteps(game: BoardState, player: number): Step[] {
  if (game.status !== "playing" || game.turn !== player) return [];
  const sources = game.forced ? [game.forced] : squares(game).filter((p) => owner(game.board[p.row][p.col]) === player);
  const captures = sources.flatMap((p) => steps(game, p, true));
  if (captures.length) {
    if (!international(game)) return captures;
    const lengths = captures.map((step) => captureLength(game, step));
    const longest = Math.max(...lengths);
    return captures.filter((_, index) => lengths[index] === longest);
  }
  return game.forced ? [] : sources.flatMap((p) => steps(game, p, false));
}

export function legalMoves(game: BoardState): Move[] {
  return legalSteps(game, game.turn).map(({ from, to }) => ({ from, to }));
}
export function legalTargets(game: BoardState, player: number, from: Position): Position[] {
  if (!inside(game, from)) return [];
  return legalSteps(game, player).filter((step) => same(step.from, from)).map((step) => step.to);
}
export function captureSources(game: BoardState, player: number): Position[] {
  const captures = legalSteps(game, player).filter((step) => step.captured);
  return captures.map((step) => step.from).filter((p, i, all) => all.findIndex((other) => same(p, other)) === i);
}
export function hasCapture(game: BoardState, player: number) { return captureSources(game, player).length > 0; }

/** Reduced-material International endings, measured in complete turns. */
function endgameLimit(game: Game): number | undefined {
  const pieces = game.board.flat();
  const sides = [0, 1].map((side) => pieces.filter((piece) => owner(piece) === side));
  for (const side of [0, 1]) {
    if (sides[side].length !== 1 || sides[side][0] < 3) continue;
    const other = sides[1 - side];
    if (!other.some((piece) => piece >= 3)) continue;
    if (other.length <= 2) return 10;
    if (other.length === 3) return 32;
  }
}

export function applyMove(source: Game, player: number, move: Move, record = true): Game {
  if (source.status !== "playing") throw new InvalidMove("This game is already over.");
  if (source.turn !== player) throw new InvalidMove("Wait for your turn.");
  if (!move || !inside(source, move.from) || !inside(source, move.to)) throw new InvalidMove("That square is outside the board.");
  const step = legalSteps(source, player).find((step) => same(step.from, move.from) && same(step.to, move.to));
  if (!step) throw new InvalidMove(international(source) ? "Choose a legal move; you must capture the largest number of pieces." : "Choose a legal move; captures are required.");
  const game = structuredClone(source);
  const { from, to } = step;
  const piece = game.board[from.row][from.col];
  game.board[from.row][from.col] = 0;
  game.board[to.row][to.col] = piece;
  if (step.captured) {
    if (international(game)) game.captured = [...(game.captured ?? []), step.captured];
    else game.board[step.captured.row][step.captured.col] = 0;
  }
  const crowned = piece < 3 && (piece === 1 ? to.row === 0 : to.row === game.board.length - 1);
  delete game.forced;
  if (step.captured && (international(game) || !crowned) && steps(game, to, true).length) {
    game.forced = to;
  } else {
    if (crowned) game.board[to.row][to.col] = piece + 2;
    for (const p of game.captured ?? []) game.board[p.row][p.col] = 0;
    delete game.captured;
    game.idlePlies = step.captured || piece < 3 ? 0 : game.idlePlies + 1;
    game.turn = (1 - player) as 0 | 1;
    if (!legalSteps(game, game.turn).length) {
      game.winner = player as 0 | 1;
      game.status = "finished";
    } else if (international(game)) {
      const limit = endgameLimit(game);
      const previousLimit = endgameLimit(source);
      const remaining = source.endgamePlies ?? previousLimit;
      game.endgamePlies = Math.min(remaining === undefined ? Infinity : remaining - 1, limit ?? Infinity);
      if (!Number.isFinite(game.endgamePlies)) delete game.endgamePlies;
      if (step.captured || piece < 3) game.repetitions = {};
      game.repetitions ??= { [positionKey(source)]: 1 };
      const key = positionKey(game);
      game.repetitions[key] = (game.repetitions[key] ?? 0) + 1;
      if (game.idlePlies >= 50 || game.repetitions[key] >= 3 || (game.endgamePlies ?? Infinity) <= 0) game.status = "finished";
    } else if (game.idlePlies >= 80) game.status = "finished";
  }
  game.revision++;
  if (record) game.recentMoves = [...(source.recentMoves ?? []), { from, to, revision: game.revision }].slice(-64);
  game.updatedAt = new Date().toISOString();
  return game;
}

export function playerIndex(game: Game, id: string) { return id ? game.players.findIndex((player) => player.id === id) : -1; }
export function owner(piece: number) { return piece === 1 || piece === 3 ? 0 : piece === 2 || piece === 4 ? 1 : -1; }
export function same(a?: Position, b?: Position) { return !!a && !!b && a.row === b.row && a.col === b.col; }
function canTravel(piece: number, dr: number) { return piece >= 3 || (piece === 1 && dr < 0) || (piece === 2 && dr > 0); }
function inside(game: BoardState, p?: Position) { return !!p && Number.isInteger(p.row) && Number.isInteger(p.col) && p.row >= 0 && p.col >= 0 && p.row < game.board.length && p.col < game.board.length; }
