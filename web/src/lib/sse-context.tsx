import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";

import { useSSE } from "#web/hooks/use-sse.js";

interface SSEContextValue {
  connected: boolean;
}

const SSEContext = createContext<SSEContextValue>({
  connected: false,
});

interface ClipScopedPayload {
  clipId?: string;
}

function isClipPayload(p: unknown): p is ClipScopedPayload {
  return typeof p === "object" && p !== null && "clipId" in p;
}

export function SSEProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // Targeted invalidation per event type. Avoids the old sledgehammer that
  // invalidated all five query keys on every event (and broke pagination etc.).
  const { connected } = useSSE({
    "engine:state": () => {
      void queryClient.invalidateQueries({ queryKey: ["engine"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    "engine:upload-progress": () => {
      // Consumed directly via the upload-progress event; no refetch needed.
    },
    "clip:uploaded": (payload) => {
      void queryClient.invalidateQueries({ queryKey: ["clips"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      if (isClipPayload(payload) && payload.clipId) {
        void queryClient.invalidateQueries({ queryKey: ["clips", payload.clipId] });
      }
    },
    "clip:failed": (payload) => {
      void queryClient.invalidateQueries({ queryKey: ["clips"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      if (isClipPayload(payload) && payload.clipId) {
        void queryClient.invalidateQueries({ queryKey: ["clips", payload.clipId] });
      }
    },
    "clip:skipped": (payload) => {
      void queryClient.invalidateQueries({ queryKey: ["clips"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      if (isClipPayload(payload) && payload.clipId) {
        void queryClient.invalidateQueries({ queryKey: ["clips", payload.clipId] });
      }
    },
    "auth:lost": () => {
      void queryClient.invalidateQueries({ queryKey: ["engine"] });
      void queryClient.invalidateQueries({ queryKey: ["oauth"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    "auth:gained": () => {
      void queryClient.invalidateQueries({ queryKey: ["engine"] });
      void queryClient.invalidateQueries({ queryKey: ["oauth"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const value = useMemo(() => ({ connected }), [connected]);

  return <SSEContext value={value}>{children}</SSEContext>;
}

export function useSSEContext() {
  return useContext(SSEContext);
}
