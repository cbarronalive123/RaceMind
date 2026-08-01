"use client";

import { CentreColumn } from "@/components/dashboard/CentreColumn";
import { EngineerPanel } from "@/components/dashboard/EngineerPanel";
import { HistoryDrawer } from "@/components/dashboard/HistoryDrawer";
import { LeftColumn } from "@/components/dashboard/LeftColumn";
import { TimingTower } from "@/components/dashboard/TimingTower";
import { TopBar } from "@/components/dashboard/TopBar";
import { RaceGate } from "@/components/RaceGate";

/**
 * View 4 — Live Race Dashboard (docs/website-dashboard.md).
 * Three permanent columns: track & car, telemetry & strategy, engineer panel.
 * The engineer column never scrolls away from a pending anomaly.
 */
export function LiveDashboard() {
  return (
    <RaceGate>
      {/* Fills what the root layout leaves below the tab bar, rather than
          claiming the whole viewport and pushing itself off the bottom. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar />

        <main className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,30fr)_minmax(0,40fr)_minmax(0,30fr)]">
          <LeftColumn />
          {/* The timing tower is a fixed band at the bottom; the centre column
              gets the rest and lays its panels out to fit, so nothing gets cut
              off at the boundary between them (feedback/round-01 D3). */}
          <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3">
            {/* Relative, so the expanded history drawer overlays the live
                telemetry rather than reflowing it. The left and right columns
                and the timing tower stay visible and live behind it. */}
            <div className="relative flex min-h-0 flex-col gap-2">
              <CentreColumn />
              <HistoryDrawer />
            </div>
            <div className="h-[190px] shrink-0 xl:h-[230px]">
              <TimingTower />
            </div>
          </div>
          <EngineerPanel />
        </main>
      </div>
    </RaceGate>
  );
}
