import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-800">Dashboard</h1>

      <StatsCards stats={stats.clips} />

      <QuotaWidget quota={stats.quota} estimated={stats.estimated} />

      {history && history.length > 0 && (
        <div className="rounded-lg bg-white p-4 shadow-sm">
          <h3 className="mb-3 font-medium text-gray-700">Upload History (last 30 days)</h3>
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
