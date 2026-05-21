import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";

import { useSSE } from "#web/hooks/use-sse.js";

/**
 * Event payloads as they arrive over SSE. The hook delivers parsed JSON; we
 * carry the event type through so subscribers can switch on it.
 *
 * NOTE: This is intentionally a structural type, not the Zod-discriminated
 * SSEEvent in types.ts — we don't want to fail to deliver an event just
 * because schema drift happens between server and client.
 */
export interface SSEEnvelope {
  type: string;
  receivedAt: string;
  payload: unknown;
}

type Subscriber = (event: SSEEnvelope) => void;

interface SSEContextValue {
  connected: boolean;
  subscribe: (cb: Subscriber) => () => void;
}

const SSEContext = createContext<SSEContextValue>({
  connected: false,
  subscribe: () => () => {
    /* noop */
  },
});

interface ClipScopedPayload {
  clipId?: string;
}

function isClipPayload(p: unknown): p is ClipScopedPayload {
  return typeof p === "object" && p !== null && "clipId" in p;
}

export function SSEProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // Live-feed subscribers (Activity page, anything that wants raw events).
  // Kept in a ref so adding/removing subscribers doesn't tear down the SSE
  // connection.
  const subscribersRef = useRef(new Set<Subscriber>());

  const notify = useCallback((type: string, payload: unknown) => {
    if (subscribersRef.current.size === 0) return;
    const env: SSEEnvelope = {
      type,
      payload,
      receivedAt: new Date().toISOString(),
    };
    for (const cb of subscribersRef.current) cb(env);
  }, []);

  // Targeted invalidation per event type. Each handler also forwards the raw
  // event to live-feed subscribers — the Activity page renders a real-time
  // SSE stream off this.
  const { connected } = useSSE({
    "engine:state": (payload) => {
      void queryClient.invalidateQueries({ queryKey: ["engine"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      notify("engine:state", payload);
    },
    "engine:upload-progress": (payload) => {
      // No refetch — the EngineStateIndicator reads progress directly off the
      // engine snapshot, which is refetched by "engine:state".
      notify("engine:upload-progress", payload);
    },
    "clip:uploaded": (payload) => {
      void queryClient.invalidateQueries({ queryKey: ["clips"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
      if (isClipPayload(payload) && payload.clipId) {
        void queryClient.invalidateQueries({ queryKey: ["clips", payload.clipId] });
      }
      notify("clip:uploaded", payload);
    },
    "clip:failed": (payload) => {
      void queryClient.invalidateQueries({ queryKey: ["clips"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
      if (isClipPayload(payload) && payload.clipId) {
        void queryClient.invalidateQueries({ queryKey: ["clips", payload.clipId] });
      }
      notify("clip:failed", payload);
    },
    "clip:skipped": (payload) => {
      void queryClient.invalidateQueries({ queryKey: ["clips"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
      if (isClipPayload(payload) && payload.clipId) {
        void queryClient.invalidateQueries({ queryKey: ["clips", payload.clipId] });
      }
      notify("clip:skipped", payload);
    },
    "auth:lost": (payload) => {
      void queryClient.invalidateQueries({ queryKey: ["engine"] });
      void queryClient.invalidateQueries({ queryKey: ["oauth"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      notify("auth:lost", payload);
    },
    "auth:gained": (payload) => {
      void queryClient.invalidateQueries({ queryKey: ["engine"] });
      void queryClient.invalidateQueries({ queryKey: ["oauth"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      notify("auth:gained", payload);
    },
  });

  const subscribe = useCallback((cb: Subscriber) => {
    subscribersRef.current.add(cb);
    return () => {
      subscribersRef.current.delete(cb);
    };
  }, []);

  const value = useMemo(() => ({ connected, subscribe }), [connected, subscribe]);

  return <SSEContext value={value}>{children}</SSEContext>;
}

export function useSSEContext() {
  return useContext(SSEContext);
}

/**
 * Subscribe to raw SSE events. The callback identity is captured at mount;
 * use a stable callback (useCallback) if you want updates to flow without
 * re-subscribing.
 */
export function useSSEEvents(cb: Subscriber) {
  const { subscribe } = useContext(SSEContext);
  useEffect(() => {
    return subscribe(cb);
  }, [subscribe, cb]);
}
