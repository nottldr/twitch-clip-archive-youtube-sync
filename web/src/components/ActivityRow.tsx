import { Link } from "react-router-dom";

import { StatusBadge } from "#web/components/StatusBadge.js";
import { ErrorCodeChip } from "#web/components/ui/ErrorCodeChip.js";

/**
 * Unified shape rendered by both the live feed and the audit-log scrollback.
 * Live SSE events get mapped into this shape on arrival; engine_log entries
 * get mapped on render.
 */
export interface FeedItem {
  id: string;
  timestamp: string;
  /** "state_change" | "upload" | "error" — same vocabulary as engine_log.type. */
  type: string;
  message: string;
  clipId?: string | null;
  youtubeId?: string | null;
  errorCode?: string | null;
  /** When true, this is a freshly-arrived SSE event; the row flashes briefly. */
  isLive?: boolean;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

interface Props {
  item: FeedItem;
}

export function ActivityRow({ item }: Props) {
  const flashCls = item.isLive
    ? "animate-pulse border-l-2 border-blue-400 bg-blue-50/40 dark:border-blue-400 dark:bg-blue-900/20"
    : "";
  return (
    <div className={`flex items-start gap-3 px-4 py-2 text-sm transition-colors ${flashCls}`}>
      <span className="shrink-0 font-mono text-xs text-gray-400 dark:text-gray-500">
        {formatTimestamp(item.timestamp)}
      </span>
      <StatusBadge status={item.type} />
      <span className="min-w-0 flex-1 text-gray-700 dark:text-gray-200">
        {item.message}
        {item.clipId && (
          <>
            {" "}
            <Link
              to={`/clips/${item.clipId}`}
              className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-300"
            >
              {item.clipId}
            </Link>
          </>
        )}
        {item.errorCode && (
          <span className="ml-2 align-middle">
            <ErrorCodeChip code={item.errorCode} />
          </span>
        )}
      </span>
    </div>
  );
}
