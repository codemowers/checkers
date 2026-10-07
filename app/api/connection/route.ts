import { connectionEvents } from "../../../lib/connection-events";
import { redis } from "../../../lib/redis";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return connectionEvents(request, () => redis.ping());
}
