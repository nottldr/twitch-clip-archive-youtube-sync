import type { EstimatedCompletion, QuotaUsage } from "#web/lib/types.js";

function formatCountdown(resetsAt: string): string {
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (ms <= 0) return "resetting...";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

export function QuotaWidget({
  quota,
  estimated,
}: {
  quota: QuotaUsage;
  estimated: EstimatedCompletion;
}) {
  const maxUploads = Math.floor(quota.limit / 100); // assuming 100 cost per upload
  const pct = quota.limit > 0 ? Math.min(100, (quota.used / quota.limit) * 100) : 0;

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium text-gray-700">Daily Quota</h3>
        <span className="text-xs text-gray-400">
          {quota.limitSource === "google-api" ? "from Google API" : "from config"}
        </span>
      </div>

      <div className="mb-2 h-3 w-full rounded-full bg-gray-200">
        <div
          className={`h-3 rounded-full transition-all ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-yellow-500" : "bg-green-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex justify-between text-sm text-gray-600">
        <span>
          {quota.uploadsToday}/{maxUploads} clips ({quota.used.toLocaleString()}/
          {quota.limit.toLocaleString()} units)
        </span>
        <span>Resets in {formatCountdown(quota.resetsAt)}</span>
      </div>

      {estimated.daysRemaining > 0 && (
        <div className="mt-2 text-sm text-gray-500">
          ~{estimated.daysRemaining} days remaining
          {estimated.estimatedDate && ` (est. ${estimated.estimatedDate})`}
        </div>
      )}
    </div>
  );
}
