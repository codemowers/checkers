"use client";

import { Fragment, useEffect, useState } from "react";
import { anonymousIcon } from "../lib/anonymous-names";
import { ROBOT_ICON } from "../lib/computer-names";
import { capturedCounts } from "../lib/piece-counts";
import type { PublicGame } from "../lib/types";

export function PlayerAvatar({ src, name, computer }: { src?: string | null; name?: string; computer?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (computer || name !== undefined) return <span className="anonymous-avatar" aria-hidden="true">{computer ? ROBOT_ICON : anonymousIcon(name!)}</span>;
  if (!src || failed) return <span className="online-dot" />;
  return <img className="player-avatar" src={src} alt="" width={28} height={28} referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export function PlayerHeader({ game, playerAvatar, local = false }: { game: PublicGame; playerAvatar?: string | null; local?: boolean }) {
  const captured = capturedCounts(game);
  const first = local ? 0 : game.you ?? 0;
  const players: PublicGame["players"] = local ? [{ name: "Lunar Lobster", anonymous: true }, { name: "Groovy Gorilla", anonymous: true }] : game.players;
  return <div className="nav-match" aria-label="Pieces captured">
    {[first, 1 - first].map((side, index) => <Fragment key={side}>
      {index === 1 && <em>:</em>}
      <span className={game.turn === side ? "active" : ""}>
        {index === 1 && <strong title="Pieces captured">{captured[side]}</strong>}
        <PlayerAvatar computer={players[side].computer} name={players[side].anonymous ? players[side].name : undefined} src={players[side].avatar || (side === game.you ? playerAvatar : undefined)} />
        <span title={players[side].name || "Open seat"}>
          {players[side].name || "Open seat"}
          <small>{side === 0 ? "RED" : "BLACK"}</small>
        </span>
        {index === 0 && <strong title="Pieces captured">{captured[side]}</strong>}
      </span>
    </Fragment>)}
  </div>;
}
