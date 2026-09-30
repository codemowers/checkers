import NextAuth from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { authMode } from "../../../../lib/auth-mode";

const nextAuth = NextAuth(authOptions);
const handler: typeof nextAuth = (...args: Parameters<typeof nextAuth>) => {
  if (authMode() === "anon") return Response.json({ error: "Sign-in is disabled." }, { status: 404 });
  return nextAuth(...args);
};
export { handler as GET, handler as POST };
