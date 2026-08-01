import type { Metadata, Viewport } from "next";
import { AppTabs } from "@/components/AppTabs";
import "./globals.css";

export const metadata: Metadata = {
  title: "RaceMind — Pit Wall",
  description:
    "Live F1-style race engineering: telemetry, Gemma strategy, and driver alerts from a phone in your pocket.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      {/* The tab bar is a fixed band and the view below it owns the rest of
          the viewport, so each view can still manage its own scrolling. */}
      <body className="flex h-dvh min-h-0 flex-col antialiased">
        <AppTabs />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
