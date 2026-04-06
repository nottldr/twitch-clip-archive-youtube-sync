import type { ClipStats } from "#web/lib/types.js";

const cards: Array<{ key: keyof ClipStats; label: string; color: string }> = [
  { key: "total", label: "Total Clips", color: "border-gray-300" },
  { key: "uploaded", label: "Uploaded", color: "border-green-400" },
  { key: "pending", label: "Pending", color: "border-yellow-400" },
  { key: "failed", label: "Failed", color: "border-red-400" },
  { key: "skipped", label: "Skipped", color: "border-gray-400" },
  { key: "ignored", label: "Ignored", color: "border-purple-400" },
];

export function StatsCards({ stats }: { stats: ClipStats }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((card) => (
        <div
          key={card.key}
          className={`rounded-lg border-l-4 bg-white shadow-sm dark:bg-gray-800 ${card.color} p-4`}
        >
          <div className="text-sm text-gray-500 dark:text-gray-400">{card.label}</div>
          <div className="mt-1 text-2xl font-bold">{stats[card.key].toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}
