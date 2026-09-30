import { chooseComputerMove } from "./computer";
import { applyMove } from "./rules";
import type { Game } from "./types";

// Search off the rendering thread so the board stays smooth on mobile.
self.onmessage = ({ data: game }: MessageEvent<Game>) => {
  const move = chooseComputerMove(game, 150);
  self.postMessage(move ? applyMove(game, game.turn, move) : game);
};
