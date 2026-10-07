import { notFound } from "next/navigation";
import { localPlayEnabled, matchmakingEnabled, computerEnabled, demoEnabled, spectatorMode } from "../../lib/features";
import { rulesConfig } from "../../lib/rules-config";
import { authMode } from "../../lib/auth-mode";
import GameRoom from "../game-room";

export const dynamic = "force-dynamic";

/** This shell is public and contains no account or server-game state. */
export default function Page() {
  if (!localPlayEnabled()) notFound();
  return <GameRoom localShell anonymous allowSignIn={authMode() !== "anon"} enableLocalPlay enableComputer={computerEnabled()} enableDemo={demoEnabled()} allowSpectators={spectatorMode() !== "disabled"} rulesConfig={rulesConfig()} enableMatchmaking={matchmakingEnabled()} />;
}
