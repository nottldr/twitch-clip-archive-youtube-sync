import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";

import { EngineStateIndicator } from "#web/components/EngineStateIndicator.js";
import { OAuthButton } from "#web/components/OAuthButton.js";
import { fetchJson } from "#web/lib/api.js";
import { SSEProvider, useSSEContext } from "#web/lib/sse-context.js";
import { DashboardStatsSchema, OAuthStatusSchema } from "#web/lib/types.js";

import { Clips } from "./pages/Clips.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Debug } from "./pages/Debug.js";
import { Logs } from "./pages/Logs.js";

function Layout() {
  const queryClient = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => fetchJson("/api/stats", DashboardStatsSchema),
  });

  const { data: oauthStatus, refetch: refetchOAuth } = useQuery({
    queryKey: ["oauth", "status"],
    queryFn: () => fetchJson("/api/oauth/status", OAuthStatusSchema),
  });

  const { connected } = useSSEContext();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1 rounded text-sm ${isActive ? "bg-gray-200 font-medium" : "hover:bg-gray-100"}`;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 dark:text-gray-100">
      <nav className="flex flex-wrap items-center gap-3 border-b bg-white px-4 py-3 sm:gap-4 sm:px-6 dark:border-gray-700 dark:bg-gray-800">
        <span className="font-bold text-gray-800 sm:mr-4 dark:text-gray-100">
          twitch-clip-archive-youtube-sync
        </span>
        <NavLink to="/" className={linkClass} end>
          Dashboard
        </NavLink>
        <NavLink to="/clips" className={linkClass}>
          Clips
        </NavLink>
        <NavLink to="/logs" className={linkClass}>
          Logs
        </NavLink>
        <NavLink to="/debug" className={linkClass}>
          Debug
        </NavLink>
        <div className="ml-auto flex items-center gap-3">
          {stats && <EngineStateIndicator snapshot={stats.engine} />}
          {stats && stats.engine.state === "active.blocked.userPaused" && (
            <button
              onClick={() => {
                void fetch("/api/engine/resume", { method: "POST" }).then(() => {
                  void queryClient.invalidateQueries({ queryKey: ["stats"] });
                });
              }}
              className="rounded border border-green-300 px-2 py-1 text-xs text-green-600 hover:bg-green-50"
            >
              Resume
            </button>
          )}
          {stats &&
            stats.engine.state.startsWith("active.") &&
            stats.engine.state !== "active.blocked.userPaused" &&
            (stats.engine.context.userPaused ? (
              <button
                disabled
                className="rounded border border-orange-300 px-2 py-1 text-xs text-orange-500"
              >
                Pausing…
              </button>
            ) : (
              <button
                onClick={() => {
                  void fetch("/api/engine/pause", { method: "POST" }).then(() => {
                    void queryClient.invalidateQueries({ queryKey: ["stats"] });
                  });
                }}
                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
              >
                Pause
              </button>
            ))}
          {connected && (
            <span
              className="inline-block h-2 w-2 rounded-full bg-green-500"
              title="Live: receiving real-time updates"
            />
          )}
          <OAuthButton
            connected={oauthStatus?.connected ?? false}
            onDisconnect={() => {
              void refetchOAuth();
            }}
          />
        </div>
      </nav>
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clips" element={<Clips />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/debug" element={<Debug />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <SSEProvider>
        <Layout />
      </SSEProvider>
    </BrowserRouter>
  );
}
