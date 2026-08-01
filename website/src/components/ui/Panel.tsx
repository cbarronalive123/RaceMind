import { ReactNode } from "react";

interface PanelProps {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Panel({
  title,
  action,
  children,
  className = "",
  bodyClassName = "",
}: PanelProps) {
  return (
    <section
      className={`flex min-h-0 flex-col rounded-md border border-pit-border bg-pit-panel/80 ${className}`}
    >
      {title && (
        <header className="flex shrink-0 items-center justify-between border-b border-pit-border px-3 py-2">
          <h2 className="text-[11px] font-medium tracking-[0.14em] text-ink-secondary uppercase">
            {title}
          </h2>
          {action}
        </header>
      )}
      <div className={`min-h-0 flex-1 p-3 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
