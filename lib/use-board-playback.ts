"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { playbackFrames, type BoardFrame } from "./board-playback";
import type { PublicGame } from "./types";

/** Play every authoritative move in order; acknowledgements never replay a predicted move. */
export function useBoardPlayback(target: PublicGame, calm: boolean) {
  const [frame, setFrame] = useState<BoardFrame>({ game: target, captured: [] });
  const latest = useRef(target);
  const queue = useRef<BoardFrame[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const advance = useCallback(() => {
    const next = queue.current.shift();
    if (!next) { timer.current = undefined; setFrame((last) => ({ game: last.game, captured: [] })); return; }
    setFrame(next);
    const duration = next.captured.length ? 900 : next.promoted ? 750 : next.move ? 450 : 0;
    timer.current = setTimeout(advance, calm ? Math.min(duration, 80) : duration);
  }, [calm]);
  useLayoutEffect(() => {
    const before = latest.current;
    if (before === target) return;
    latest.current = target;
    if (before.id !== target.id) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = undefined; queue.current = [];
      setFrame({ game: target, captured: [] });
      return;
    }
    queue.current.push(...playbackFrames(before, target));
    if (!timer.current) advance();
  }, [target, advance]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { frame, animating: !!frame.move || queue.current.length > 0 };
}
