import { ReactNode } from "react";

/**
 * Shell for the behind-the-scenes views.
 *
 * Navigation lives in the global tab bar now, so this owns only the section's
 * layout contract: fill what the root layout hands down and never scroll as a
 * whole, leaving the panels inside to scroll on their own.
 */
export default function InternalsLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {children}
    </main>
  );
}
