import type { FeedItem } from "#web/components/ActivityRow.js";
import { ActivityRow } from "#web/components/ActivityRow.js";
import { EmptyState } from "#web/components/ui/EmptyState.js";
import { useSSEContext } from "#web/lib/sse-context.js";

interface Props {
  items: FeedItem[];
  paused: boolean;
  pendingCount: number;
  onTogglePause: () => void;
  onFlushPending: () => void;
  onClear: () => void;
}

export function LiveFeed({
  items,
  paused,
  pendingCount,
  onTogglePause,
  onFlushPending,
  onClear,
}: Props) {
  const { connected } = useSSEContext();
  // Newest at the bottom — matches Slack/Discord scroll direction.
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
          Live
          {connected ? (
            <span
              className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500"
              title="Connected — receiving real-time events"
            />
          ) : (
            <span
              className="inline-block h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600"
              title="Disconnected — reconnecting"
            />
          )}
        </h2>
        <div className="flex items-center gap-2 text-xs">
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={onFlushPending}
              className="rounded-full bg-blue-500 px-2 py-0.5 text-white hover:bg-blue-600"
            >
              {pendingCount} new
            </button>
          )}
          <button
            type="button"
            onClick={onTogglePause}
            className="rounded border px-2 py-0.5 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {paused ? "Resume" : "Pause"}
          </button>
          {items.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="rounded px-2 py-0.5 text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <div className="rounded-lg border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {items.length === 0 ? (
          <EmptyState
            title={paused ? "Live feed paused" : "Waiting for events"}
            hint={
              paused
                ? "New events will buffer until you resume."
                : "Engine state changes, uploads, and failures will appear here as they happen."
            }
          />
        ) : (
          <div className="divide-y dark:divide-gray-700">
            {items.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
