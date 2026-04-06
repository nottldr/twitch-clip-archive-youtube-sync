import { useCallback, useEffect, useRef, useState } from "react";

const EVENT_TYPES = ["upload:success", "upload:failure", "engine:state", "engine:upload-progress"];

export function useSSE(onEvent?: () => void) {
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

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
      es.addEventListener(type, () => {
        onEventRef.current?.();
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
