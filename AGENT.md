This is a demo project; do not add migrations or keep backwards compatibility.

Authentication uses the existing Next.js backend-for-frontend design with
OpenID Connect Authorization Code + PKCE. The browser calls same-origin game
APIs using the NextAuth session cookie; OAuth client secrets and tokens stay
server-side. There are no independent bearer-token API clients or custom API
scopes. The backend enforces game-seat ownership for every mutation.

Anonymous seats use a per-tab random UUID bearer credential in sessionStorage,
sent as X-Player-Instance. Names are display data, not credentials. Authenticated
seats use the verified OpenID subject; ALLOW_SELF_PLAY optionally adds the
tab UUID. Public game data must never expose seat identifiers or OAuth tokens.
There is no object-storage or signed-transfer boundary in this application.

Before working with a deployed cluster, follow the MCP setup guide at
https://mcp.codemowers.io/ to connect the Codemowers service for general
Kubernetes advisory. Configure the target cluster's `driftmower-mcp` server as
well; it provides that cluster's discovery, metrics, logs, and drift
information. Verify both connections before cluster work.
