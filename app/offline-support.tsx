"use client";

import { useEffect } from "react";

export function OfflineSupport({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    void (async () => {
      const existing = await navigator.serviceWorker.getRegistration("/");
      const ours = existing && [existing.active, existing.waiting, existing.installing].some(worker => worker && new URL(worker.scriptURL).pathname === "/local-sw.js");
      if (!enabled) {
        if (ours) await existing.unregister();
        for (const name of await caches.keys()) if (name.startsWith("checkers-local-")) await caches.delete(name);
        return;
      }
      await navigator.serviceWorker.register("/local-sw.js", { scope: "/", updateViaCache: "none" });
    })().catch(() => { /* Offline visits keep the existing cache; play also works without storage. */ });
  }, [enabled]);
  return children;
}
