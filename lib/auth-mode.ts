export function isAnonymousMode() {
  const configured = [process.env.OIDC_ISSUER, process.env.OIDC_CLIENT_ID, process.env.OIDC_CLIENT_SECRET].filter(Boolean).length;
  if (configured > 0 && configured < 3) throw new Error("OIDC configuration is incomplete");
  return configured === 0;
}
