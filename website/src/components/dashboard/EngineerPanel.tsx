"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { StatusDot } from "@/components/ui/Readouts";
import { severityLevel } from "@/lib/format";
import { useRaceStore, useSnapshot } from "@/lib/store";
import { Alert } from "@/lib/types";

/** Beyond this, the queue is summarised so the rules below stay reachable. */
const MAX_VISIBLE_PENDING = 2;

/** Right-hand column. Sticky by construction — it never scrolls away. */
export function EngineerPanel() {
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
      <PendingApprovals />
      <RulesPanel />
      <PatternsPanel />
      <AlertHistory />
    </div>
  );
}

function PendingApprovals() {
  const alerts = useSnapshot((f) => f.alerts);
  const pending = useMemo(
    () => alerts.filter((a) => a.tier === "2c" && a.status === "pending"),
    [alerts],
  );

  return (
    <Panel
      title="Pending approval (2c)"
      className="shrink-0"
      action={
        <span className="tnum text-[11px] text-ink">
          {pending.length ? `${pending.length} waiting` : "clear"}
        </span>
      }
    >
      {pending.length === 0 ? (
        <p className="text-[12px] text-ink-muted">
          No anomalies awaiting a decision. TimesFM is checking every 10 seconds.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Oldest first — the queue is a work list, not a news feed. */}
          {pending
            .slice()
            .reverse()
            .slice(0, MAX_VISIBLE_PENDING)
            .map((a) => (
              <AnomalyCard key={a.id} alert={a} />
            ))}
          {pending.length > MAX_VISIBLE_PENDING && (
            <p className="text-[11px] text-ink-secondary">
              {pending.length - MAX_VISIBLE_PENDING} more queued behind these.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

function AnomalyCard({ alert }: { alert: Alert }) {
  const approveAlert = useRaceStore((s) => s.approveAlert);
  const dismissAlert = useRaceStore((s) => s.dismissAlert);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(alert.recommendation ?? alert.message);
  const level = severityLevel(alert.severity);

  return (
    <article className="pending-pulse rounded border border-status-crit bg-pit-panel-2 p-2.5">
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <StatusDot level={level} />
          <span className="text-[11px] tracking-[0.12em] text-ink uppercase">
            {alert.severity}
          </span>
        </span>
        <span className="tnum text-[11px] text-ink-secondary">
          Lap {alert.lap} · {alert.sigma?.toFixed(1)}σ
        </span>
      </header>

      <h3 className="mt-1.5 text-[13px] text-ink">{alert.title}</h3>

      <ul className="mt-1.5 space-y-0.5">
        {alert.channels?.map((c) => (
          <li key={c.name} className="tnum flex justify-between text-[11px] text-ink-secondary">
            <span>{c.name}</span>
            <span className="text-ink">+{c.sigma.toFixed(1)}σ</span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[12px] leading-snug text-ink-body">{alert.message}</p>

      <div className="mt-2 border-t border-pit-border pt-2">
        <div className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">
          To driver
        </div>
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="mt-1 w-full resize-none rounded border border-pit-border bg-pit-black p-1.5 text-[12px] text-ink outline-none focus:border-ink"
          />
        ) : (
          <p className="mt-1 text-[12px] leading-snug text-ink-body">{draft}</p>
        )}
      </div>

      <div className="mt-2 flex gap-1.5">
        <button
          onClick={() => approveAlert(alert.id, draft)}
          className="flex-1 rounded border border-ink px-2 py-1.5 text-[11px] tracking-[0.1em] text-ink uppercase hover:bg-[#1c1c1c]"
        >
          Approve
        </button>
        <button
          onClick={() => setEditing((v) => !v)}
          className="flex-1 rounded border border-pit-border px-2 py-1.5 text-[11px] tracking-[0.1em] text-ink-secondary uppercase hover:text-ink"
        >
          {editing ? "Done" : "Modify"}
        </button>
        <button
          onClick={() => dismissAlert(alert.id)}
          className="flex-1 rounded border border-pit-border px-2 py-1.5 text-[11px] tracking-[0.1em] text-ink-secondary uppercase hover:text-ink"
        >
          Dismiss
        </button>
      </div>
    </article>
  );
}

/**
 * Rule and pattern config is local state for this draft. It moves to the
 * `alert_rules` / `signal_patterns` tables once the backend exists.
 */
const DEFAULT_RULES = [
  { id: "brake-check", label: "Brake temp check", detail: "every 5 laps", severity: "Low", on: true },
  { id: "tyre-cliff", label: "Tyre cliff warning", detail: "wear > 55%", severity: "High", on: true },
  { id: "fuel-crit", label: "Fuel critical", detail: "< 3 laps fuel", severity: "High", on: true },
  { id: "ers-low", label: "ERS depleted", detail: "SOC < 10%", severity: "Medium", on: true },
  { id: "coolant", label: "Coolant overheat", detail: "> 120°C", severity: "High", on: true },
  { id: "stint", label: "Stint lap report", detail: "every 3 laps", severity: "Low", on: false },
];

const DEFAULT_PATTERNS = [
  { id: "oil-drift", label: "Oil temp drift", detail: "window 5 laps · slope 0.02", on: true },
  { id: "tyre-asym", label: "Tyre asymmetry", detail: "delta > 15°C", on: true },
  { id: "ers-harvest", label: "ERS harvest decline", detail: "min 5.0 MJ", on: true },
  { id: "fuel-over", label: "Fuel overconsumption", detail: null, on: true },
];

function RulesPanel() {
  const [rules, setRules] = useState(DEFAULT_RULES);
  return (
    <Panel
      title="Preventative rules (2a)"
      className="shrink-0"
      action={
        <button className="text-[11px] text-ink-secondary hover:text-ink">+ Add</button>
      }
    >
      <ul className="space-y-1">
        {rules.map((r) => (
          <li key={r.id}>
            <label className="flex cursor-pointer items-center gap-2 py-0.5">
              <input
                type="checkbox"
                checked={r.on}
                onChange={() =>
                  setRules((prev) =>
                    prev.map((x) => (x.id === r.id ? { ...x, on: !x.on } : x)),
                  )
                }
                className="size-3 accent-white"
              />
              <span
                className={`flex-1 text-[12px] ${r.on ? "text-ink-body" : "text-ink-muted"}`}
              >
                {r.label}
              </span>
              <span className="text-[10px] text-ink-muted">{r.detail}</span>
              <span className="w-12 text-right text-[10px] text-ink-secondary">
                {r.severity}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PatternsPanel() {
  const [patterns, setPatterns] = useState(DEFAULT_PATTERNS);
  // The fuel target is sized per circuit now, so it cannot be a literal here
  // without going stale the moment the track changes (feedback D1/D4).
  const fuelTarget = useSnapshot((f) => f.fuel.targetPerLapKg);
  const detailFor = (id: string, detail: string | null) =>
    id === "fuel-over" ? `target ${fuelTarget.toFixed(2)} kg/lap` : detail;
  return (
    <Panel title="Signal patterns (2b)" className="shrink-0">
      <ul className="space-y-1">
        {patterns.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-2 py-0.5">
              <input
                type="checkbox"
                checked={p.on}
                onChange={() =>
                  setPatterns((prev) =>
                    prev.map((x) => (x.id === p.id ? { ...x, on: !x.on } : x)),
                  )
                }
                className="size-3 accent-white"
              />
              <span
                className={`flex-1 text-[12px] ${p.on ? "text-ink-body" : "text-ink-muted"}`}
              >
                {p.label}
              </span>
              <span className="text-[10px] text-ink-muted">
                {detailFor(p.id, p.detail)}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const STATUS_LABEL = {
  pending: "PENDING",
  sent: "SENT → HUD",
  dismissed: "DISMISSED",
} as const;

function AlertHistory() {
  const alerts = useSnapshot((f) => f.alerts);
  return (
    <Panel title="Alert history" className="min-h-[180px] flex-1" bodyClassName="overflow-y-auto">
      {alerts.length === 0 ? (
        <p className="text-[12px] text-ink-muted">No alerts yet this race.</p>
      ) : (
        <ul className="space-y-1">
          {alerts.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 border-b border-pit-border/60 py-1 last:border-0"
            >
              <span className="tnum w-9 text-[11px] text-ink-muted">L{a.lap}</span>
              <span className="w-6 text-[11px] text-ink-secondary">{a.tier}</span>
              <span className="flex-1 truncate text-[12px] text-ink-body">{a.title}</span>
              <span className="flex items-center gap-1.5">
                <StatusDot
                  level={
                    a.status === "sent" ? "ok" : a.status === "pending" ? "warn" : "crit"
                  }
                />
                <span className="w-20 text-right text-[10px] text-ink-secondary">
                  {STATUS_LABEL[a.status]}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
