import { formatTimeAgo, formatTimeUntil, useTick } from "#web/lib/time.js";

interface Props {
  label: string;
  lastRun: string | null;
  nextRun: string | null;
  status: string;
  onRunNow: () => void;
}

export function TaskCard({ label, lastRun, nextRun, status, onRunNow }: Props) {
  useTick(1000);

  return (
    <div className="rounded-lg border bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</div>
        <button
          onClick={onRunNow}
          disabled={status === "running"}
          className="rounded px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-30 dark:hover:bg-blue-900/40"
        >
          {status === "running" ? "Running…" : "Run now"}
        </button>
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {lastRun ? `Last: ${formatTimeAgo(lastRun)}` : "Never run"}
      </div>
      {nextRun && status !== "running" && (
        <div className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
          Next: {formatTimeUntil(nextRun)}
        </div>
      )}
    </div>
  );
}
