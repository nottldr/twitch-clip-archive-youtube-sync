import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SSEEvent } from "#web/lib/types.js";
import { REFETCH_EVENT_TYPES, SSEEventSchema } from "#web/lib/types.js";

const EVENT_TYPES = [
  "upload:success",
  "upload:failure",
  "quota:exhausted",
  "sync:status",
  "sync:error",
];

export function useSSE(onEvent?: (event: SSEEvent) => void) {
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const queryClient = useQueryClient();

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource("/api/events");
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
    };
    es.onerror = () => {
      setConnected(false);
      es.close();
      setTimeout(connect, 5000);
    };

    for (const type of EVENT_TYPES) {
      es.addEventListener(type, (e) => {
        try {
          const raw = JSON.parse(e.data);
          const result = SSEEventSchema.safeParse({ type, ...raw });
          if (!result.success) return;

          const event = result.data;

          if (REFETCH_EVENT_TYPES.has(event.type)) {
            void queryClient.invalidateQueries({ queryKey: ["stats"] });
            void queryClient.invalidateQueries({ queryKey: ["quota"] });
          }

          onEventRef.current?.(event);
        } catch {
          // Ignore parse errors
        }
      });
    }
  }, [queryClient]);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connect]);

  return { connected };
}
