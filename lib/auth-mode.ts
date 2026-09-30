export type AuthMode = "enforced" | "optional" | "invite" | "anon";

export function authMode(): AuthMode {
  const mode = process.env.AUTH_MODE;
  if (mode !== undefined && !["enforced", "optional", "invite", "anon"].includes(mode)) {
    throw new Error("AUTH_MODE must be enforced, optional, invite, or anon");
  }
  if (mode === "anon") return mode;
  const configured = [process.env.OIDC_ISSUER, process.env.OIDC_CLIENT_ID, process.env.OIDC_CLIENT_SECRET].filter(Boolean).length;
  if (configured > 0 && configured < 3) throw new Error("OIDC configuration is incomplete");
  if (mode && configured !== 3) throw new Error(`${mode} authentication requires complete OIDC configuration`);
  return (mode as AuthMode | undefined) ?? (configured === 3 ? "enforced" : "anon");
}
