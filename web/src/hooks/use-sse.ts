import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Map of SSE event types → handler. The handler receives the parsed JSON
 * payload (or null if the payload isn't valid JSON). The hook keeps
 * the latest handlers in a ref so callers can re-render without resubscribing.
 */
export type SSEHandlers = Record<string, (payload: unknown) => void>;

export function useSSE(handlers: SSEHandlers) {
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

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

    // Snapshot the event-type list at subscription time. Adding/removing
    // event types means a reconnect, which is fine — handlers are looked up
    // dynamically via the ref so changing function identity doesn't matter.
    for (const type of Object.keys(handlersRef.current)) {
      es.addEventListener(type, (e: MessageEvent<string>) => {
        let payload: unknown = null;
        try {
          payload = JSON.parse(e.data);
        } catch {
          // non-JSON payload (e.g. the initial "connected" event); leave as null
        }
        handlersRef.current[type]?.(payload);
      });
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connect]);

  return { connected };
}
