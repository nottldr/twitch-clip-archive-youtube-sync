import { EngineStateIndicator } from "#web/components/EngineStateIndicator.js";
import { TaskCard } from "#web/components/TaskCard.js";
import { formatBytes, useTick } from "#web/lib/time.js";
import type { DashboardStats } from "#web/lib/types.js";

interface Props {
  stats: DashboardStats;
}

export function NowSection({ stats }: Props) {
  useTick(1000);
  const ctx = stats.engine.context;
  const bytes = ctx.bytesTransferred;
  const total = ctx.totalBytes;
  const progress = bytes !== null && total !== null && total > 0 ? { bytes, total } : null;
  const pct = progress ? Math.min(100, (progress.bytes / progress.total) * 100) : 0;

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">Now</h2>
      <div className="space-y-3 rounded-lg border bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap items-center gap-3">
          <EngineStateIndicator snapshot={stats.engine} />
          {ctx.clipTitle && !progress && (
            <span
              className="truncate text-sm text-gray-500 dark:text-gray-400"
              title={ctx.clipTitle}
            >
              {ctx.clipTitle}
            </span>
          )}
          {progress && (
            <div className="min-w-[12rem] flex-1">
              <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-1.5 rounded-full bg-blue-500 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {formatBytes(progress.bytes)} / {formatBytes(progress.total)}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <CountStat label="Pending" value={stats.clips.pending} />
          <CountStat label="Uploading" value={stats.clips.uploading} />
          <CountStat
            label="Failed"
            value={stats.clips.failed}
            tone={stats.clips.failed > 0 ? "danger" : "neutral"}
          />
          <CountStat label="Uploaded" value={stats.clips.uploaded} />
          {stats.estimated.daysRemaining > 0 && (
            <span className="text-sm">
              <span className="text-gray-500 dark:text-gray-400">ETA:</span>{" "}
              <span className="font-semibold">~{stats.estimated.daysRemaining}d</span>
              {stats.estimated.estimatedDate && (
                <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">
                  ({stats.estimated.estimatedDate})
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
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
      </div>
    </section>
  );
}

function CountStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "danger";
}) {
  const valueCls = tone === "danger" ? "text-red-600 dark:text-red-300" : "";
  return (
    <span className="text-sm">
      <span className="text-gray-500 dark:text-gray-400">{label}:</span>{" "}
      <span className={`font-semibold ${valueCls}`}>{value.toLocaleString()}</span>
    </span>
  );
}
