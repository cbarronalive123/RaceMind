"use client";

import { ReactNode } from "react";

import { useRaceConnection, useRaceStore } from "@/lib/store";
import { StatusDot } from "@/components/ui/Readouts";

/**
 * Opens the connection to the race server and holds back the UI until the
 * first snapshot lands.
 *
 * Mount exactly once per page. Rendering half a race is worse than rendering
 * none: a pit wall showing zeroed gauges reads as a car sitting in the garage
 * rather than as a missing connection.
 *
 * Once connected, a drop leaves the last frame on screen with a banner. The
 * engineer keeps their context, and the stale-data warning is explicit rather
 * than implied by numbers that quietly stopped moving.
 */
export function RaceGate({ children }: { children: ReactNode }) {
  useRaceConnection();

  const connection = useRaceStore((s) => s.connection);
  const hasRace = useRaceStore((s) => s.telemetry !== null);

  if (!hasRace) return <Waiting connecting={connection !== "closed"} />;

  return (
    <>
      {connection !== "open" && <StaleBanner />}
      {children}
    </>
  );
}

function Waiting({ connecting }: { connecting: boolean }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      {/* w-full so the card shrinks at phone width instead of overflowing:
          a flex item will not go below its content width on its own. */}
      <div className="w-full max-w-md rounded-md border border-pit-border bg-pit-panel/80 p-5">
        <div className="flex items-center gap-2">
          <StatusDot level={connecting ? "warn" : "crit"} />
          <h1 className="text-[13px] tracking-[0.16em] text-ink uppercase">
            {connecting ? "Connecting to race server" : "No race server"}
          </h1>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
          The pit wall and the driver HUD both render a race owned by the
          server, so that they show the same one. Nothing simulates in the
          browser.
        </p>
        <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
          Start it with{" "}
          <code className="text-ink-secondary">npm run dev:server</code>, or run
          both at once with{" "}
          <code className="text-ink-secondary">npm run dev:all</code>. Retrying
          automatically.
        </p>
      </div>
    </main>
  );
}

function StaleBanner() {
  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-status-crit bg-[#2a0d0d] px-4 py-1.5"
    >
      <StatusDot level="crit" />
      <span className="text-[12px] text-ink">
        Disconnected from race server — showing the last frame received.
        Reconnecting.
      </span>
    </div>
  );
}
