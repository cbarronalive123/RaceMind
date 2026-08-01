import Link from "next/link";

const BUILT = [
  {
    href: "/dashboard",
    title: "Pit Wall — Live Race Dashboard",
    detail:
      "View 4. Track map, full telemetry, Gemma strategy, and the engineer control panel with the 2c approval queue.",
  },
  {
    href: "/hud",
    title: "Driver HUD",
    detail:
      "Mobile app Screen 3, rendered in the browser. Speed, delta to target, the active call, and three gauges.",
  },
  {
    href: "/internals/explore",
    title: "Behind the Scenes - Explore Telemetry",
    detail:
      "Every channel the models emit, grouped by tier, charted live or replayed from the recorded races in /data.",
  },
];

const PLANNED = [
  { title: "View 1 — Track Setup", detail: "Google Photorealistic 3D map, click-to-mark key points." },
  { title: "View 2 — Race Configuration", detail: "Vehicle, weather, alert rules, strategy constraints." },
  { title: "View 3 — Pre-Race Report", detail: "Gemma's test-lap analysis and strategy options." },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col justify-center gap-10 overflow-y-auto px-6 py-16">
      <header>
        <h1 className="text-2xl font-semibold tracking-[0.24em] text-ink">RACEMIND</h1>
        <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-secondary">
          A phone in your pocket is the car. Physics models turn its sensors into 55
          channels of F1 telemetry, Gemma reads them, and the engineer decides what
          reaches the driver.
        </p>
        <p className="mt-2 text-[12px] text-ink-muted">
          First draft. Both views run against a client-side simulator — no backend
          required yet.
        </p>
      </header>

      <section>
        <h2 className="text-[11px] tracking-[0.16em] text-ink-muted uppercase">
          Built
        </h2>
        <div className="mt-3 space-y-2">
          {BUILT.map((v) => (
            <Link
              key={v.href}
              href={v.href}
              className="block rounded-md border border-pit-border bg-pit-panel/80 p-4 transition-colors hover:border-ink"
            >
              <div className="text-[15px] text-ink">{v.title}</div>
              <div className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
                {v.detail}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-[11px] tracking-[0.16em] text-ink-muted uppercase">
          Not built yet
        </h2>
        <ul className="mt-3 space-y-2">
          {PLANNED.map((v) => (
            <li
              key={v.title}
              className="rounded-md border border-dashed border-pit-border p-4"
            >
              <div className="text-[14px] text-ink-secondary">{v.title}</div>
              <div className="mt-1 text-[12px] text-ink-muted">{v.detail}</div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
