# Checkers

A tablet-friendly, WebGL checkers table for two automatically matched players. The application is a single Next.js service: React Three Fiber renders the table, Next.js handles the API and authentication through [Passmower](https://github.com/passmower/passmower), and operator-managed Dragonfly stores matchmaking and authoritative game state.

## What it does

- Seats players in arrival order—no rooms or invitation codes.
- Can give every browser tab its own seat when `ALLOW_SELF_PLAY=true`; anonymous mode does this automatically.
- Supports mouse, pen, and touch drag/drop plus tap-to-move.
- Enforces turns, mandatory captures, chained jumps, promotion, and wins on the server. Men move and capture forwards only, crowning ends the turn, and 80 plies without a capture or a man move is a draw.
- Keeps player identifiers server-side. In anonymous mode the per-tab identifier is the seat's only credential, so it is never sent to the opponent.
- Uses atomic Dragonfly scripts for matching and compare-and-set move commits, so multiple web replicas are safe.
- Streams game state over SSE and Redis pub/sub instead of polling during play.
- Puts the game ID in `/games/<UUID>` so refreshing can reconnect to the same table.
- Expires unmatched seats after five seconds and gives disconnected players three minutes to reconnect.
- Provides an explicit quit action that clears both seat assignments immediately.
- Retains inactive game records for at most 24 hours as a final storage bound.

## Local development

```bash
docker compose up --build
```

Open <http://localhost:3001> in two tabs. Because Compose supplies no Passmower configuration, each tab asks for an anonymous name and receives a separate identity. Local Redis state is intentionally ephemeral.

Compose uses the cached development image target and keeps Next.js build output in memory, so it skips the production build and starts quickly after the first dependency install.

Authentication mode is automatic: when the `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` values supplied by Passmower are present, login is required. If they are absent, the anonymous name prompt is used instead.

## Kubernetes

The chart defaults to the public `ghcr.io/codemowers/checkers:latest` image published by the CI workflow, so `helm install checkers chart --set domain=<host>` needs no registry credentials and no image values.

`skaffold dev` builds with the local Docker daemon and pushes to the `zot.ee-lte-1.codemowers.io` registry, overriding the chart's `image` and setting `imagePullSecret: zot-pull-secret`, then installs the same chart. The chart registers the application with [Passmower](https://github.com/passmower/passmower) and creates the NextAuth secret, TLS certificate, two application replicas, and Dragonfly instance. The cluster must provide Dragonfly, Passmower, StringSecret, cert-manager, and Traefik.

Passmower creates the `oidc-client-checkers-owner-secrets` Secret consumed by the application.

## Texture

`public/textures/wood-table-001.jpg` is the 1K diffuse map from [Wood Table 001 by Poly Haven](https://polyhaven.com/a/wood_table_001), released under CC0. It is not checked in: the Docker build downloads it into the image and verifies its SHA-256. Outside Docker, `npm run textures` fetches the same file — and without it the board simply renders in flat colours.
