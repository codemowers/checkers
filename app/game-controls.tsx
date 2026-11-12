"use client";

import { Children, Fragment, cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

function collectButtons(children: ReactNode, prefix = ""): ReactElement<{ children?: ReactNode }>[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    const key = `${prefix}/${child.key}`;
    if (child.type === Fragment || child.type === "div") return collectButtons(child.props.children, key);
    return [cloneElement(child, { key })];
  });
}

export function GameControls({ message, children }: { message: string; children?: ReactNode }) {
  const nav = useRef<HTMLElement>(null);
  const keys = useRef<string[]>([]);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [stacked, setStacked] = useState(true);
  const buttons = collectButtons(children).sort((a, b) => (widths[String(b.key)] ?? 0) - (widths[String(a.key)] ?? 0));
  keys.current = buttons.map(button => String(button.key));
  const measureButtons = useCallback(() => {
    if (!nav.current) return;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return;
    const measured: Record<string, number> = {};
    nav.current.querySelectorAll("button").forEach((button, index) => {
      const style = getComputedStyle(button);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const label = (button.textContent ?? "").trim().replace(/\s+/g, " ");
      const text = style.textTransform === "uppercase" ? label.toUpperCase() : label;
      const width = context.measureText(text).width + Math.max(0, text.length - 1) * (parseFloat(style.letterSpacing) || 0)
        + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      measured[keys.current[index]] = width;
    });
    setWidths(previous => Object.keys(previous).length === Object.keys(measured).length
      && Object.keys(measured).every(key => previous[key] === measured[key]) ? previous : measured);
    const buttonWidths = Object.values(measured);
    const gap = parseFloat(getComputedStyle(nav.current).columnGap) || 0;
    const rowWidth = buttonWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, buttonWidths.length - 1) * gap;
    setStacked(rowWidth > nav.current.getBoundingClientRect().width);
  }, []);
  useLayoutEffect(measureButtons);
  useEffect(() => {
    const resize = new ResizeObserver(measureButtons);
    if (nav.current) resize.observe(nav.current);
    window.addEventListener("resize", measureButtons);
    document.fonts.addEventListener("loadingdone", measureButtons);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", measureButtons);
      document.fonts.removeEventListener("loadingdone", measureButtons);
    };
  }, [measureButtons]);
  return <>
    <p className="game-status" aria-live="polite">{message}</p>
    <nav ref={nav} className="game-choices lobby-actions" data-stacked={stacked} aria-label="Game choices">{buttons}</nav>
  </>;
}
