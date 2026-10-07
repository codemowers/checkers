"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { newGame } from "../lib/rules";
import { type Ruleset } from "../lib/rulesets";
import { toPublicGame } from "../lib/public-game";
import { COMPUTER_PAIRS, computerPair } from "../lib/computer-names";
import { GameHeader } from "./game-header";
import type { Game } from "../lib/types";

const Board = dynamic(() => import("./webgl-board"), { ssr: false });
const ignoreMove = () => {};

function newDemoGame(id: string, ruleset: Ruleset, pairIndex: number): Game {
  const game = newGame(id, ruleset);
  const names = computerPair(pairIndex);
  game.players = [{ id: "computer:red", name: names[0] }, { id: "computer:black", name: names[1] }];
  return game;
}

export default function Demo({ ruleset, onExit, signInUrl }: { ruleset: Ruleset; onExit: () => void; signInUrl?: string }) {
  const [firstPair] = useState(() => Math.floor(Math.random() * COMPUTER_PAIRS.length));
  const [game, setGame] = useState(() => newDemoGame("demo", ruleset, firstPair));
  const current = useRef(game);
  const [paused, setPaused] = useState(false);
  const [round, setRound] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (paused || current.current.status === "finished") return;
    let worker: Worker;
    let timer: ReturnType<typeof setTimeout>;
    try { worker = new Worker(new URL("../lib/demo.worker.ts", import.meta.url)); }
    catch (error) {
      if (!(error instanceof DOMException && error.name === "SecurityError")) throw error;
      setError("Could not start the demo. Try again."); return;
    }
    const next = () => { timer = setTimeout(() => worker.postMessage(current.current), 900); };
    worker.onmessage = ({ data }: MessageEvent<Game>) => {
      if (data.revision === current.current.revision && data.status !== "finished") {
        setError("The demo stopped. Start another game.");
        return;
      }
      current.current = data;
      setGame(data);
      if (data.status !== "finished") next();
    };
    worker.onerror = (event) => {
      setError("Could not continue the demo. Try again.");
      clearTimeout(timer);
      worker.terminate();
    };
    next();
    return () => { clearTimeout(timer); worker.terminate(); };
  }, [paused, round]);

  const restart = () => {
    const fresh = newDemoGame(`demo:${round + 1}`, ruleset, firstPair + round + 1);
    current.current = fresh;
    setGame(fresh);
    setError("");
    setPaused(false);
    setRound((value) => value + 1);
  };
  const finished = game.status === "finished";
  const status = error || (finished
    ? game.winner == null ? "Draw." : `${game.players[game.winner].name} wins.`
    : paused ? "Demo paused." : `${game.players[game.turn].name} (${game.turn === 0 ? "Red" : "Black"}) is thinking…`);

  return <main>
    <GameHeader game={toPublicGame(game, null)} signInUrl={signInUrl} />
    <section className="game-shell"><div className="table-wrap">
      <Board game={toPublicGame(game, null)} player={0} onMove={ignoreMove} disabled autoOrbit orbitPaused={paused} />
    </div></section>
    <div className="status-card bottom-status">
      <p aria-live="polite">{status}</p>
      <div className="lobby-actions">
      {finished || error
        ? <button onClick={restart}>Watch another game</button>
        : <button onClick={() => setPaused((value) => !value)}>{paused ? "Resume demo" : "Pause demo"}</button>}
      <button onClick={onExit}>Back to play</button>
      </div>
    </div>
  </main>;
}
