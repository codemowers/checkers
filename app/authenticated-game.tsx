import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../lib/auth";
import { authMode } from "../lib/auth-mode";
import { computerEnabled, demoEnabled, matchmakingEnabled, localPlayEnabled, spectatorMode } from "../lib/features";
import GameRoom from "./game-room";
import { rulesConfig } from "../lib/rules-config";

export default async function AuthenticatedGame({ gameId }: { gameId?: string }) {
  const mode = authMode();
  const session = mode === "anon" ? null : await getServerSession(authOptions);
  const claims = (session as any)?.claims;
  const anonymous = !claims?.sub;
  if ((!gameId && (mode === "enforced" || mode === "invite")) && anonymous) {
    const callbackUrl = gameId ? `/games/${gameId}` : "/";
    redirect(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }
  return <GameRoom
    rulesConfig={rulesConfig()}
    initialGameId={gameId}
    allowSpectators={spectatorMode() === "invite"}
    playerName={anonymous ? undefined : claims?.name ?? session?.user?.name ?? "Player"}
    playerAvatar={anonymous ? undefined : session?.user?.image}
    anonymous={anonymous}
    allowSignIn={mode !== "anon" && anonymous}
    enableMatchmaking={matchmakingEnabled()}
    enableComputer={computerEnabled()}
    enableDemo={demoEnabled()}
    enableLocalPlay={localPlayEnabled()}
  />;
}
