import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { isAnonymousMode } from "./auth-mode";
import type { Player } from "./types";

/**
 * Per-tab seat identifier minted by the browser. It is a bearer credential for
 * anonymous seats, so only an unguessable UUIDv4 is accepted — a short or
 * predictable value would let anyone claim someone else's seat.
 */
const INSTANCE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function identity(request: Request): Promise<Player | null> {
  const instance = request.headers.get("x-player-instance") ?? "";
  const hasInstance = INSTANCE.test(instance);

  if (isAnonymousMode()) {
    if (!hasInstance) return null;
    const encodedName = request.headers.get("x-player-name");
    if (!encodedName) return null;
    let name: string;
    try { name = decodeURIComponent(encodedName).trim().replace(/\s+/g, " "); }
    catch { return null; }
    if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) return null;
    return { id: `anon:${instance}`, name };
  }

  const session = await getServerSession(authOptions);
  const claims = (session as any)?.claims;
  if (!claims?.sub) return null;
  const name = claims.name ?? claims.email ?? "Player";
  // Self-play splits one authenticated user across tabs; the suffix is scoped to
  // their own subject, so it grants nothing that the session does not already.
  if (process.env.ALLOW_SELF_PLAY === "true") {
    if (!hasInstance) return null;
    return { id: `${claims.sub}:${instance}`, name };
  }
  return { id: claims.sub, name };
}
