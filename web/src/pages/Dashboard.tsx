import { useQuery } from "@tanstack/react-query";
import { useEffect, useReducer } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { EngineStateIndicator } from "#web/components/EngineStateIndicator.js";
import { QuotaWidget } from "#web/components/QuotaWidget.js";
import { StatsCards } from "#web/components/StatsCards.js";
import { fetchJson } from "#web/lib/api.js";
import { DashboardStatsSchema, QuotaHistorySchema } from "#web/lib/types.js";

export function Dashboard() {
  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => fetchJson("/api/stats", DashboardStatsSchema),
  });

  const { data: history } = useQuery({
    queryKey: ["quota", "history"],
    queryFn: () => fetchJson("/api/quota/history?days=30", QuotaHistorySchema),
  });

  if (!stats) {
    return <div className="p-8 text-gray-400 dark:text-gray-500">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Dashboard</h1>
        <EngineStateIndicator snapshot={stats.engine} />
      </div>

      {/* Archive freshness warning */}
      {stats.engine.context.lastImportAt && isStale(stats.engine.context.lastImportAt) && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
          Archive may be stale. Last import: {formatTimeAgo(stats.engine.context.lastImportAt)}.
          Check that the twitch-clip-archive tool is running.
        </div>
      )}

      {/* Task panel */}
      <div className="grid gap-4 sm:grid-cols-3">
        <TaskCard
          label="Archive Import"
          lastRun={stats.engine.tasks.archiveImport.lastRunAt}
          nextRun={stats.engine.tasks.archiveImport.nextRunAt}
          status={stats.engine.tasks.archiveImport.status}
          onRunNow={() => {
            void fetch("/api/engine/import-now", { method: "POST" });
          }}
        />
        <TaskCard
          label="Quota Discovery"
          lastRun={stats.engine.tasks.quotaDiscovery.lastRunAt}
          nextRun={stats.engine.tasks.quotaDiscovery.nextRunAt}
          status={stats.engine.tasks.quotaDiscovery.status}
          onRunNow={() => {
            void fetch("/api/engine/discover-now", { method: "POST" });
          }}
        />
        <div className="rounded-lg border bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-200">Upload Queue</div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {stats.engine.context.clipId
              ? `Uploading: ${stats.engine.context.clipTitle ?? stats.engine.context.clipId}`
              : `${stats.clips.pending.toLocaleString()} pending`}
          </div>
          {stats.engine.context.bytesTransferred !== null &&
            stats.engine.context.totalBytes !== null && (
              <div className="mt-2">
                <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className="h-1.5 rounded-full bg-blue-500 transition-all"
                    style={{
                      width: `${Math.min(100, (stats.engine.context.bytesTransferred / stats.engine.context.totalBytes) * 100)}%`,
                    }}
                  />
                </div>
                <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  {formatBytes(stats.engine.context.bytesTransferred)} /{" "}
                  {formatBytes(stats.engine.context.totalBytes)}
                </div>
              </div>
            )}
        </div>
      </div>

      <StatsCards stats={stats.clips} />

      <QuotaWidget quota={stats.quota} estimated={stats.estimated} />

      {history && history.length > 0 && (
        <div className="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
          <h3 className="mb-3 font-medium text-gray-700 dark:text-gray-200">
            Upload History (last 30 days)
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={history}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickFormatter={(d: string) => d.slice(5)}
              />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                labelFormatter={(d: string) => d}
                formatter={(v: number) => [`${v} clips`, "Uploads"]}
              />
              <Bar dataKey="uploadsCount" fill="#3b82f6" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/** Force a re-render every `ms` milliseconds so relative timestamps stay fresh. */
function useTick(ms: number) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = setInterval(tick, ms);
    return () => {
      clearInterval(id);
    };
  }, [ms]);
}

function TaskCard({
  label,
  lastRun,
  nextRun,
  status,
  onRunNow,
}: {
  label: string;
  lastRun: string | null;
  nextRun: string | null;
  status: string;
  onRunNow: () => void;
}) {
  useTick(1000);

  return (
    <div className="rounded-lg border bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</div>
        <button
          onClick={onRunNow}
          disabled={status === "running"}
          className="rounded px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-30"
        >
          {status === "running" ? "Running..." : "Run Now"}
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

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatTimeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "due now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `in ${hours}h ${remainingMinutes}m` : `in ${hours}h`;
}

function isStale(iso: string): boolean {
  const ms = Date.now() - new Date(iso).getTime();
  return ms > 48 * 60 * 60 * 1000; // 48 hours
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
