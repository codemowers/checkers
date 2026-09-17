import type { NextAuthOptions } from "next-auth";
import { createHash } from "node:crypto";

const callbackUrl = `${process.env.NEXTAUTH_URL}/api/auth/callback/passmower`;
const gravatar = (email?: string | null) => email ? `https://www.gravatar.com/avatar/${createHash("md5").update(email.trim().toLowerCase()).digest("hex")}?d=identicon&s=160` : undefined;

// The id_token was already verified by the OAuth flow; this only unpacks it.
// A failure here yields a claimless session, which the API sees as a 401 loop,
// so it must be loud rather than silent.
function claims(idToken: string) {
  try { return JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")); }
  catch (error) {
    console.error("Could not decode the id_token payload:", error);
    return {};
  }
}

export const authOptions: NextAuthOptions = {
  pages: { signIn: "/signin" },
  logger: {
    error(code, metadata: any) {
      const message = metadata?.error?.message ?? metadata?.message ?? "";
      if (code === "OAUTH_CALLBACK_ERROR" && message.includes("State cookie was missing")) return;
      console.error(`[next-auth][error][${code}]`, metadata);
    },
  },
  providers: [{
    id: "passmower",
    name: "Passmower",
    type: "oauth",
    wellKnown: `${(process.env.OIDC_ISSUER ?? "").replace(/\/?$/, "/")}.well-known/openid-configuration`,
    clientId: process.env.OIDC_CLIENT_ID!,
    clientSecret: process.env.OIDC_CLIENT_SECRET!,
    authorization: { params: { scope: "openid profile email", redirect_uri: callbackUrl } },
    idToken: true,
    checks: ["pkce", "state"],
    profile(profile) { return { id: profile.sub, name: profile.name ?? profile.email, email: profile.email, image: gravatar(profile.email) }; },
  }],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, account }) {
      if (account?.id_token) { token.idToken = account.id_token; token.claims = claims(account.id_token); }
      return token;
    },
    async session({ session, token }) {
      (session as any).claims = token.claims;
      if (session.user) session.user.image = gravatar(session.user.email);
      return session;
    },
  },
};
