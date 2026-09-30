import { NextRequest, NextResponse } from "next/server";

/** This app uses route handlers, not Server Actions. Reject action invocations before page rendering. */
export function middleware(request: NextRequest) {
  if (request.method === "POST" && request.headers.has("next-action")) {
    return NextResponse.json({ error: "Server Actions are not supported." }, { status: 400 });
  }
  return NextResponse.next();
}

// Authentication and game API requests are handled by their own route handlers.
export const config = { matcher: ["/", "/signin", "/games/:path*"] };
