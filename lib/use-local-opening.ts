"use client";

import { useCallback, useRef, useState } from "react";
import { moveLocalGame, newLocalGame } from "./local-game";
import type { Ruleset } from "./rulesets";
import type { Game, Move, PublicGame } from "./types";

export function useLocalOpening(enabled: boolean, defaultRuleset: Ruleset) {
  const [game, setGame] = useState<Game | undefined>(() => enabled ? newLocalGame(defaultRuleset) : undefined);
  const current = useRef(game);
  const update = useCallback((next: Game) => {
    current.current = next;
    setGame(next);
  }, []);
  const play = useCallback((move: Move) => {
    if (!current.current) return;
    const next = moveLocalGame(current.current, move);
    update(next);
    return next;
  }, [update]);
  const reset = useCallback((ruleset: Ruleset) => update(newLocalGame(ruleset)), [update]);
  const adopt = useCallback((table: PublicGame) => {
    let next = newLocalGame(table.ruleset);
    for (const move of table.recentMoves ?? []) next = moveLocalGame(next, move);
    update(next);
  }, [update]);
  return { game, openingMove: game?.revision === 2 ? game.recentMoves?.[0] : undefined, play, reset, adopt };
}
