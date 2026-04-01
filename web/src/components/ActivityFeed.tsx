import type { ActivityItem } from "#web/lib/types.js";

import { StatusBadge } from "./StatusBadge.js";

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <StatusBadge status={item.sync_status} />
      <span className="min-w-0 flex-1 truncate text-gray-600" title={item.title}>
        {item.title}
      </span>
      {item.youtube_id && (
        <a
          href={`https://youtu.be/${item.youtube_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs text-blue-500 hover:underline"
        >
          {item.youtube_id}
        </a>
      )}
      {item.last_error && !item.youtube_id && (
        <span className="shrink-0 truncate text-xs text-red-500" title={item.last_error}>
          {item.last_error}
        </span>
      )}
    </div>
  );
}

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h3 className="mb-2 font-medium text-gray-700">Recent activity</h3>
        <p className="text-sm text-gray-400">No activity yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <h3 className="mb-2 font-medium text-gray-700">Recent activity</h3>
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {items.map((item) => (
          <ActivityRow key={`${item.clip_id}-${item.updated_at}`} item={item} />
        ))}
      </div>
    </div>
  );
}
