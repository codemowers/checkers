This is a demo project; do not add migrations or keep backwards compatibility.

Authentication uses the existing Next.js backend-for-frontend design with
Passmower OIDC Authorization Code + PKCE. The browser calls same-origin game
APIs using the NextAuth session cookie; OAuth client secrets and tokens stay
server-side. There are no independent bearer-token API clients or custom API
scopes. The backend enforces game-seat ownership for every mutation.

Anonymous seats use a per-tab random UUID bearer credential in sessionStorage,
sent as X-Player-Instance. Names are display data, not credentials. Authenticated
seats use the verified Passmower subject; ALLOW_SELF_PLAY optionally adds the
tab UUID. Public game data must never expose seat identifiers or OAuth tokens.
There is no object-storage or signed-transfer boundary in this application.
