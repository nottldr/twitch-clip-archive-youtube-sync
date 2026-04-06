import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo } from "react";

import { useSSE } from "#web/hooks/use-sse.js";

interface SSEContextValue {
  connected: boolean;
}

const SSEContext = createContext<SSEContextValue>({
  connected: false,
});

export function SSEProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const handleEvent = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["stats"] });
    void queryClient.invalidateQueries({ queryKey: ["quota"] });
    void queryClient.invalidateQueries({ queryKey: ["engine"] });
    void queryClient.invalidateQueries({ queryKey: ["logs"] });
    void queryClient.invalidateQueries({ queryKey: ["clips"] });
  }, [queryClient]);

  const { connected } = useSSE(handleEvent);

  const value = useMemo(() => ({ connected }), [connected]);

  return <SSEContext value={value}>{children}</SSEContext>;
}

export function useSSEContext() {
  return useContext(SSEContext);
}
