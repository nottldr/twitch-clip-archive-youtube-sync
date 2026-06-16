import { instantAgoIso } from "#web/lib/time.js";

export type TimeRange = "all" | "1h" | "24h" | "7d";

const RANGES: { value: TimeRange; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Today" },
  { value: "7d", label: "7 days" },
];

const RANGE_TO_MS: Record<Exclude<TimeRange, "all">, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

/**
 * Returns the ISO timestamp at the lower bound of the range, or null for "all".
 * Use to populate the `since=` query param on /api/logs.
 */
export function timeRangeToSince(range: TimeRange): string | null {
  if (range === "all") return null;
  return instantAgoIso(RANGE_TO_MS[range]);
}

interface Props {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
}

export function TimeRangeFilter({ value, onChange }: Props) {
  return (
    <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-700">
      {RANGES.map((r, i) => {
        const isOn = r.value === value;
        return (
          <button
            key={r.value}
            type="button"
            onClick={() => {
              onChange(r.value);
            }}
            className={`px-2 py-1 text-xs ${
              isOn
                ? "bg-blue-50 font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-100"
                : "text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
            } ${i > 0 ? "border-l border-gray-300 dark:border-gray-700" : ""}`}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
