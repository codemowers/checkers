import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Codemowers Checkers",
  description: "A beautifully simple two-player checkers table.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
