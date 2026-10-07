"use client";

import { useEffect, useState } from "react";
import { fetchResponse, NetworkError, readJson } from "../lib/http-client";

/** The cached public shell checks account state over the uncached session API. */
export function useSignInVisibility(allowed: boolean, publicShell: boolean) {
  const [visible, setVisible] = useState(allowed);
  useEffect(() => {
    setVisible(allowed);
    if (!allowed || !publicShell) return;
    const aborter = new AbortController();
    void (async () => {
      try {
        const response = await fetchResponse("/api/auth/session", { signal: aborter.signal, cache: "no-store" });
        if (!response.ok) return;
        const session = await readJson<{ user?: unknown }>(response);
        if (!aborter.signal.aborted) setVisible(!session.user);
      } catch (error) {
        if (aborter.signal.aborted || error instanceof NetworkError) return;
        throw error;
      }
    })();
    return () => aborter.abort();
  }, [allowed, publicShell]);
  return visible;
}

export function SignInButton({ href }: { href: string }) {
  return <button type="button" onClick={() => { location.href = href; }}>Log in</button>;
}
