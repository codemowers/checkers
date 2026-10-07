"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type LockableOrientation = ScreenOrientation & { lock?: (orientation: OrientationType) => Promise<void> };
function unlockRotation() {
  try { screen.orientation?.unlock(); } catch { /* Browser already released the lock. */ }
}

export function FullscreenButton() {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setSupported(!!document.fullscreenEnabled);
    const update = () => {
      setActive(!!document.fullscreenElement);
      setError("");
      if (!document.fullscreenElement) unlockRotation();
    };
    document.addEventListener("fullscreenchange", update);
    update();
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  if (!supported) return null;
  const toggle = async () => {
    setError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        const orientation = screen.orientation as LockableOrientation | undefined;
        const direction = orientation?.type;
        await document.documentElement.requestFullscreen();
        try {
          if (!orientation?.lock || !direction) throw new Error("Unsupported orientation lock");
          await orientation.lock(direction);
          if (!document.fullscreenElement) unlockRotation();
        } catch {
          if (document.fullscreenElement && window.matchMedia("(pointer: coarse)").matches) {
            setError("Fullscreen on; rotation lock unavailable in this browser.");
          }
        }
      }
    } catch {
      setError("Fullscreen unavailable. Try again.");
    }
  };
  const control = <span className={active ? "fullscreen-control fullscreen-exit" : "fullscreen-control"}>
    <button type="button" autoFocus={active} aria-label={active ? "Exit fullscreen" : "Fullscreen"} title={active ? "Exit fullscreen" : "Fullscreen"} aria-pressed={active} onClick={() => void toggle()}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={active ? "M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5" : "M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"} /></svg></button>
    {error && <span className="fullscreen-error" role="alert">{error}</span>}
  </span>;
  return active ? createPortal(control, document.body) : control;
}
