"use client";

import { useMemo, useState } from "react";
import { Channel, groupsForTier, MAX_SERIES, TIERS } from "@/lib/channels";

interface ChannelPickerProps {
  selected: string[];
  onToggle: (id: string) => void;
  colourOf: (id: string) => string | null;
}

export function ChannelPicker({
  selected,
  onToggle,
  colourOf,
}: ChannelPickerProps) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();

  const tiers = useMemo(
    () =>
      TIERS.map((tier) => ({
        ...tier,
        groups: groupsForTier(tier.tier)
          .map((group) => ({
            ...group,
            channels: group.channels.filter(
              (c) =>
                needle === "" ||
                c.label.toLowerCase().includes(needle) ||
                c.id.toLowerCase().includes(needle),
            ),
          }))
          .filter((group) => group.channels.length > 0),
      })).filter((tier) => tier.groups.length > 0),
    [needle],
  );

  const atLimit = selected.length >= MAX_SERIES;

  return (
    // h-full is what makes the list below scroll rather than the page: without
    // a height bound the inner overflow container just grows to fit.
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-pit-border p-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter channels"
          className="w-full rounded border border-pit-border bg-pit-panel-2 px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-muted focus:border-ink-secondary"
        />
        <div className="mt-1.5 flex items-baseline justify-between">
          <span className="text-[10px] text-ink-muted">
            {selected.length} of {MAX_SERIES} plotted
          </span>
          {selected.length > 0 && (
            <button
              onClick={() => selected.forEach(onToggle)}
              className="text-[10px] text-ink-muted transition-colors hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tiers.length === 0 && (
          <p className="px-1 py-4 text-[11px] text-ink-muted">
            No channel matches “{filter}”.
          </p>
        )}

        {tiers.map((tier) => (
          <section key={tier.tier} className="mb-4 last:mb-0">
            <h3 className="text-[10px] tracking-[0.14em] text-ink-secondary uppercase">
              {tier.title}
            </h3>
            <p className="mt-0.5 mb-1.5 text-[10px] leading-snug text-ink-muted">
              {tier.blurb}
            </p>

            {tier.groups.map((group) => (
              <div key={group.group} className="mb-2 last:mb-0">
                <div className="mb-0.5 text-[10px] text-ink-muted">
                  {group.group}
                </div>
                <ul>
                  {group.channels.map((channel) => (
                    <ChannelRow
                      key={channel.id}
                      channel={channel}
                      checked={selected.includes(channel.id)}
                      disabled={atLimit && !selected.includes(channel.id)}
                      colour={colourOf(channel.id)}
                      onToggle={() => onToggle(channel.id)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function ChannelRow({
  channel,
  checked,
  disabled,
  colour,
  onToggle,
}: {
  channel: Channel;
  checked: boolean;
  disabled: boolean;
  colour: string | null;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        onClick={onToggle}
        disabled={disabled}
        title={disabled ? `Deselect a channel first (${MAX_SERIES} max)` : channel.id}
        className={`flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left transition-colors ${
          disabled
            ? "cursor-not-allowed text-ink-muted/60"
            : "text-ink-body hover:bg-pit-panel-2"
        }`}
      >
        <span
          aria-hidden
          className={`mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] border ${
            checked ? "border-transparent" : "border-pit-border"
          }`}
          style={checked && colour ? { backgroundColor: colour } : undefined}
        />
        <span className="flex-1 text-[12px]">{channel.label}</span>
        {channel.unit && (
          <span className="text-[10px] text-ink-muted">{channel.unit}</span>
        )}
      </button>
    </li>
  );
}
