"use client";

import { Hud } from "@/components/hud/Hud";
import { RaceGate } from "@/components/RaceGate";

export function HudScreen() {
  return (
    <RaceGate>
      <Hud />
    </RaceGate>
  );
}
