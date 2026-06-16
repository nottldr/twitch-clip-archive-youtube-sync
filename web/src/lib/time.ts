import { Temporal } from "@js-temporal/polyfill";
import { useEffect, useState } from "react";

/**
 * Parse a timestamp into a Temporal.Instant, treating naive datetimes (as
 * produced by SQLite's `datetime('now')`) as UTC. Without this, JS Date would
 * interpret naive strings as local time, displaying every server timestamp
 * shifted by the user's offset.
 */
export function parseInstant(iso: string): Temporal.Instant {
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);
  return Temporal.Instant.from(hasTz ? iso : iso.replace(" ", "T") + "Z");
}

export function ageMs(iso: string): number {
  return Temporal.Now.instant().since(parseInstant(iso)).total({ unit: "millisecond" });
}

export function formatTimeAgo(iso: string): string {
  const seconds = Math.floor(ageMs(iso) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatTimeUntil(iso: string): string {
  const ms = parseInstant(iso).since(Temporal.Now.instant()).total({ unit: "millisecond" });
  if (ms <= 0) return "due now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `in ${hours}h ${remainingMinutes}m` : `in ${hours}h`;
}

/** Format an instant in the user's local timezone. Default: `Jun 16, 2026`. */
export function formatDate(
  iso: string,
  opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" },
): string {
  return parseInstant(iso)
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toLocaleString(undefined, opts);
}

/** Default: `Jun 16, 2026, 11:04:38 AM`. */
export function formatDateTime(iso: string): string {
  return formatDate(iso, { dateStyle: "medium", timeStyle: "medium" });
}

/** Default: `11:04:38` (24h). */
export function formatTime(
  iso: string,
  opts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  },
): string {
  return formatDate(iso, opts);
}

/** Returns an ISO timestamp `ms` in the past from now. */
export function instantAgoIso(ms: number): string {
  return Temporal.Now.instant().subtract({ milliseconds: ms }).toString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Re-render the calling component every `intervalMs` so relative timestamps stay fresh. */
export function useTick(intervalMs: number = 1000): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setTick((n) => n + 1);
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [intervalMs]);
}
