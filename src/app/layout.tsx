import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "E.D.I.T.H.",
  description:
    "A self-hosted command deck for your own agent. Voice, tools, memory and cron, on your model and your machine.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // data-state is set by the deck on every state change and drives the hue of
  // the entire interface from one place.
  return (
    <html lang="en" data-state="idle">
      <body>{children}</body>
    </html>
  );
}
