"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { anonymousIcon, randomName } from "../lib/anonymous-names";
import { fetchResponse, readJson, readChunk, NetworkError, RequestError } from "../lib/http-client";
import { predictMove } from "../lib/board-playback";
import type { Ruleset } from "../lib/rulesets";
import { toPublicGame } from "../lib/public-game";
import { hasCapture, newGame } from "../lib/rules";
import { PlayerAvatar, PlayerHeader } from "./player-header";
import type { GameEvent, Move, PublicGame } from "../lib/types";

const Board = dynamic(() => import("./webgl-board"), { ssr: false, loading: () => <div className="board-loading">Setting the table…</div> });

const Demo = dynamic(() => import("./demo"), { ssr: false });

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

export default function GameRoom({ initialGameId, playerName, playerAvatar, anonymous, allowSignIn, inviteOnly, enableComputer, enableDemo, allowSpectators }: { initialGameId?: string; playerName?: string; playerAvatar?: string | null; anonymous: boolean; allowSignIn: boolean; inviteOnly: boolean; enableComputer: boolean; enableDemo: boolean; allowSpectators: boolean }) {
  const [streamVersion, setStreamVersion] = useState(0);
  const [watching, setWatching] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");
  const [ruleset, setRuleset] = useState<Ruleset>("english");
  const [matchBusy, setMatchBusy] = useState(false);
  const busy = useRef(false);
  const [demo, setDemo] = useState(false);
  const [matchError, setMatchError] = useState("");
  const [lobby, setLobby] = useState(!initialGameId);
  const [gameId, setGameId] = useState<string | undefined>(initialGameId);
  const [game, setGame] = useState<PublicGame>();
  const [optimistic, setOptimistic] = useState<PublicGame>();
  useEffect(() => { if (game) setOptimistic(undefined); }, [game]);
  const [shareMessage, setShareMessage] = useState("");
  useEffect(() => {
    if (!shareMessage) return;
    const timer = setTimeout(() => setShareMessage(""), 3000);
    return () => clearTimeout(timer);
  }, [shareMessage]);
  const [message, setMessage] = useState(initialGameId ? "Reconnecting to the table…" : "Taking a seat at the next open table…");
  const [moving, setMoving] = useState(false);
  const [hasMoved, setHasMoved] = useState(false);
  const [anonymousName, setAnonymousName] = useState("");
  const [draftName, setDraftName] = useState("");
  const instanceId = useRef<string | undefined>(undefined);
  const nameInput = useRef<HTMLInputElement>(null);
  const displayName = anonymous ? anonymousName : playerName ?? "Player";

  const preview = useMemo(() => {
    const table = newGame(`opening-preview:${ruleset}`, ruleset);
    table.players = [{ id: "", name: displayName || "You" }, { id: "", name: "Opponent" }];
    return toPublicGame(table, 0);
  }, [displayName, ruleset]);

  useEffect(() => {
    if (!anonymous) return;
    const saved = sessionStorage.getItem("checkers-name")?.trim();
    const suggested = saved || randomName();
    setDraftName(suggested);
    sessionStorage.setItem("checkers-name", suggested);
    setAnonymousName(suggested);
  }, [anonymous]);

  useEffect(() => {
    if (editingName) nameInput.current?.select();
  }, [editingName]);

  const headers = useCallback((json = false) => {
    if (!instanceId.current) instanceId.current = localPlayerId();
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      "X-Player-Instance": instanceId.current,
      ...(anonymous ? { "X-Player-Name": encodeURIComponent(displayName) } : {}),
    };
  }, [anonymous, displayName]);

  const adoptGame = useCallback((id: string) => {
    setGameId(id);
    setLobby(false);
    history.replaceState(null, "", `/games/${id}`);
  }, []);

  const openTable = async (opening: Move) => {
    if (busy.current) return;
    busy.current = true;
    setMatchBusy(true);
    setMatchError("");
    setOptimistic(predictMove(preview, opening));
    try {
      const response = await fetchResponse("/api/game/match", {
        method: "POST", headers: headers(true), body: JSON.stringify({ ruleset, opening }),
      });
      if (response.status === 401) { location.href = "/signin"; return; }
      const result = await readJson(response);
      if (!response.ok) throw new RequestError(result.error ?? "Could not open a table.");
      adoptGame(result.gameId);
    } catch (error) {
      if (!(error instanceof NetworkError || error instanceof RequestError)) throw error;
      setOptimistic(undefined); setMatchError(error instanceof Error ? error.message : "Could not connect. Try your move again."); }
    finally { busy.current = false; setMatchBusy(false); }
  };

  const chooseComputer = async () => {
    if (!gameId || busy.current) return;
    busy.current = true;
    setMatchBusy(true);
    setMatchError("");
    try {
      const response = await fetchResponse(`/api/game/games/${gameId}/join`, {
        method: "POST", headers: headers(true), body: JSON.stringify({ opponent: "computer" }),
      });
      const result = await readJson(response);
      if (!response.ok) {
        throw new RequestError(result.error ?? "Could not join the table.");
      }
      setGame(result);
    } catch (error) {
      if (!(error instanceof NetworkError || error instanceof RequestError)) throw error;
      setMatchError(error instanceof Error ? error.message : "Could not connect. Please try again."); }
    finally { busy.current = false; setMatchBusy(false); }
  };

  const takeSeat = async () => {
    if (!gameId || busy.current) return;
    busy.current = true;
    setMatchBusy(true);
    setMatchError("");
    try {
      const response = await fetchResponse(`/api/game/games/${gameId}/join`, {
        method: "POST", headers: headers(true), body: JSON.stringify({ opponent: "human" }),
      });
      if (response.status === 401) { location.href = `/signin?callbackUrl=${encodeURIComponent(`/games/${gameId}`)}`; return; }
      const result = await readJson(response);
      if (!response.ok) throw new RequestError(result.error ?? "Could not take this seat.");
      setGame(result);
      setWatching(false);
      setStreamVersion(value => value + 1);
    } catch (error) {
      if (!(error instanceof NetworkError || error instanceof RequestError)) throw error;
      setMatchError(error instanceof Error ? error.message : "Could not take this seat.");
    } finally { busy.current = false; setMatchBusy(false); }
  };

  const share = async () => {
    const url = `${location.origin}/games/${gameId}`;
    try {
      if (navigator.share) await navigator.share({ title: "Checkers", url });
      else { await navigator.clipboard.writeText(url); setShareMessage("Link copied."); }
    } catch (error) {
      if (!(error instanceof DOMException) || !["AbortError", "NotAllowedError", "InvalidStateError", "DataError"].includes(error.name)) throw error;
      if (error.name !== "AbortError") setShareMessage("Could not share the game. Please try again.");
    }
  };

  useEffect(() => {
    if (!gameId || (anonymous && !anonymousName)) return;
    const aborter = new AbortController();
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const end = (text: string) => {
      stopped = true;
      setGame(undefined);
      setGameId(undefined);
      setLobby(false);
      setMessage(text);
    };
    async function connect() {
      try {
        const response = await fetchResponse(`/api/game/games/${gameId}/events`, { headers: headers(), signal: aborter.signal });
        if (response.status === 401) { location.href = `/signin?callbackUrl=${encodeURIComponent(`/games/${gameId}`)}`; return; }
        if (response.status === 404) { end("The game is no longer available."); return; }
        if (response.status === 403) {
          const joined = await fetchResponse(`/api/game/games/${gameId}/join`, {
            method: "POST", headers: headers(true), body: JSON.stringify({ opponent: "human" }), signal: aborter.signal,
          });
          if (joined.status === 401) { location.href = `/signin?callbackUrl=${encodeURIComponent(`/games/${gameId}`)}`; return; }
          const result = await readJson(joined);
          if (stopped || aborter.signal.aborted) return;
          if (joined.ok) {
            setGame(result);
            setWatching(false);
            retry = setTimeout(connect, 0);
            return;
          }
          if ([403, 404, 409].includes(joined.status)) {
            end(result.error ?? "This table is no longer available.");
            return;
          }
          throw new RequestError("Could not join the table");
        }
        if (!response.ok || !response.body) throw new RequestError("Game stream unavailable");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!stopped) {
          const { done, value } = await readChunk(reader);
          if (done || stopped || aborter.signal.aborted) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
            if (data) {
              const event = JSON.parse(data) as GameEvent;
              if (event.type === "ended") { end(event.message); aborter.abort(); return; }
              setWatching(event.game.you === null);
              setGame((current) => !current || current.id !== event.game.id || event.game.revision > current.revision ? event.game : current);
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!(error instanceof NetworkError || error instanceof RequestError)) throw error;
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
  }, [anonymous, anonymousName, gameId, headers, streamVersion]);

  useEffect(() => {
    document.title = game?.waiting ? "Waiting for an opponent · Checkers" : game?.status === "playing"
      ? `Checkers with ${game.players[1 - (game.you ?? 0)].name}`
      : "Codemowers Checkers";
  }, [game]);

  const move = useCallback(async (proposed: Move) => {
    if (!game || game.turn !== game.you || moving) return;
    setMoving(true);
    setOptimistic(predictMove(game, proposed));
    try {
      const response = await fetchResponse(`/api/game/games/${game.id}/moves`, { method: "POST", headers: headers(true), body: JSON.stringify(proposed) });
      const result = await readJson(response);
      if (!response.ok) { setOptimistic(undefined); setMessage(result.error ?? "That move is not allowed."); }
      else { setGame((current) => !current || result.revision >= current.revision ? result : current); setOptimistic(undefined); setHasMoved(true); setMessage(""); }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      try {
        const response = await fetchResponse(`/api/game/games/${game.id}`, { headers: headers() });
        if (response.ok) setGame(await readJson(response));
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
        // Keep the confirmed board while the stream reconnects.
      }
      finally { setOptimistic(undefined); setMessage("Connection interrupted. Check the board before retrying."); }
    }
    finally { setMoving(false); }
  }, [game, moving, headers]);

  useEffect(() => {
    if (!game) return;
    const you = game.you;
    if (you === null) {
      setMessage(game.status === "finished"
        ? game.winner == null ? "Draw." : `${game.players[game.winner].name} wins.`
        : game.waiting ? "Watching — waiting for an opponent." : `Watching — ${game.players[game.turn].name} to move.`);
      return;
    }
    if (game.status === "finished") {
      if (game.winner == null) setMessage("A draw — neither side made progress.");
      else setMessage(game.winner === you ? "You won. Nicely played." : `${game.players[game.winner].name} won this round.`);
    }
    else if (game.waiting) setMessage("Your opening is played. Waiting for an opponent…");
    else if (game.forced && game.turn === you) setMessage("Keep jumping — another capture is open.");
    else if (game.turn === you && hasCapture(game, you)) setMessage("A capture is required. Use a ringed piece.");
    else if (game.turn === you && !hasMoved) setMessage("Your turn — drag a piece, or tap it then choose a highlighted square.");
    else setMessage(game.turn === you ? "Your move." : `${game.players[game.turn].name} is thinking…`);
  }, [game, hasMoved]);

  useEffect(() => { setHasMoved(false); }, [game?.id]);

  const chooseName = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = draftName.trim().replace(/\s+/g, " ");
    if (!name || name.length > 40 || savingName) return;
    setSavingName(true);
    setNameError("");
    try {
      if (game && game.you !== null) {
        const response = await fetchResponse(`/api/game/games/${game.id}`, {
          method: "PATCH", headers: headers(true), body: JSON.stringify({ name }),
        });
        const result = await readJson(response);
        if (!response.ok) throw new RequestError(result.error ?? "Could not change your name.");
        setGame(current => !current || result.revision >= current.revision ? result : current);
      }
      sessionStorage.setItem("checkers-name", name);
      setDraftName(name);
      setAnonymousName(name);
      setEditingName(false);
    } catch (error) {
      if (!(error instanceof NetworkError || error instanceof RequestError)) throw error;
      setNameError(error instanceof Error ? error.message : "Could not change your name.");
    } finally { setSavingName(false); }
  };

  const participate = () => {
    if (inviteOnly && anonymous) { location.href = "/signin?callbackUrl=%2F"; return; }
    history.replaceState(null, "", "/");
    setGame(undefined);
    setOptimistic(undefined);
    setGameId(undefined);
    setWatching(false);
    setShareMessage("");
    setMatchError("");
    setMessage("Taking a seat at the next open table…");
    setLobby(true);
  };

  const quit = async () => {
    if (!game) return;
    try {
      const response = await fetchResponse(`/api/game/games/${game.id}`, { method: "DELETE", headers: headers(), keepalive: true });
      if (!response.ok) throw new RequestError("Could not leave the game. Try again.");
      participate();
    } catch (error) {
      if (!(error instanceof NetworkError || error instanceof RequestError)) throw error;
      setMatchError(error instanceof Error ? error.message : "Could not leave the game. Try again.");
    }
  };

  const displayed = optimistic ?? game;
  const turnClass = game?.you != null && game.status === "playing" ? (game.turn === game.you ? "your-turn" : "opponent-turn") : "";
  const waitingForOpponent = lobby && !gameId;

  const signInUrl = `/signin?callbackUrl=${encodeURIComponent(gameId ? `/games/${gameId}` : "/")}`;

  const identityActions = <>
    {anonymous && anonymousName && <button type="button" onClick={() => { setDraftName(anonymousName); setNameError(""); setEditingName(true); }}>Change name</button>}
    {allowSignIn && <button type="button" onClick={() => { location.href = signInUrl; }}>Log in</button>}
  </>;
  const nameEditor = anonymous && editingName && <div className="name-overlay" role="dialog" aria-modal="true" aria-labelledby="change-name-title">
    <form className="name-prompt" onSubmit={chooseName}>
      <h2 id="change-name-title">Change name</h2>
      <span className="name-avatar" aria-hidden="true">{anonymousIcon(draftName)}</span>
      <input ref={nameInput} autoFocus required maxLength={40} disabled={savingName} value={draftName} onChange={event => setDraftName(event.target.value)} aria-label="Player name" />
      {nameError && <p role="alert">{nameError}</p>}
      <div className="name-actions">
        <button type="submit" disabled={savingName}>{savingName ? "Saving…" : "Save name"}</button>
        <button type="button" disabled={savingName} onClick={() => setEditingName(false)}>Cancel</button>
      </div>
    </form>
  </div>;

  if (enableDemo && demo) return <Demo ruleset={ruleset} onExit={() => setDemo(false)} />;

  return <main className={turnClass}>
    <header>
      <a className="brand" href="https://github.com/codemowers/checkers" target="_blank" rel="noreferrer" draggable={false} aria-label="Checkers by Codemowers on GitHub"><span className="brand-mark">◆</span><span>CHECKERS <small>BY CODEMOWERS</small></span></a>
      {game && (!game.waiting || game.you === null)
        ? <PlayerHeader game={game} playerAvatar={playerAvatar} />
        : <div className="identity"><PlayerAvatar src={playerAvatar} name={anonymous ? anonymousName || draftName : undefined} />{displayName || "Anonymous player"}</div>}
      <div className="nav-actions">
        {!watching && (!gameId || game?.you != null) && identityActions}
        {game?.you != null && !game.waiting && allowSpectators && <button onClick={() => void share()}>Share game</button>}
        {game?.you != null && game.status === "playing" && <button className="quit" onClick={quit}>Quit game</button>}
      </div>
    </header>

    <section className="game-shell">
      <div className="table-wrap">
        {displayed
          ? <Board key={`${displayed.id}:${displayed.you ?? "spectator"}`} game={displayed} player={displayed.you ?? 1} autoOrbit={displayed.you === null} onMove={move} disabled={displayed.you === null || moving || !!displayed.waiting || matchBusy || !!optimistic} />
          : waitingForOpponent
            ? <Board game={preview} player={0} onMove={openTable} disabled={matchBusy || (anonymous && !anonymousName)} />
            : gameId
              ? <WaitingTable />
              : <EndedTable message={message} onRestart={participate} />}
      </div>
    </section>

    {game && <div className="status-card bottom-status">
      <p aria-live="polite">{matchError || shareMessage || message}</p>
      {game.waiting && game.you === null && <button disabled={matchBusy} onClick={takeSeat}>{matchBusy ? "Joining…" : `Play against ${game.players[0].name}`}</button>}
      {game.waiting && game.you === 0 && <div className="lobby-actions">
        <button onClick={() => void share()}>Invite</button>
        {enableComputer && <button disabled={matchBusy} onClick={() => void chooseComputer()}>{matchBusy ? "Joining…" : "Play computer instead"}</button>}
      </div>}
      {game.status === "finished" && !watching && <button onClick={participate}>Play again</button>}
    </div>}

    {waitingForOpponent && <div className="status-card bottom-status">
      <p aria-live="polite">{matchError || (matchBusy ? "Taking your seat…" : inviteOnly ? "Make your opening move, then share the game link to invite someone." : "Make your opening move. We’ll find you an opponent.")}</p>
      <div className="lobby-actions">
        <button type="button" disabled={matchBusy} onClick={() => setRuleset(ruleset === "english" ? "international" : "english")}>
          Switch to {ruleset === "english" ? "international" : "English"} rules
        </button>
        {enableDemo && <button disabled={matchBusy} onClick={() => setDemo(true)}>Watch demo</button>}
      </div>
    </div>}

    {!watching && nameEditor}

  </main>;
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
    <button onClick={onRestart}>Play again</button>
  </div>;
}
