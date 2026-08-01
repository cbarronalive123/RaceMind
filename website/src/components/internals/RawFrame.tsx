"use client";

import { useState } from "react";
import { TelemetryFrame } from "@/lib/frame";

/**
 * The frame under the cursor, as it exists on disk.
 *
 * The chart is an interpretation; this is the data. Keeping it one click away
 * is what makes the view honest about what it is drawing.
 */
export function RawFrame({ frame }: { frame: TelemetryFrame | undefined }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="shrink-0 border-t border-pit-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-pit-panel-2"
      >
        <span className="text-[10px] tracking-[0.14em] text-ink-secondary uppercase">
          Raw frame
        </span>
        <span className="text-[10px] text-ink-muted">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open && (
        <pre className="tnum max-h-56 overflow-auto border-t border-pit-border px-3 py-2 text-[11px] leading-relaxed text-ink-secondary">
          {frame ? JSON.stringify(frame, null, 2) : "No frame at the cursor."}
        </pre>
      )}
    </section>
  );
}
