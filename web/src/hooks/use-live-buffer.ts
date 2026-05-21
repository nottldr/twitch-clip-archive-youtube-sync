import { useCallback, useEffect, useRef, useState } from "react";

import type { FeedItem } from "#web/components/ActivityRow.js";
import { type SSEEnvelope, useSSEEvents } from "#web/lib/sse-context.js";

const MAX_LIVE_ITEMS = 100;
const FLASH_DURATION_MS = 2000;
let nextId = 0;

function makeId(): string {
  nextId += 1;
  return `live-${Date.now().toString(36)}-${nextId}`;
}

function looksLike<T extends object>(payload: unknown, keys: (keyof T)[]): payload is T {
  if (typeof payload !== "object" || payload === null) return false;
  return keys.every((k) => k in payload);
}

/**
 * Convert an SSE envelope into a FeedItem. Returns null for events that don't
 * make sense to render (upload-progress fires many times per upload; engine
 * state changes carry the full snapshot but the most useful message is the
 * destination state — see engine state machine).
 */
function envelopeToFeedItem(env: SSEEnvelope): FeedItem | null {
  const id = makeId();
  switch (env.type) {
    case "clip:uploaded": {
      if (!looksLike<{ clipId: string; youtubeId: string }>(env.payload, ["clipId", "youtubeId"])) {
        return { id, timestamp: env.receivedAt, type: "upload", message: "Clip uploaded" };
      }
      return {
        id,
        timestamp: env.receivedAt,
        type: "upload",
        message: "Uploaded clip",
        clipId: env.payload.clipId,
        youtubeId: env.payload.youtubeId,
        isLive: true,
      };
    }
    case "clip:failed": {
      if (
        !looksLike<{ clipId: string; errorCode: string; errorMessage: string }>(env.payload, [
          "clipId",
          "errorCode",
        ])
      ) {
        return { id, timestamp: env.receivedAt, type: "error", message: "Clip failed" };
      }
      return {
        id,
        timestamp: env.receivedAt,
        type: "error",
        message: env.payload.errorMessage || "Clip failed",
        clipId: env.payload.clipId,
        errorCode: env.payload.errorCode,
        isLive: true,
      };
    }
    case "clip:skipped": {
      if (!looksLike<{ clipId: string; reason: string }>(env.payload, ["clipId", "reason"])) {
        return { id, timestamp: env.receivedAt, type: "upload", message: "Clip skipped" };
      }
      return {
        id,
        timestamp: env.receivedAt,
        type: "upload",
        message: `Skipped: ${env.payload.reason}`,
        clipId: env.payload.clipId,
        isLive: true,
      };
    }
    case "engine:state": {
      // Payload is the EngineSnapshot — we render a compact one-liner.
      if (looksLike<{ state: string }>(env.payload, ["state"])) {
        return {
          id,
          timestamp: env.receivedAt,
          type: "state_change",
          message: `Engine → ${env.payload.state}`,
          isLive: true,
        };
      }
      return null;
    }
    case "auth:lost":
      return {
        id,
        timestamp: env.receivedAt,
        type: "error",
        message: "YouTube auth lost",
        isLive: true,
      };
    case "auth:gained":
      return {
        id,
        timestamp: env.receivedAt,
        type: "state_change",
        message: "YouTube auth restored",
        isLive: true,
      };
    case "engine:upload-progress":
      // High-frequency progress events would drown the feed. Skip them.
      return null;
    default:
      return null;
  }
}

interface UseLiveBufferResult {
  items: FeedItem[];
  pendingCount: number;
  paused: boolean;
  togglePause: () => void;
  flushPending: () => void;
  clear: () => void;
}

/**
 * Tail of recent SSE events as a ring buffer of FeedItems, with a pause toggle
 * that buffers arrivals without showing them. The Activity page uses this to
 * render the live region.
 */
export function useLiveBuffer(): UseLiveBufferResult {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [pending, setPending] = useState<FeedItem[]>([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Clear the live-flash flag on each item after FLASH_DURATION_MS so the row
  // settles into the resting style.
  useEffect(() => {
    const recentLive = items.filter((i) => i.isLive);
    if (recentLive.length === 0) return;
    const timer = setTimeout(() => {
      setItems((prev) => prev.map((i) => (i.isLive ? { ...i, isLive: false } : i)));
    }, FLASH_DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [items]);

  const handleEvent = useCallback((env: SSEEnvelope) => {
    const item = envelopeToFeedItem(env);
    if (!item) return;
    if (pausedRef.current) {
      setPending((prev) => [...prev.slice(-MAX_LIVE_ITEMS + 1), item]);
    } else {
      setItems((prev) => [...prev.slice(-MAX_LIVE_ITEMS + 1), item]);
    }
  }, []);

  useSSEEvents(handleEvent);

  const togglePause = useCallback(() => {
    setPaused((p) => !p);
  }, []);

  const flushPending = useCallback(() => {
    setPending((p) => {
      if (p.length === 0) return p;
      setItems((prev) => [...prev, ...p].slice(-MAX_LIVE_ITEMS));
      return [];
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setPending([]);
  }, []);

  return {
    items,
    pendingCount: pending.length,
    paused,
    togglePause,
    flushPending,
    clear,
  };
}
