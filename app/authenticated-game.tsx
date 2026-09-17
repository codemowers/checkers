import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../lib/auth";
import { isAnonymousMode } from "../lib/auth-mode";
import GameRoom from "./game-room";

export default async function AuthenticatedGame({ gameId }: { gameId?: string }) {
  const anonymous = isAnonymousMode();
  const session = anonymous ? null : await getServerSession(authOptions);
  if (!anonymous && !session) {
    const callbackUrl = gameId ? `/games/${gameId}` : "/";
    redirect(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }
  const claims = (session as any)?.claims;
  return <GameRoom
    initialGameId={gameId}
    playerName={anonymous ? undefined : claims?.name ?? session?.user?.name ?? "Player"}
    anonymous={anonymous}
    selfPlayEnabled={anonymous || process.env.ALLOW_SELF_PLAY === "true"}
  />;
}
