"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPublicGame } from "../lib/public-game";
import { applyMove, hasCapture, newGame } from "../lib/rules";
import type { GameEvent, Move, PublicGame } from "../lib/types";

const Board = dynamic(() => import("./webgl-board"), { ssr: false, loading: () => <div className="board-loading">Setting the table…</div> });

const ADJECTIVES = [
  "Warty", "Hoary", "Breezy", "Dapper", "Edgy", "Feisty", "Gutsy", "Hardy", "Intrepid", "Jaunty", "Karmic", "Lucid", "Maverick", "Natty", "Oneiric", "Precise", "Quantal", "Raring", "Saucy", "Trusty", "Utopic", "Vivid", "Wily", "Xenial", "Yakkety", "Zesty", "Artful", "Bionic", "Cosmic", "Disco", "Eoan", "Focal", "Groovy", "Hirsute", "Impish", "Jammy", "Kinetic", "Lunar", "Mantic", "Noble", "Oracular", "Plucky", "Questing", "Resolute", "Stonking",
];
const ANIMALS = [
  "Warthog", "Hedgehog", "Badger", "Drake", "Eft", "Fawn", "Gibbon", "Heron", "Ibex", "Jackalope", "Koala", "Lynx", "Meerkat", "Narwhal", "Ocelot", "Pangolin", "Quetzal", "Ringtail", "Salamander", "Tahr", "Unicorn", "Vervet", "Werewolf", "Xerus", "Yak", "Zapus", "Aardvark", "Beaver", "Cuttlefish", "Dingo", "Ermine", "Fossa", "Gorilla", "Hippo", "Indri", "Jellyfish", "Kudu", "Lobster", "Minotaur", "Numbat", "Oriole", "Puffin", "Quokka", "Raccoon", "Stingray",
];

function randomName() {
  const pick = <T,>(items: T[]) => items[crypto.getRandomValues(new Uint32Array(1))[0] % items.length];
  return `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
}

/**
 * Per-tab seat credential. sessionStorage is already scoped to one tab, so a
 * second tab gets a second seat on its own; keeping the value stable across
 * reloads and link navigation is what lets a player reconnect to their table.
 */
function localPlayerId() {
  let id = sessionStorage.getItem("checkers-player");
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem("checkers-player", id); }
  return id;
}

export default function GameRoom({ initialGameId, playerName, anonymous, selfPlayEnabled }: { initialGameId?: string; playerName?: string; anonymous: boolean; selfPlayEnabled: boolean }) {
  const [gameId, setGameId] = useState<string | undefined>(initialGameId);
  const [game, setGame] = useState<PublicGame>();
  const [matchmaking, setMatchmaking] = useState(!initialGameId);
  const [message, setMessage] = useState(initialGameId ? "Reconnecting to the table…" : "Taking a seat at the next open table…");
  const [moving, setMoving] = useState(false);
  const [hasMoved, setHasMoved] = useState(false);
  const [anonymousName, setAnonymousName] = useState("");
  const [draftName, setDraftName] = useState("");
  const [nameLoaded, setNameLoaded] = useState(!anonymous);
  const [opening, setOpening] = useState<Move>();
  const openingPlayed = useRef(false);
  const openingDropped = useRef(false);
  const instanceId = useRef<string>();
  const nameInput = useRef<HTMLInputElement>(null);
  const displayName = anonymous ? anonymousName : playerName ?? "Player";

  /**
   * The table you sit at while nobody has arrived yet. Matchmaking always seats
   * whoever waits as red, and red moves first, so an opening picked here is
   * still legal — and still yours to play — the moment an opponent shows up.
   */
  const preview = useMemo(() => {
    const table = newGame("opening-preview");
    table.players = [{ id: "", name: displayName || "You" }, { id: "", name: "Opponent" }];
    try { return toPublicGame(opening ? applyMove(table, 0, opening) : table, 0); }
    catch { return toPublicGame(table, 0); }
  }, [displayName, opening]);

  useEffect(() => {
    if (!anonymous) return;
    const saved = sessionStorage.getItem("checkers-name")?.trim();
    const suggested = saved || randomName();
    setDraftName(suggested);
    if (saved) setAnonymousName(saved);
    setNameLoaded(true);
  }, [anonymous]);

  useEffect(() => {
    if (anonymous && nameLoaded && !anonymousName) nameInput.current?.select();
  }, [anonymous, anonymousName, nameLoaded]);

  const headers = useCallback((json = false) => {
    if (!instanceId.current) instanceId.current = localPlayerId();
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      "X-Player-Instance": instanceId.current,
      ...(anonymous ? { "X-Player-Name": encodeURIComponent(displayName) } : {}),
    };
  }, [anonymous, displayName]);

  useEffect(() => {
    if (!matchmaking || (anonymous && !anonymousName)) return;
    let cancelled = false;
    async function findGame() {
      try {
        const response = await fetch("/api/game/match", { method: "POST", headers: headers() });
        if (response.status === 401) { location.href = "/signin"; return; }
        const result = await response.json();
        if (!cancelled && result.status === "game") {
          setGameId(result.gameId);
          setMatchmaking(false);
          history.replaceState(null, "", `/games/${result.gameId}`);
        }
        else if (!cancelled) window.setTimeout(findGame, 1200);
      } catch { if (!cancelled) { setMessage("Reconnecting to the table…"); window.setTimeout(findGame, 1800); } }
    }
    findGame();
    return () => { cancelled = true; };
  }, [anonymous, anonymousName, headers, matchmaking]);

  useEffect(() => {
    if (!gameId || (anonymous && !anonymousName)) return;
    const aborter = new AbortController();
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const end = (text: string) => {
      stopped = true;
      setGame(undefined);
      setGameId(undefined);
      setMatchmaking(false);
      setMessage(text);
    };
    async function connect() {
      try {
        const response = await fetch(`/api/game/games/${gameId}/events`, { headers: headers(), signal: aborter.signal });
        if (response.status === 401) { location.href = `/signin?callbackUrl=${encodeURIComponent(`/games/${gameId}`)}`; return; }
        if (response.status === 404) { end("The game is no longer available."); return; }
        if (response.status === 403) { end("This table belongs to another game."); return; }
        if (!response.ok || !response.body) throw new Error("Game stream unavailable");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
            if (data) {
              const event = JSON.parse(data) as GameEvent;
              if (event.type === "ended") { end(event.message); aborter.abort(); return; }
              setGame((current) => !current || current.id !== event.game.id || event.game.revision > current.revision ? event.game : current);
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch {
        if (aborter.signal.aborted || stopped) return;
        setMessage("Reconnecting to the table…");
      }
      if (!stopped && !aborter.signal.aborted) retry = setTimeout(connect, 1500);
    }
    void connect();
    return () => {
      stopped = true;
      aborter.abort();
      if (retry) clearTimeout(retry);
    };
  }, [anonymous, anonymousName, gameId, headers]);

  useEffect(() => {
    document.title = game?.status === "playing"
      ? `Checkers with ${game.players[1 - game.you].name}`
      : "Codemowers Checkers";
  }, [game]);

  const move = useCallback(async (proposed: Move) => {
    if (!game || game.turn !== game.you || moving) return;
    setMoving(true);
    try {
      const response = await fetch(`/api/game/games/${game.id}/moves`, { method: "POST", headers: headers(true), body: JSON.stringify(proposed) });
      const result = await response.json();
      if (!response.ok) setMessage(result.error ?? "That move is not allowed.");
      else { setGame(result); setHasMoved(true); setMessage(""); }
    } finally { setMoving(false); }
  }, [game, moving, headers]);

  /** Hand the opening over as soon as the seat it was chosen for is confirmed. */
  useEffect(() => {
    if (!game || !opening || openingPlayed.current) return;
    openingPlayed.current = true;
    setOpening(undefined);
    if (game.you === 0 && game.status === "playing" && game.turn === 0 && game.revision === 1) void move(opening);
    else openingDropped.current = true;
  }, [game, move, opening]);

  useEffect(() => {
    if (!game) return;
    if (game.revision > 1) openingDropped.current = false;
    const you = game.you;
    if (game.status === "finished") {
      if (game.winner == null) setMessage("A draw — neither side made progress.");
      else setMessage(game.winner === you ? "You won. Nicely played." : `${game.players[game.winner].name} won this round.`);
    }
    else if (openingDropped.current && game.revision === 1) setMessage(`You drew black, so your opening was set aside — ${game.players[game.turn].name} opens.`);
    else if (game.forced && game.turn === you) setMessage("Keep jumping — another capture is open.");
    else if (game.turn === you && hasCapture(game, you)) setMessage("A capture is required. Use a ringed piece.");
    else if (game.turn === you && !hasMoved) setMessage("Your turn — drag a piece, or tap it then choose a highlighted square.");
    else setMessage(game.turn === you ? "Your move." : `${game.players[game.turn].name} is thinking…`);
  }, [game, hasMoved]);

  useEffect(() => { setHasMoved(false); }, [game?.id]);

  const chooseName = (event: React.FormEvent) => {
    event.preventDefault();
    const name = draftName.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) return;
    sessionStorage.setItem("checkers-name", name);
    setDraftName(name);
    setAnonymousName(name);
  };

  const participate = () => {
    history.replaceState(null, "", "/");
    setGame(undefined);
    setGameId(undefined);
    setOpening(undefined);
    openingPlayed.current = false;
    openingDropped.current = false;
    setMessage("Taking a seat at the next open table…");
    setMatchmaking(true);
  };

  const quit = async () => {
    if (!game) return;
    await fetch(`/api/game/games/${game.id}`, { method: "DELETE", headers: headers(), keepalive: true });
    history.replaceState(null, "", "/");
    setGame(undefined);
    setGameId(undefined);
    setMatchmaking(false);
    setMessage("You left the game.");
  };

  const turnClass = game?.status === "playing" ? (game.turn === game.you ? "your-turn" : "opponent-turn") : "";
  // Also true behind the name prompt, where the lit table makes a better backdrop than a placeholder.
  const waitingForOpponent = matchmaking && !gameId;

  return <main className={turnClass}>
    <header>
      <a className="brand" href="https://github.com/codemowers/checkers" target="_blank" rel="noreferrer" draggable={false} aria-label="Checkers by Codemowers on GitHub"><span className="brand-mark">◆</span><span>CHECKERS <small>BY CODEMOWERS</small></span></a>
      {game
        ? <MatchScore game={game} displayName={displayName} />
        : <div className="identity"><span className="online-dot" />{displayName || "Anonymous player"}</div>}
      <div className="nav-actions">{game?.status === "playing" && <button className="quit" onClick={quit}>Quit game</button>}</div>
    </header>

    <section className="game-shell">
      <div className="table-wrap">
        {game
          ? <Board game={game} player={game.you} onMove={move} disabled={moving} />
          : waitingForOpponent
            ? <Board game={preview} player={0} onMove={setOpening} disabled={!!opening} />
            : gameId
              ? <WaitingTable />
              : <EndedTable message={message} onRestart={participate} />}
      </div>
    </section>

    {game && <div className="status-card bottom-status">
      <p aria-live="polite">{message}</p>
      {game.status === "finished" && <button onClick={participate}>Participate again</button>}
    </div>}

    {waitingForOpponent && <div className="status-card bottom-status waiting-card">
      <p aria-live="polite">{opening
        ? "Opening move set. It plays the moment somebody sits down."
        : "Waiting for an opponent — you have red, so open whenever you like."}</p>
      {opening
        ? <button className="quit" onClick={() => setOpening(undefined)}>Take it back</button>
        : selfPlayEnabled && <small>Or open a second tab to play both sides.</small>}
      <span className="loader" />
    </div>}

    {anonymous && nameLoaded && !anonymousName && <div className="name-overlay">
      <form className="name-prompt" onSubmit={chooseName}>
        <span className="eyebrow">ANONYMOUS TABLE</span>
        <h2>Choose your name</h2>
        <input ref={nameInput} autoFocus required maxLength={40} value={draftName} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDraftName(event.target.value)} aria-label="Player name" />
        <button type="submit">Find a game</button>
      </form>
    </div>}

  </main>;
}

function MatchScore({ game, displayName }: { game: PublicGame; displayName: string }) {
  const you = game.you;
  const pieces = game.board.flat();
  const captured = [
    12 - pieces.filter((piece) => piece === 2 || piece === 4).length,
    12 - pieces.filter((piece) => piece === 1 || piece === 3).length,
  ];
  return <div className="nav-match">
    <span className={game.turn === you ? "active" : ""}>
      <b className={you === 0 ? "red-chip" : "dark-chip"} />
      <span>{displayName}<small>YOU · {you === 0 ? "RED" : "BLACK"}</small></span>
      <strong title="Pieces captured">{captured[you]}</strong>
    </span>
    <em>VS</em>
    <span className={game.turn !== you ? "active" : ""}>
      <strong title="Pieces captured">{captured[1 - you]}</strong>
      <b className={you === 0 ? "dark-chip" : "red-chip"} />
      <span>{game.players[1 - you].name}<small>OPPONENT · {you === 0 ? "BLACK" : "RED"}</small></span>
    </span>
  </div>;
}

function WaitingTable() {
  return <div className="waiting">
    <div className="pieces"><i /><i /></div>
    <h2>Setting the table</h2>
    <p>Your match is ready.</p>
    <span className="loader" />
  </div>;
}

function EndedTable({ message, onRestart }: { message: string; onRestart: () => void }) {
  return <div className="waiting paused">
    <div className="pieces"><i /><i /></div>
    <h2>Game ended</h2>
    <p>{message}</p>
    <button onClick={onRestart}>Participate again</button>
  </div>;
}
