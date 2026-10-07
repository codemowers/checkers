import type { Metadata } from "next";
import "./styles.css";
import { localPlayEnabled } from "../lib/features";
import { OfflineSupport } from "./offline-support";

export const metadata: Metadata = {
  title: "Codemowers Checkers",
  description: "A beautifully simple two-player checkers table.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><head><link rel="preload" as="image" href="/textures/wood-table-001.jpg" /></head><body><OfflineSupport enabled={localPlayEnabled()}>{children}</OfflineSupport></body></html>;
}
