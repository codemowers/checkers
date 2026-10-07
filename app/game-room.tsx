"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { anonymousIcon, randomName } from "../lib/anonymous-names";
import { fetchResponse, readJson, readChunk, NetworkError, RequestError } from "../lib/http-client";
import { acceptSnapshot } from "../lib/game-snapshot";
import { predictMove } from "../lib/board-playback";
import type { Ruleset } from "../lib/rulesets";
import type { RulesConfig } from "../lib/rules-config";
import { toPublicGame } from "../lib/public-game";
import { InvalidMove, hasCapture, newGame } from "../lib/rules";
import { useSignInVisibility } from "./sign-in-button";
import { GameHeader } from "./game-header";
import { useServerConnection } from "../lib/use-server-connection";
import { useLocalOpening } from "../lib/use-local-opening";
import { localPlayCommitted } from "../lib/local-game";
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

export default function GameRoom({ initialGameId, playerName, playerAvatar, anonymous, allowSignIn, enableMatchmaking, enableComputer, enableDemo, enableLocalPlay, allowSpectators, rulesConfig, localShell = false }: { rulesConfig: RulesConfig; initialGameId?: string; playerName?: string; playerAvatar?: string | null; anonymous: boolean; allowSignIn: boolean; enableMatchmaking: boolean; enableComputer: boolean; enableDemo: boolean; enableLocalPlay: boolean; allowSpectators: boolean; localShell?: boolean }) {
  const serverConnected = useServerConnection();
  const showSignIn = useSignInVisibility(allowSignIn, localShell);
  const [streamVersion, setStreamVersion] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");
  const [ruleset, setRuleset] = useState<Ruleset>(rulesConfig.defaultRuleset);
  const [matchBusy, setMatchBusy] = useState(false);
  const busy = useRef(false);
  const [demo, setDemo] = useState(false);
  const [matchError, setMatchError] = useState("");
  const [lobby, setLobby] = useState(!initialGameId);
  const [gameId, setGameId] = useState<string | undefined>(initialGameId);
  const [game, setGame] = useState<PublicGame>();
  const [offer, setOffer] = useState<PublicGame>();
  const defaultOpeningChoice = localShell ? "local" : enableMatchmaking ? "find" : enableLocalPlay ? "local" : "invite";
  const [openingChoice, setOpeningChoice] = useState<"find" | "invite" | "computer" | "local">(defaultOpeningChoice);
  const opening = useLocalOpening(enableLocalPlay, rulesConfig.defaultRuleset);
  const localStarted = !gameId && !!opening.game && opening.game.revision > 1;
  const localPlaying = !gameId && !!opening.game && localPlayCommitted(opening.game);
  const activeGameId = useRef(gameId);
  const receiveGame = useCallback((incoming: PublicGame) => {
    if (incoming.id !== activeGameId.current) return;
    setGame(current => acceptSnapshot(current, incoming));
  }, []);
  const watching = game?.you === null;
  const [optimistic, setOptimistic] = useState<PublicGame>();
  useEffect(() => { if (game) setOptimistic(undefined); }, [game]);
  const [shareMessage, setShareMessage] = useState<{ text: string; copied?: boolean }>();
  useEffect(() => {
    if (!shareMessage) return;
    const timer = setTimeout(() => setShareMessage(undefined), 3000);
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

  useEffect(() => { if (opening.game) setRuleset(opening.game.ruleset); }, [opening.game?.ruleset]);

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

  useEffect(() => {
    if (localPlaying || !serverConnected || !enableMatchmaking || !lobby || gameId || openingChoice !== "find" || demo || matchBusy || (anonymous && !anonymousName)) return;
    const aborter = new AbortController();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      try {
        const response = await fetchResponse(`/api/game/match?ruleset=${ruleset}`, { headers: headers(), signal: aborter.signal });
        if (response.status === 403) { setOffer(undefined); return; }
        if (!response.ok || !response.body) throw new RequestError("Lobby stream unavailable.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!stopped) {
          const { done, value } = await readChunk(reader);
          if (done || stopped) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = block.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
            if (data && !busy.current && !activeGameId.current) {
              const result = JSON.parse(data) as { game: PublicGame | null };
              setOffer(current => result.game ? (!current || current.id !== result.game.id ? result.game : acceptSnapshot(current, result.game)) : undefined);
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch (error) {
        if (aborter.signal.aborted) return;
        if (!(error instanceof NetworkError || error instanceof RequestError)) throw error;
      }
      if (!stopped) timer = setTimeout(() => void connect(), 1500);
    };
    void connect();
    return () => { stopped = true; aborter.abort(); if (timer) clearTimeout(timer); };
  }, [localPlaying, serverConnected, enableMatchmaking, lobby, gameId, openingChoice, demo, matchBusy, anonymous, anonymousName, ruleset, headers]);

  useEffect(() => { if (!serverConnected) setOffer(undefined); }, [serverConnected]);

  useEffect(() => { setMatchError(""); }, [offer?.id]);

  const adoptGame = useCallback((id: string) => {
    activeGameId.current = id;
    setGameId(id);
    setLobby(false);
    history.replaceState(null, "", `/games/${id}`);
  }, []);

  const requestSeat = async (id: string, opponent: "human" | "computer") => {
    const response = await fetchResponse(`/api/game/games/${id}/join`, {
      method: "POST", headers: headers(true), body: JSON.stringify({ opponent }),
    });
    if (response.status === 401) { location.href = `/signin?callbackUrl=${encodeURIComponent(`/games/${id}`)}`; return; }
    const result = await readJson<PublicGame & { error?: string }>(response);
    if (!response.ok) throw new RequestError(result.error ?? "Could not join the table.");
    return result;
  };

  const openTable = async (openingMove: Move, choice: "find" | "invite" | "computer") => {
    if (!serverConnected || busy.current) return;
    busy.current = true;
    setMatchBusy(true);
    setMatchError("");
    setOptimistic(predictMove(preview, openingMove));
    try {
      const response = await fetchResponse("/api/game/match", {
        method: "POST", headers: headers(true), body: JSON.stringify({ ruleset, opening: openingMove, invite: choice !== "find" }),
      });
      if (response.status === 401) { location.href = "/signin?callbackUrl=%2F"; return; }
      const result = await readJson(response);
      if (!response.ok) throw new RequestError(result.error ?? "Could not open a table.");
      if (result.status === "offer") {
        setOffer(result.game);
        setOptimistic(undefined);
        return;
      }
      setOffer(undefined);
      adoptGame(result.gameId);
      if (choice === "invite") await share(result.gameId);
      if (choice === "computer") {
        const joined = await requestSeat(result.gameId, "computer");
        if (joined) receiveGame(joined);
      }
    } catch (error) {
      if (!(error instanceof NetworkError || error instanceof RequestError)) throw error;
      setOptimistic(undefined); setMatchError(error instanceof Error ? error.message : "Could not connect. Try your move again."); }
    finally { busy.current = false; setMatchBusy(false); }
  };

  const joinTable = async (opponent: "human" | "computer") => {
    const id = offer?.id ?? gameId;
    if (!serverConnected || !id || busy.current) return;
    busy.current = true;
    setMatchBusy(true);
    setMatchError("");
    try {
      const result = await requestSeat(id, opponent);
      if (!result) return;
      if (offer) { adoptGame(id); setOffer(undefined); }
      receiveGame(result);
      if (opponent === "human") setStreamVersion(value => value + 1);
    } catch (error) {
      if (!(error instanceof NetworkError || error instanceof RequestError)) throw error;
      setMatchError(error.message);
    } finally { busy.current = false; setMatchBusy(false); }
  };

  const share = async (id = gameId) => {
    if (!serverConnected || !id) return;
    const url = `${location.origin}/games/${id}`;
    if (!navigator.clipboard) {
      setShareMessage({ text: "Clipboard unavailable. Copy the game link from your address bar." });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareMessage({ text: "Link copied", copied: true });
    } catch (error) {
      if (!(error instanceof DOMException) || !["AbortError", "NotAllowedError", "InvalidStateError", "DataError"].includes(error.name)) throw error;
      if (error.name !== "AbortError") setShareMessage({ text: "Could not copy the link. Try Invite again or copy the game link from your address bar." });
    }
  };

  useEffect(() => {
    if (!gameId || (anonymous && !anonymousName)) return;
    const aborter = new AbortController();
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const end = (text: string) => {
      if (activeGameId.current !== gameId || aborter.signal.aborted) return;
      stopped = true;
      setReconnecting(false);
      activeGameId.current = undefined;
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
            receiveGame(result);
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
              receiveGame(event.game);
              // A reconnect often returns the same revision. Recovery must not
              // depend on acceptSnapshot replacing the confirmed board.
              setReconnecting(false);
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!(error instanceof NetworkError || error instanceof RequestError)) throw error;
        if (aborter.signal.aborted || stopped) return;
      }
      if (!stopped && !aborter.signal.aborted) {
        setReconnecting(true);
        retry = setTimeout(connect, 1500);
      }
    }
    void connect();
    return () => {
      stopped = true;
      aborter.abort();
      if (retry) clearTimeout(retry);
    };
  }, [anonymous, anonymousName, gameId, headers, streamVersion, receiveGame]);

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
      else { receiveGame(result); setOptimistic(undefined); setHasMoved(true); }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      try {
        const response = await fetchResponse(`/api/game/games/${game.id}`, { headers: headers() });
        if (response.ok) receiveGame(await readJson(response));
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
        // Keep the confirmed board while the stream reconnects.
      }
      finally { setOptimistic(undefined); setMessage("Connection interrupted. Check the board before retrying."); }
    }
    finally { setMoving(false); }
  }, [game, moving, headers, receiveGame]);

  useEffect(() => {
    if (!game) return;
    if (reconnecting) { setMessage("Reconnecting to the table…"); return; }
    const you = game.you;
    if (you === null) {
      setMessage(game.status === "finished"
        ? game.winner == null ? "Draw." : `${game.players[game.winner].name} wins.`
        : game.waiting ? `${game.players[0].name} wants to play with you. Do you accept?` : `Watching — ${game.players[game.turn].name} to move.`);
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
  }, [game, hasMoved, reconnecting]);

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
        receiveGame(result);
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

  const participate = (choice: "find" | "invite" | "computer" | "local" = defaultOpeningChoice, fresh = false) => {
    if (!fresh && !gameId && opening.openingMove && choice !== "local") {
      setOpeningChoice(choice);
      setOffer(undefined);
      void openTable(opening.openingMove, choice);
      return;
    }
    if ((fresh || gameId) && enableLocalPlay) opening.reset(ruleset);
    history.replaceState(null, "", localShell ? "/local" : "/");
    activeGameId.current = undefined;
    setGame(undefined); setOffer(undefined); setGameId(undefined);
    setOpeningChoice(choice); setOptimistic(undefined);
    setShareMessage(undefined); setMatchError(""); setLobby(true);
  };

  const localMove = (proposed: Move) => {
    try {
      const next = opening.play(proposed);
      setOffer(undefined); setMatchError("");
      if (next?.revision === 2 && openingChoice !== "local") void openTable(proposed, openingChoice);
    }
    catch (error) { if (!(error instanceof InvalidMove)) throw error; setMatchError(error.message); }
  };

  const detachForLocal = async () => {
    if (!game?.waiting || game.you !== 0 || busy.current) return false;
    busy.current = true; setMatchBusy(true);
    try {
      const response = await fetchResponse(`/api/game/games/${game.id}?local=true&revision=${game.revision}`, { method: "DELETE", headers: headers() });
      if (!response.ok) throw new RequestError("The table changed. Check the board before switching to local play.");
      opening.adopt(game);
      activeGameId.current = undefined; setGameId(undefined); setGame(undefined);
      setLobby(true); setOpeningChoice("local");
      history.replaceState(null, "", localShell ? "/local" : "/");
      return true;
    } catch (error) {
      if (!(error instanceof NetworkError || error instanceof RequestError)) throw error;
      setMatchError(error.message); return false;
    } finally { busy.current = false; setMatchBusy(false); }
  };

  const quit = async (choice: "find" | "invite" | "local" = defaultOpeningChoice) => {
    if (localStarted) { participate(choice, true); return; }
    if (!game) return;
    try {
      const response = await fetchResponse(`/api/game/games/${game.id}`, { method: "DELETE", headers: headers(), keepalive: true });
      if (!response.ok) throw new RequestError("Could not leave the game. Try again.");
      participate(choice, true);
    } catch (error) {
      if (!(error instanceof NetworkError || error instanceof RequestError)) throw error;
      setMatchError(error instanceof Error ? error.message : "Could not leave the game. Try again.");
    }
  };

  const inviteSomeoneElse = (choice: "invite" | "computer") => {
    participate(choice, true);
  };

  const waitingLocalMove = async (proposed: Move) => {
    if (await detachForLocal()) localMove(proposed);
  };

  const localBoard = !gameId && !offer && enableLocalPlay && opening.game ? toPublicGame(opening.game, opening.game.turn) : undefined;
  const waitingLocal = enableLocalPlay && !!game?.waiting && game.you === 0;
  const displayed = optimistic ?? game ?? offer ?? localBoard ?? (lobby && !gameId ? preview : undefined);
  const scoreGame = localBoard ?? game ?? offer ?? displayed;
  const localSide = localBoard?.turn === 1 ? "Groovy Gorilla (Black)" : "Lunar Lobster (Red)";
  const localMessage = localBoard?.status === "finished" ? localBoard.winner == null ? "Draw." : `${localBoard.winner === 0 ? "Lunar Lobster" : "Groovy Gorilla"} wins.` : localPlaying ? `${localSide} to move${localBoard?.forced ? " — keep jumping" : localBoard && hasCapture(localBoard, localBoard.turn) ? " — capture required" : ""}.` : localBoard?.turn === 1 ? "Move Black to play locally." : "Make your opening move.";
  const turnClass = game?.you != null && game.status === "playing" ? (game.turn === game.you ? "your-turn" : "opponent-turn") : "";
  const waitingForOpponent = lobby && !gameId && !offer && !localPlaying;

  const signInUrl = `/signin?callbackUrl=${encodeURIComponent(gameId ? `/games/${gameId}` : "/")}`;

  const invitationActions = serverConnected && <div className="lobby-actions">
    <button disabled={matchBusy} onClick={() => void joinTable("human")}>{matchBusy ? "Joining…" : "Accept"}</button>
    <button disabled={matchBusy} onClick={() => inviteSomeoneElse("invite")}>{offer ? "Start a new game" : "Invite someone else"}</button>
    {enableComputer && <button disabled={matchBusy} onClick={() => inviteSomeoneElse("computer")}>Play against computer instead</button>}
  </div>;

  const identityActions = <>
    {anonymous && anonymousName && <button type="button" onClick={() => { setDraftName(anonymousName); setNameError(""); setEditingName(true); }}>Change name</button>}
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

  const quitAction = (localStarted || (game?.you != null && game.status === "playing")) && <button onClick={() => void quit()}>Quit game</button>;

  if (enableDemo && demo) return <Demo ruleset={ruleset} signInUrl={showSignIn ? signInUrl : undefined} onExit={() => setDemo(false)} />;

  return <main className={turnClass}>
    <GameHeader game={scoreGame} local={!!localBoard} playerAvatar={playerAvatar} signInUrl={showSignIn ? signInUrl : undefined}>
      {!localBoard && !watching && (!gameId || game?.you != null) && identityActions}
      {serverConnected && game?.you != null && !game.waiting && allowSpectators && <button aria-live="polite" onClick={() => void share()}>{shareMessage?.copied ? "Link copied" : "Share game"}</button>}
    </GameHeader>

    <section className="game-shell">
      <div className="table-wrap">
        {displayed
          ? <Board game={displayed} player={localBoard || waitingLocal ? displayed.turn : displayed.you ?? 1} viewPlayer={localBoard || waitingLocal ? 0 : undefined} offering={!!offer} autoOrbit={!offer && displayed.you === null} onMove={localBoard ? localMove : waitingLocal ? waitingLocalMove : waitingForOpponent ? proposed => void openTable(proposed, openingChoice === "local" ? "find" : openingChoice) : move} disabled={localBoard ? matchBusy || displayed.status === "finished" : !serverConnected || displayed.you === null || moving || (!!displayed.waiting && !waitingLocal) || matchBusy || !!optimistic || (anonymous && !anonymousName)} />
            : gameId
              ? <WaitingTable />
              : <EndedTable message={message} onRestart={() => participate()} />}
      </div>
    </section>

    {game && <div className="status-card bottom-status">
      <p aria-live="polite">{matchError || (!shareMessage?.copied && shareMessage?.text) || (waitingLocal ? "Waiting for an opponent." : message)}</p>
      <div className="lobby-actions">
      {game.waiting && game.you === null && invitationActions}
      {serverConnected && game.waiting && game.you === 0 && <>
        <button aria-live="polite" onClick={() => void share()}>{shareMessage?.copied ? "Link copied" : "Invite"}</button>
        {enableMatchmaking && game.matchmaking && <button disabled={matchBusy} onClick={() => void quit("invite")}>Start new game</button>}
        {enableComputer && <button disabled={matchBusy} onClick={() => void joinTable("computer")}>{matchBusy ? "Joining…" : "Play against computer instead"}</button>}
      </>}
      {game.status === "finished" && !watching && <button onClick={() => participate()}>Play again</button>}
      {quitAction}
      </div>
    </div>}

    {offer && <div className="status-card bottom-status">
      <p aria-live="polite">{matchError || `${offer.players[0].name} wants to play with you. Do you accept?`}</p>
      <div className="lobby-actions">{invitationActions}{quitAction}</div>
    </div>}

    {waitingForOpponent && <div className="status-card bottom-status">
      <p aria-live="polite">{matchError || (localBoard ? localMessage : matchBusy ? "Taking your seat…" : openingChoice === "computer" ? "Make your opening move to play against the computer." : !enableMatchmaking || openingChoice === "invite" ? "Make your opening move, then share the game link to invite someone." : "Looking for a waiting opponent. Make an opening move to start your own game.")}</p>
      <div className="lobby-actions">
        {rulesConfig.allowSelection && (!localBoard || localBoard.revision === 1) && <button type="button" disabled={matchBusy} onClick={() => { const next = ruleset === "english" ? "international" : "english"; setRuleset(next); if (enableLocalPlay) opening.reset(next); }}>
          Switch to {ruleset === "english" ? "international" : "English"} rules
        </button>}
        {enableDemo && !localStarted && !hasMoved && <button disabled={matchBusy} onClick={() => setDemo(true)}>Watch demo</button>}
        {serverConnected && (enableLocalPlay || openingChoice !== "invite") && <button disabled={matchBusy} onClick={() => participate("invite")}>Invite someone</button>}
        {serverConnected && enableMatchmaking && <button disabled={matchBusy} onClick={() => openingChoice === "find" ? participate("invite", true) : participate("find")}>{openingChoice === "find" ? "Start new game" : "Find opponent"}</button>}
        {serverConnected && enableComputer && localBoard?.turn === 1 && <button disabled={matchBusy} onClick={() => participate("computer")}>Play against computer</button>}
        {quitAction}
      </div>
    </div>}

    {localPlaying && <div className="status-card bottom-status"><p aria-live="polite">{matchError || localMessage}</p><div className="lobby-actions">{quitAction}{localBoard?.status === "finished" && <button onClick={() => { opening.reset(ruleset); participate("local"); }}>Play again</button>}</div></div>}
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
