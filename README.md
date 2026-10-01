# Checkers

WebGL checkers with English (8×8) and International (10×10) rules, computer play, shared games and spectators. Next.js serves the UI, API and OpenID login; Redis/Dragonfly stores games.

```sh
docker compose up --build
docker compose --profile test run --build --rm test
```

Open <http://localhost:3001>. Compose uses anonymous play and disposable Dragonfly state. The test service runs TypeScript, runtime and game tests against Dragonfly.

## Environment

Read at startup; restart after changing configuration. Feature switches accept `true` or `false`.

| Variable | Default | Usage |
| --- | --- | --- |
| `AUTH_MODE` | Auto | `anon`: anonymous only; `optional`: anonymous or login; `enforced`: login required; `invite`: authenticated hosts, anonymous or authenticated invitees, no automatic matching. Auto selects enforced with complete OIDC configuration, otherwise anon. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Unset | All required for authentication modes other than anon. |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | Unset | Public origin and shared session secret for login. |
| `SPECTATOR_MODE` | `invite` | Invite links open as spectators; **Play against …** takes the opponent seat. `disabled` joins immediately and disables spectating. |
| `ENABLE_COMPUTER` | `true` | Allow filling the opponent seat with a computer. |
| `ENABLE_DEMO` | `true` | Enable browser-only computer-versus-computer demos. |
| `ALLOW_SELF_PLAY` | `false` | Give authenticated users separate seats per tab; anonymous seats always use per-tab identities. |
| `REDIS_URL` | `redis://checkers-redis:6379/0` | Game storage and pub/sub URL. |
| `REDIS_PASSWORD` | Unset | Separate Redis password. |
| `PORT`, `HOSTNAME` | `3000`, `::` | Public listener; Docker sets port `3001`. |
| `METRICS_PORT` | `3002` | Internal HTTP listener: `/metrics`, `/health`, `/ready`. |
| `TLS_CERT_FILE`, `TLS_KEY_FILE` | Unset | Set both PEM paths to enable HTTPS on the public listener; metrics and health always use HTTP. |
| `NODE_EXTRA_CA_CERTS` | Unset | CA bundle for internal TLS. |
| `TEST_REDIS_URL` | Unset | Disposable Redis/Dragonfly URL; enables storage integration tests. |

Compose forwards feature switches, e.g. `SPECTATOR_MODE=disabled docker compose up --build`. Helm config uses `env`, e.g. `--set env.AUTH_MODE=optional`. The chart defaults to `invite`; Skaffold overrides it to `optional`.

## Session gauge

`checkers_open_game_sessions{role="player|spectator",auth="anonymous|authenticated"}` counts occupied human seats. A two-person game contributes two player seats; a waiting host contributes one. Finished games, computers and demos contribute no player seats. Spectators count once per viewer per game, even during reconnects; disconnected leases expire after 45 seconds if cleanup fails.

Every replica reports the same global counts. Aggregate with `max by (role, auth) (checkers_open_game_sessions)`, not a sum. Storage failures fail the scrape instead of reporting zero.

The [menu flowchart](docs/menu-flow.dot) can be rendered with `dot -Tsvg docs/menu-flow.dot -o /tmp/checkers-menu.svg`. Run `bash scripts/smoke-image.sh <image>` to verify the production runtime over HTTP and HTTPS.

The Docker build downloads the CC0 [Wood Table 001 texture by Poly Haven](https://polyhaven.com/a/wood_table_001) and verifies its checksum.
