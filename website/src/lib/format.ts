import { Compound, Severity } from "./types";

/** 85.512 -> "1:25.512" */
export function lapTime(seconds: number): string {
  if (!seconds || seconds <= 0) return "--:--.---";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

/** Sector split, e.g. "28.421" */
export function sectorTime(seconds: number): string {
  return seconds > 0 ? seconds.toFixed(3) : "--.---";
}

export function signed(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export const COMPOUND_LABEL: Record<Compound, string> = {
  soft: "SOFT",
  medium: "MEDIUM",
  hard: "HARD",
  intermediate: "INTER",
  wet: "WET",
};

export const COMPOUND_COLOR: Record<Compound, string> = {
  soft: "var(--color-data-soft)",
  medium: "var(--color-data-medium)",
  hard: "var(--color-data-hard)",
  intermediate: "#00c853",
  wet: "var(--color-data-ers)",
};

export type StatusLevel = "ok" | "warn" | "crit";

export const STATUS_COLOR: Record<StatusLevel, string> = {
  ok: "var(--color-status-ok)",
  warn: "var(--color-status-warn)",
  crit: "var(--color-status-crit)",
};

export function levelFor(value: number, warn: number, crit: number): StatusLevel {
  if (value >= crit) return "crit";
  if (value >= warn) return "warn";
  return "ok";
}

export function severityLevel(severity: Severity): StatusLevel {
  if (severity === "critical" || severity === "high") return "crit";
  if (severity === "medium") return "warn";
  return "ok";
}
