"use client";

import { useEffect, useState } from "react";

/** Online choices require a live server stream, not just navigator.onLine. */
export function useServerConnection() {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let source: EventSource | undefined;
    let lastMessage = 0;
    const close = () => { source?.close(); source = undefined; lastMessage = 0; setConnected(false); };
    const open = () => {
      close();
      if (!navigator.onLine) return;
      source = new EventSource("/api/connection");
      source.onmessage = event => {
        if (JSON.parse(event.data).connected === true) {
          lastMessage = Date.now();
          setConnected(true);
        }
      };
      source.onerror = () => { lastMessage = 0; setConnected(false); };
    };
    const watchdog = setInterval(() => {
      if (lastMessage && Date.now() - lastMessage > 25000) open();
    }, 5000);
    window.addEventListener("offline", close);
    window.addEventListener("online", open);
    open();
    return () => {
      close(); clearInterval(watchdog);
      window.removeEventListener("offline", close);
      window.removeEventListener("online", open);
    };
  }, []);
  return connected;
}
