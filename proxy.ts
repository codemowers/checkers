import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { authMode } from "./lib/auth-mode";

/** This app uses route handlers, not Server Actions. Reject action invocations before page rendering. */
export async function proxy(request: NextRequest) {
  if (request.method === "POST" && request.headers.has("next-action")) {
    return NextResponse.json({ error: "Server Actions are not supported." }, { status: 400 });
  }
  const sessionCookies = request.cookies.getAll().filter(({ name }) =>
    /^(?:__Secure-)?next-auth\.session-token(?:\.\d+)?$/.test(name));
  if (sessionCookies.length && authMode() !== "anon") {
    // Match NextAuth's cookie selection, including chunked cookies. Only inspect
    // cookies: this application does not authenticate bearer-token API clients.
    const cookieRequest = new NextRequest(request.url, { headers: { cookie: request.headers.get("cookie") ?? "" } });
    const token = await getToken({ req: cookieRequest });
    if (!token) {
      const signIn = new URL("/signin", request.url);
      signIn.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
      const response = request.nextUrl.pathname.startsWith("/api/game/")
        ? NextResponse.json({ error: "Your session has expired. Please sign in again." }, {
          status: 401, headers: { "X-Checkers-Session-Reset": "1" },
        })
        : NextResponse.redirect(request.nextUrl.pathname === "/signin" ? request.nextUrl : signIn);
      for (const { name } of sessionCookies) {
        response.cookies.set(name, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure: name.startsWith("__Secure-") });
      }
      return response;
    }
  }
  return NextResponse.next();
}

// NextAuth owns its auth routes; game handlers still enforce seat ownership.
export const config = { matcher: ["/", "/signin", "/games/:path*", "/api/game/:path*"] };
