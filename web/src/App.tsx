import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";

import { ActivityFeed } from "#web/components/ActivityFeed.js";
import { OAuthButton } from "#web/components/OAuthButton.js";
import { StatusBadge } from "#web/components/StatusBadge.js";
import { fetchJson } from "#web/lib/api.js";
import { SSEProvider, useSSEContext } from "#web/lib/sse-context.js";
import { DashboardStatsSchema, OAuthStatusSchema } from "#web/lib/types.js";

import { Clips } from "./pages/Clips.js";
import { Dashboard } from "./pages/Dashboard.js";

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

  const { connected, recentActivity } = useSSEContext();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1 rounded text-sm ${isActive ? "bg-gray-200 font-medium" : "hover:bg-gray-100"}`;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="flex flex-wrap items-center gap-3 border-b bg-white px-4 py-3 sm:gap-4 sm:px-6">
        <span className="font-bold text-gray-800 sm:mr-4">twitch-clip-archive-youtube-sync</span>
        <NavLink to="/" className={linkClass} end>
          Dashboard
        </NavLink>
        <NavLink to="/clips" className={linkClass}>
          Clips
        </NavLink>
        <div className="ml-auto flex items-center gap-3">
          {stats && <StatusBadge status={stats.engine.status} />}
          {stats?.engine.currentUpload && (
            <span
              className="max-w-[10rem] truncate text-xs text-gray-400"
              title={stats.engine.currentUpload}
            >
              uploading...
            </span>
          )}
          {stats && stats.engine.syncMode === "auto" && (
            <button
              onClick={() => {
                const action = stats.engine.paused ? "resume" : "pause";
                void fetch(`/api/engine/${action}`, { method: "POST" }).then(() => {
                  void queryClient.invalidateQueries({ queryKey: ["stats"] });
                });
              }}
              className={`rounded border px-2 py-1 text-xs ${
                stats.engine.paused
                  ? "border-green-300 text-green-600 hover:bg-green-50"
                  : "hover:bg-gray-50"
              }`}
            >
              {stats.engine.paused ? "Resume" : "Pause"}
            </button>
          )}
          {stats?.engine.syncMode === "manual" && (
            <>
              <button
                onClick={() => {
                  void fetch("/api/engine/trigger", { method: "POST" });
                }}
                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                title="Upload the next pending clip"
              >
                Trigger
              </button>
              <button
                onClick={() => {
                  if (window.confirm("Reset failed/skipped clips to pending?")) {
                    void fetch("/api/engine/reset-failed", { method: "POST" }).then(() => {
                      void queryClient.invalidateQueries();
                    });
                  }
                }}
                className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                title="Reset failed/skipped clips to pending"
              >
                Reset
              </button>
            </>
          )}
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
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <div className="flex flex-col gap-6 lg:flex-row">
          <main className="min-w-0 flex-1">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/clips" element={<Clips />} />
            </Routes>
          </main>
          <aside className="lg:w-80 lg:shrink-0">
            <ActivityFeed items={recentActivity} />
          </aside>
        </div>
      </div>
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
