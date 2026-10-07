"use client";

import type { ReactNode } from "react";
import type { PublicGame } from "../lib/types";
import { FullscreenButton } from "./fullscreen-button";
import { PlayerHeader } from "./player-header";
import { SignInButton } from "./sign-in-button";

export function GameHeader({ game, local = false, playerAvatar, signInUrl, children }: {
  game?: PublicGame;
  local?: boolean;
  playerAvatar?: string | null;
  signInUrl?: string;
  children?: ReactNode;
}) {
  return <header>
    <a className="brand" href="https://github.com/codemowers/checkers" target="_blank" rel="noreferrer" draggable={false} aria-label="Checkers by Codemowers on GitHub">
      <span className="brand-mark">◆</span><span>CHECKERS <small>BY CODEMOWERS</small></span>
    </a>
    {game && <PlayerHeader game={game} local={local} playerAvatar={playerAvatar} />}
    <div className="nav-actions">
      {signInUrl && <SignInButton href={signInUrl} />}
      {children}
      <FullscreenButton />
    </div>
  </header>;
}
