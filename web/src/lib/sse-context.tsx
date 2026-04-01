import type { ActivityItem, SSEEvent } from "./types.js";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { useSSE } from "#web/hooks/use-sse.js";
import { fetchJson } from "#web/lib/api.js";
import { RecentActivitySchema } from "#web/lib/types.js";

interface SSEContextValue {
  connected: boolean;
  recentActivity: ActivityItem[];
}

const SSEContext = createContext<SSEContextValue>({
  connected: false,
  recentActivity: [],
});

export function SSEProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // Load persisted activity from DB on mount
  const { data: persistedActivity } = useQuery({
    queryKey: ["activity"],
    queryFn: () => fetchJson("/api/activity?limit=10", RecentActivitySchema),
  });

  // Track live events that arrive via SSE (newer than what's persisted)
  const [liveItems, setLiveItems] = useState<ActivityItem[]>([]);

  const handleEvent = useCallback(
    (event: SSEEvent) => {
      if (event.type === "upload:success") {
        setLiveItems((prev) =>
          [
            {
              clip_id: event.clipId,
              title: event.clipId,
              sync_status: "uploaded",
              youtube_id: event.youtubeId,
              last_error: null,
              updated_at: new Date().toISOString(),
            },
            ...prev,
          ].slice(0, 10),
        );
        // Refresh persisted activity in the background
        void queryClient.invalidateQueries({ queryKey: ["activity"] });
      }
      if (event.type === "upload:failure") {
        setLiveItems((prev) =>
          [
            {
              clip_id: event.clipId,
              title: event.clipId,
              sync_status: "failed",
              youtube_id: null,
              last_error: event.error,
              updated_at: new Date().toISOString(),
            },
            ...prev,
          ].slice(0, 10),
        );
        void queryClient.invalidateQueries({ queryKey: ["activity"] });
      }
    },
    [queryClient],
  );

  const { connected } = useSSE(handleEvent);

  // Merge: live items first, then fill with persisted (deduplicated by clip_id)
  const recentActivity = useMemo(() => {
    const seen = new Set<string>();
    const merged: ActivityItem[] = [];

    for (const item of liveItems) {
      if (!seen.has(item.clip_id)) {
        seen.add(item.clip_id);
        merged.push(item);
      }
    }
    for (const item of persistedActivity ?? []) {
      if (!seen.has(item.clip_id)) {
        seen.add(item.clip_id);
        merged.push(item);
      }
    }

    return merged.slice(0, 10);
  }, [liveItems, persistedActivity]);

  const value = useMemo(() => ({ connected, recentActivity }), [connected, recentActivity]);

  return <SSEContext value={value}>{children}</SSEContext>;
}

export function useSSEContext() {
  return useContext(SSEContext);
}
