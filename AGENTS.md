This is a demo project; do not add migrations or keep backwards compatibility.

Authentication uses the existing Next.js backend-for-frontend design with
OpenID Connect Authorization Code + PKCE. The browser calls same-origin game
APIs using the NextAuth session cookie; OAuth client secrets and tokens stay
server-side. There are no independent bearer-token API clients or custom API
scopes. The backend enforces game-seat ownership for every mutation.

Anonymous seats use a per-tab random UUID bearer credential in sessionStorage,
sent as X-Player-Instance. Names are display data, not credentials. Authenticated
seats use the verified OpenID subject. Public game data must never expose
seat identifiers or OAuth tokens.
There is no object-storage or signed-transfer boundary in this application.

Keep game-code work out of chart/ unless the user explicitly requests chart
changes. Preserve unrelated work already present in the checkout.

Lobby offers arrive over SSE without a guest opening move; Accept claims
Black. An offer does not reserve
a seat. Private invitation tables must stay out of automatic matchmaking.
Keep game mutations and their Redis publications atomic, and use revisions to
prevent stale HTTP or SSE snapshots from replacing newer state. Send public
snapshots through toPublicGame, including lobby offers.

Keep the WebGL canvas mounted through lobby, offer, waiting and playing
transitions. Load the wood texture before revealing the board, with a playable
fallback if loading fails. Board shadows must follow seat rotation; camera
transitions should continue from their current position and respect reduced
motion. The felt extends beyond the visible scene and has no rim.

Keep environment-variable documentation in README.md.
Update README.md and docs/menu-flow.dot when controls or game flows change.
Keep diagram branches explicit about conditions, user choices and outcomes.
Validate DOT changes with:
  dot -Tsvg docs/menu-flow.dot -o /tmp/checkers-menu.svg

For code changes, run appropriate checks: npm run typecheck, npm test, and
npm run build for production UI/build changes. Use a disposable Redis/Dragonfly
instance for storage integration tests; see README.md for configuration.
The complete Compose test workflow is:
  docker compose --profile test run --build --rm test
It runs typechecking, runtime checks and game tests against Dragonfly.
Before committing, build the production image and run its HTTP and HTTPS
smoke tests against the current checkout:
  docker build -t checkers:smoke .
  bash scripts/smoke-image.sh checkers:smoke
Fix any smoke-test failures before committing. Report skipped checks and
distinguish build success from actual browser verification of visual changes.

Before working with a deployed cluster, follow the MCP setup guide at
https://mcp.codemowers.io/ to connect the Codemowers service for general
Kubernetes advisory. Configure the target cluster's `driftmower-mcp` server as
well; it provides that cluster's discovery, metrics, logs, and drift
information. Verify both connections before cluster work.
