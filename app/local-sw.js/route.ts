import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { localPlayEnabled, matchmakingEnabled, computerEnabled, demoEnabled, spectatorMode } from "../../lib/features";
import { rulesConfig } from "../../lib/rules-config";
import { authMode } from "../../lib/auth-mode";
import { offlineWorkerSource } from "../../lib/offline-worker";

export const dynamic = "force-dynamic";

async function buildAssets(directory: string, prefix: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(entry => entry.isDirectory()
    ? buildAssets(join(directory, entry.name), `${prefix}/${entry.name}`)
    : Promise.resolve(/\.(?:js|css|woff2?|wasm)$/.test(entry.name) ? [`${prefix}/${entry.name}`] : [])));
  return paths.flat();
}

export async function GET() {
  if (!localPlayEnabled()) return new Response("Local play disabled", { status: 404, headers: { "Cache-Control": "no-store" } });
  let buildId: string;
  let assets: string[];
  try {
    buildId = await readFile(join(process.cwd(), ".next/BUILD_ID"), "utf8");
    assets = await buildAssets(join(process.cwd(), ".next/static"), "/_next/static");
  } catch {
    return new Response("Offline caching requires a production build", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const version = createHash("sha256").update(JSON.stringify([buildId, rulesConfig(), matchmakingEnabled(), computerEnabled(), demoEnabled(), spectatorMode(), authMode() !== "anon"])).digest("hex").slice(0, 20);
  return new Response(offlineWorkerSource(`checkers-local-${version}`, ["/local", "/textures/wood-table-001.jpg", "/icon.svg", ...assets]), {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store", "Service-Worker-Allowed": "/" },
  });
}
