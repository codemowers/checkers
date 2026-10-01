"use client";

import { signIn } from "next-auth/react";
import { useEffect } from "react";

export default function SignIn({ providerName }: { providerName: string }) {
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("callbackUrl");
    const callbackUrl = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/";
    void signIn("openid", { callbackUrl });
  }, []);
  return <main className="auth-redirect" aria-live="polite">
    <span className="brand-mark">◆</span>
    <p>Taking you to {providerName}…</p>
    <span className="loader" />
  </main>;
}
