# Checkers

WebGL checkers with English (8×8) and International (10×10) rules, computer play, shared games and spectators. Next.js serves the UI, API and OpenID login; Redis/Dragonfly stores games.

```sh
docker compose up --build
docker compose --profile test run --build --rm test
```

Open <http://localhost:3001>. Compose uses anonymous play and disposable Dragonfly state. The test service runs TypeScript, runtime and game tests against Dragonfly.

## Playing and controls

The lobby starts with English (8×8) rules by default. `RULES=english-default` or `international-default` selects the initial rules and allows switching before your opening move. `RULES=english` or `international` locks new games and lobby matchmaking to that ruleset and hides the switch. Demos use the lobby's selected rules; existing game links retain that game's rules.

With `ENABLE_MATCHMAKING=true`, the lobby immediately subscribes to waiting opponents using SSE—no opening move is needed to receive an offer. Openings, accepted seats, renames and departures are pushed through Redis notifications. Keepalive comments hold the connection open; the browser reconnects only if the stream closes.

If another player is waiting, the table begins a slow turn toward Black and asks **“Lauri Võsandi wants to play with you. Do you accept?”**, using that player's name. **Accept** claims Black and swiftly completes the 180° turn; the host's opening stays intact. The seat is not reserved until you accept. **Start a new game** turns back to a fresh Red opening and stops matchmaking offers for that private table. **Play against computer instead** also starts from your own opening when enabled. If nobody is waiting, you can play an opening to create a table as Red while the lobby listens for offers.

The wood texture preloads before the board appears, with **Setting the table…** shown while it loads. If the asset cannot be loaded, plain colours keep the game playable. The green felt extends beyond the visible scene, with no table edge in view. A broad warm lamp beam and soft ambient lighting illuminate the board and surrounding felt.

The WebGL canvas remains mounted through lobby, offer, waiting and playing transitions. The board's shadow turns with it, while the camera briefly rises halfway through the turn and returns to your previous tilt. Accepting an offer or starting a new game continues from the current orientation. Reduced-motion preferences skip the turn and camera lift.

With `ENABLE_MATCHMAKING=false`, every opening creates a private table. This flag is independent of authentication: `AUTH_MODE=invite` still requires login to open a table and allows anonymous invitees to join, but no longer controls matchmaking.

- Drag a piece to its destination, or click/tap a piece and then a highlighted square. Captures are mandatory; International rules require the longest capture sequence.
- Right-drag or use a two-finger gesture to adjust the camera angle; use the mouse wheel to zoom. Releasing near overhead snaps to a straight top-down view. Camera gestures pause during the animated seat turn, and piece moves wait until it finishes.
- Press **Spacebar** or **double-click the board** to play the only legal move. This plays one jump at a time during a capture chain and does nothing when several moves are available. Spacebar keeps its normal behavior in inputs, buttons and links. **Double-tap** uses the same shortcut on touch browsers that generate a double-click event.
- While waiting, **Invite** copies the game URL, or **Play against computer instead** fills the other seat when computer play is enabled. During a game, **Share game** copies a spectator link when spectating is enabled. After copying, the button reads **Link copied** for three seconds, then returns to its original label.
- Game links open for watching by default. **Accept** claims an open opponent seat when the host invitation is shown. **Invite someone else** returns to an opening board for a private table. With spectating disabled, an unseated visitor automatically attempts to join; full tables cannot be watched.
- **Quit game** ends the table for both players. After a result, **Play again** returns to the opening board. **Watch demo** runs a local computer-versus-computer game with Pause, Resume and Back to play controls.

Waiting invitations have no expiry. Once a human opponent joins, both players get a three-minute reconnect grace period; a connected player's stream ends the table if the opponent stays absent beyond it. Joined games expire from storage after 24 hours without a move. Computer games are exempt from the opponent reconnect deadline. Anonymous seats use a credential saved in the tab's session storage, so keep the same tab to reconnect.

The [menu flowchart](docs/menu-flow.dot) covers authentication, matchmaking, sharing, spectators, demos and move shortcuts. Render it with `dot -Tsvg docs/menu-flow.dot -o /tmp/checkers-menu.svg`.

## Environment

Read at startup; restart after changing configuration. Feature switches accept `true` or `false`.

| Variable | Default | Usage |
| --- | --- | --- |
| `AUTH_MODE` | Auto | `anon`: anonymous only; `optional`: anonymous or login; `enforced`: login required; `invite`: authenticated hosts, anonymous or authenticated invitees. Auto selects enforced with complete OIDC configuration, otherwise anon. |
| `RULES` | `english-default` | `english` or `international`: fixed rules for new games. `english-default` or `international-default`: start with those rules and allow switching before starting a game. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Unset | All required for authentication modes other than anon. |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | Unset | Public origin and shared session secret for login. |
| `SPECTATOR_MODE` | `invite` | Invite links open as spectators; **Accept** takes the opponent seat. `disabled` joins immediately and disables spectating. |
| `ENABLE_MATCHMAKING` | `true` | Stream waiting opponents immediately on entering the lobby, in every auth mode. `false` creates private invitation tables only. Accept is required to claim an offered seat. |
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

`checkers_open_game_sessions{role="player|spectator",auth="anonymous|authenticated"}` counts open game-event connections on the individual Node.js pod. A player connection is counted after it has a seat; an unseated game-event connection is a spectator. Finished games and computer seats contribute no connections. A reconnect is counted as a new connection after the old stream closes.

The metric is pod-local, so aggregate replicas with `sum by (role, auth) (checkers_open_game_sessions)`. It does not require Redis and reflects the connections held by that Node.js process. Multiple open connections from the same player are counted separately.

Run `bash scripts/smoke-image.sh <image>` to verify the production runtime over HTTP and HTTPS.

The Docker build downloads the CC0 [Wood Table 001 texture by Poly Haven](https://polyhaven.com/a/wood_table_001) and verifies its checksum.

## Deploying

For a cluster deployment, set the [Helm chart](chart/)'s `image` to a published
release such as `ghcr.io/codemowers/checkers:<version>` and configure its `env`
values. [Skaffold](skaffold.yaml) builds and pushes the image and deploys it to
the context and namespace configured in that file.

[CI](.github/workflows/container.yml) runs the tests, health checks, production
smoke test and vulnerability scan, then publishes the verified image to GHCR on
`v*` tag pushes.

Versioned charts are also published to
`oci://ghcr.io/<repository-owner>/charts/checkers`; the packaged chart points
to the matching digest-pinned container image.
