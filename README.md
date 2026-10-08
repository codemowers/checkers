# Checkers

WebGL checkers with English (8×8) and International (10×10) rules, computer play, shared-device play and spectators. Next.js serves the UI, APIs and OpenID login; Redis/Dragonfly stores online games.

## Codemowers Cloud sandbox

Obtain a Codemowers Cloud sandbox at [trial.codemowers.io](https://trial.codemowers.io). Follow the instructions on that site to:

* Install Skaffold.
* Install kubectl.
* Install the OIDC authentication plugin for kubectl.
* Configure your Kubernetes client with the sandbox kubeconfig.
* Set up `skaffold.env` in the project root.

Proceed to build locally using Docker and deploy to sandbox with:

```
skaffold dev
```

Open the URL in the application's startup log: `Checkers available at https://…`. Skaffold streams this log after the application starts.

## Docker Compose

```sh
docker compose up --build
docker compose --profile test run --build --rm test
```

Open <http://localhost:3001>. Compose enables anonymous and local play with disposable Dragonfly state. The test service runs typechecking, runtime checks and game tests against Dragonfly.

## Playing

- **Find an opponent:** the lobby receives offers without an opening move. **Accept** claims Black; an offer does not reserve the seat. On the connected home page with matchmaking enabled, Red's opening creates a public waiting table, including when local play is enabled. **Start new game** opts out of matchmaking; **Find opponent** re-enables it.
- **Invite someone:** creates a private table from Red's opening and copies its URL. Choosing it before the opening creates the table after that move. Private tables stay out of matchmaking. **Invite** retries copying; the address bar also contains the link.
- **Computer:** answers Red's opening when chosen. Online computer games require a server connection.
- **Local play:** enable `ENABLE_LOCAL_PLAY` and open `/local`, or play Black on your waiting table to withdraw it and continue locally. A concurrent seat claim prevents conversion. On `/local`, offline, or with matchmaking disabled, the opening stays in the browser until an online choice is selected. Black's first move commits to local play. Refreshing discards local games.
- **Watch:** game links open as spectators by default; **Accept** takes an open Black seat. With spectating disabled, visitors automatically attempt to join. **Share game** copies a spectator link during play.
- **Finish:** **Quit game** ends an online table for both players or resets local play. **Play again** returns to the opening board. **Watch demo** runs a browser-only computer match with pause, resume and exit controls.

Online choices appear only while the server and Redis connection is live. Game streams retry after interruption while keeping the board visible. Waiting invitations have no expiry. Joined human games allow three minutes to reconnect and expire after 24 hours without a move; computer games have no opponent reconnect deadline. Anonymous seats use a per-tab credential, so reconnect from the same tab.

## Controls

Drag a piece, or select it and tap a highlighted square. Captures are mandatory; International rules require the longest sequence. **Spacebar** or **double-click** plays the only legal move, one jump at a time. Spacebar retains normal behavior in form controls.

Right-drag or use two fingers to tilt the camera; scroll to zoom. Releasing near overhead snaps to top-down. **Fullscreen** hides the header and dialogs, fits the playing grid to the screen and attempts to lock the current orientation. Use the upper-right exit icon to restore controls.

Rules can be switched before the opening when `RULES` allows selection. The canvas stays mounted through lobby, offers and online play. The wood texture loads before reveal, with plain colours as a fallback. Rendering starts with simple effects and adds quality after sustained 50 FPS; unlocked quality persists until refresh. Reduced motion skips seat transitions and effect fades.

The [menu flowchart](docs/menu-flow.dot) documents the choices and conditions. Render it with `dot -Tsvg docs/menu-flow.dot -o /tmp/checkers-menu.svg`.

## Offline play

With local play enabled, a production build over HTTPS or localhost caches `/local`, build assets and the wood texture after an online visit. Offline reloads of `/` or `/local` open that public shell. Account pages, OAuth, online games and APIs stay on the network. Browser storage is required; clearing it removes the cache. Development builds do not prepare an offline cache. Reconnecting to a server with local play disabled removes it.

## Environment

Read at startup; restart after changing configuration. Feature switches accept `true` or `false`.

| Variable | Default | Usage |
| --- | --- | --- |
| `AUTH_MODE` | Auto | `anon`: anonymous only; `optional`: anonymous or login; `enforced`: login required; `invite`: authenticated hosts, anonymous or authenticated invitees. Auto selects enforced with complete OIDC configuration, otherwise anon. |
| `RULES` | `english-default` | `english` or `international`: fixed rules for new games. `english-default` or `international-default`: start with those rules and allow switching before starting a game. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Unset | All required for authentication modes other than anon. |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | Unset | Public origin and shared session secret for login. The startup log uses `NEXTAUTH_URL` as the application URL, falling back to the local listener when unset. |
| `SPECTATOR_MODE` | `invite` | Invite links open as spectators; **Accept** takes the opponent seat. `disabled` joins immediately and disables spectating. |
| `ENABLE_MATCHMAKING` | `true` | Stream waiting opponents immediately on entering the lobby, in every auth mode. `false` creates private invitation tables only. Accept is required to claim an offered seat. |
| `ENABLE_COMPUTER` | `true` | Allow filling the opponent seat with a computer. |
| `ENABLE_DEMO` | `true` | Enable browser-only computer-versus-computer demos. |
| `ENABLE_LOCAL_PLAY` | `false` | Enable shared-device two-player mode at `/local` and the production offline asset cache. No login is needed for local play. |
| `ALLOW_SELF_PLAY` | `false` | Give authenticated users separate seats per tab; anonymous seats always use per-tab identities. |
| `REDIS_URL` | `redis://checkers-redis:6379/0` | Game storage and pub/sub URL. |
| `REDIS_PASSWORD` | Unset | Separate Redis password. |
| `PORT`, `HOSTNAME` | `3000`, `::` | Public listener; Docker sets port `3001`. |
| `METRICS_PORT` | `3002` | Internal HTTP listener: `/metrics`, `/health`, `/ready`. |
| `TLS_CERT_FILE`, `TLS_KEY_FILE` | Unset | Set both PEM paths to enable HTTPS on the public listener; metrics and health always use HTTP. |
| `NODE_EXTRA_CA_CERTS` | Unset | CA bundle for internal TLS. |
| `TEST_REDIS_URL` | Unset | Disposable Redis/Dragonfly URL; enables storage integration tests. |

Compose forwards feature switches, e.g. `SPECTATOR_MODE=disabled docker compose up --build`. Helm config uses `env`, e.g. `--set env.AUTH_MODE=optional`. The chart defaults to `invite`; Skaffold overrides it to `optional`.

All replicas must share `NEXTAUTH_SECRET`. Changing it invalidates sessions; restart all replicas together. Invalid session cookies are cleared on the next page or game request, then login returns the user to that page. Existing streams are checked on reconnect. Preserve the chart's generated `checkers-nextauth` secret to keep sessions valid.

## Deployment and checks

The [Helm chart](chart/) defaults to `image: checkers:latest` and `imageRegistry: ghcr.io/codemowers`. Set a published release and configure `env` for your installation. Fully qualified image paths override the registry prefix; an empty prefix leaves short names unchanged. The public listener defaults to HTTP. Set `https.enabled=true` to mount its certificate and expose HTTPS through Service port 443; Skaffold enables this override. HTTPS also creates a ServersTransport and attaches it to the Service, so Traefik verifies the backend certificate against the Service DNS name. Traefik uses the platform-mounted CA bundle; the platform supplies public ingress TLS.

Network policies are disabled by default (`networkPolicy.enabled: false`). Their selectors target the Codemowers cluster's Traefik, Prometheus, DNS and Dragonfly pods. [Skaffold](skaffold.yaml) enables them, supplies its built image and deploys to namespace `demo` using the current Kubernetes context.

[CI](.github/workflows/container.yml) tests, smoke-tests and scans the image, then publishes it on `v*` tag pushes. Versioned charts at `oci://ghcr.io/<repository-owner>/charts/checkers` reference the matching image digest.

Before committing, verify the current checkout:

```sh
docker compose --profile test run --build --rm test
docker build --pull -t checkers:smoke .
bash scripts/smoke-image.sh checkers:smoke
```

The smoke tests exercise HTTP and HTTPS. Development and production use Webpack so the demo worker starts correctly in Chrome. Docker downloads and checksum-verifies the CC0 [Wood Table 001 texture by Poly Haven](https://polyhaven.com/a/wood_table_001).

## Metrics

`checkers_open_game_sessions{role="player|spectator",auth="anonymous|authenticated"}` counts open game-event connections per pod. Finished games and computer seats are excluded; multiple connections from one player count separately. Aggregate replicas with `sum by (role, auth) (checkers_open_game_sessions)`.
