"use client";

import { Panel } from "@/components/ui/Panel";
import { StatusDot } from "@/components/ui/Readouts";
import { lapTime, sectorTime, signed } from "@/lib/format";
import { useSnapshot } from "@/lib/store";

export function TimingTower() {
  const laps = useSnapshot((f) => f.laps);
  const current = useSnapshot((f) => f.lapTimeS);
  const lap = useSnapshot((f) => f.lap);
  const target = useSnapshot((f) => f.strategy.targetLapTimeS);
  const best = laps.length ? Math.min(...laps.map((l) => l.total)) : 0;

  return (
    <Panel
      title="Timing"
      className="h-full"
      bodyClassName="overflow-y-auto"
      action={
        <span className="tnum flex gap-4 text-[11px] text-ink-secondary">
          <span>
            Current <span className="text-ink">{lapTime(current)}</span>
          </span>
          <span>
            Best <span className="text-ink">{best ? lapTime(best) : "--:--.---"}</span>
          </span>
          <span>
            Target <span className="text-ink">{lapTime(target)}</span>
          </span>
        </span>
      }
    >
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-[10px] tracking-[0.1em] text-ink-muted uppercase">
            <Th>Lap</Th>
            <Th>S1</Th>
            <Th>S2</Th>
            <Th>S3</Th>
            <Th>Total</Th>
            <Th>Δ Target</Th>
            <Th className="hidden xl:table-cell">Fuel</Th>
            <Th className="hidden xl:table-cell">Wear</Th>
            <Th className="hidden xl:table-cell">Alert</Th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-pit-border text-[12px]">
            <Td className="text-ink">{lap}</Td>
            <Td colSpan={3} className="text-ink-muted">
              in progress
            </Td>
            <Td className="text-ink">{lapTime(current)}</Td>
            <Td className="text-ink-muted">—</Td>
            <Td className="hidden text-ink-muted xl:table-cell">—</Td>
            <Td className="hidden text-ink-muted xl:table-cell">—</Td>
            <Td className="hidden text-ink-muted xl:table-cell">—</Td>
          </tr>
          {laps.map((l) => {
            const delta = l.total - target;
            return (
              <tr key={l.lap} className="border-t border-pit-border/60 text-[12px]">
                <Td className="text-ink-secondary">{l.lap}</Td>
                <Td>{sectorTime(l.s1)}</Td>
                <Td>{sectorTime(l.s2)}</Td>
                <Td>{sectorTime(l.s3)}</Td>
                <Td className="text-ink">{lapTime(l.total)}</Td>
                <Td>
                  {/* Status is carried by the dot, never by the text colour. */}
                  <span className="flex items-center gap-1.5">
                    <StatusDot level={delta <= 0 ? "ok" : "warn"} />
                    {signed(delta, 3)}
                  </span>
                </Td>
                <Td className="hidden xl:table-cell">{l.fuelKg.toFixed(2)}</Td>
                <Td className="hidden xl:table-cell">{l.wearPct.toFixed(1)}%</Td>
                <Td className="hidden text-ink-secondary xl:table-cell">
                  {l.alertTier ?? ""}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {laps.length === 0 && (
        <p className="mt-3 text-[12px] text-ink-muted">
          Lap history appears once the car crosses the line.
        </p>
      )}
    </Panel>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={`px-2 py-1 font-medium ${className}`}>{children}</th>;
}

function Td({
  children,
  className = "",
  colSpan,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`tnum px-2 py-1 text-ink-body ${className}`}>
      {children}
    </td>
  );
}
