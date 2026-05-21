import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { InboxSection } from "#web/components/InboxSection.js";
import { NowSection } from "#web/components/NowSection.js";
import { QuotaWidget } from "#web/components/QuotaWidget.js";
import { PageHeader } from "#web/components/ui/PageHeader.js";
import { Skeleton, SkeletonRow } from "#web/components/ui/Skeleton.js";
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
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" />
        <Skeleton className="h-32 w-full" />
        <SkeletonRow />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle="Triage failures, watch live state, see today's quota."
      />

      <InboxSection engine={stats.engine} />
      <NowSection stats={stats} />

      <section className="space-y-3">
        <h2 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">Today</h2>
        <QuotaWidget quota={stats.quota} estimated={stats.estimated} />

        {history && history.length > 0 && (
          <div className="rounded-lg border bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-200">
              Upload history (last 30 days)
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
                  labelFormatter={(d) => (typeof d === "string" ? d : "")}
                  formatter={(v) => [`${typeof v === "number" ? v : 0} clips`, "Uploads"]}
                />
                <Bar dataKey="uploadsCount" fill="#3b82f6" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}
