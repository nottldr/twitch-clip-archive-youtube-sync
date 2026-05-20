import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";

import { AuthBanner } from "#web/components/AuthBanner.js";
import { EngineStateIndicator } from "#web/components/EngineStateIndicator.js";
import { OAuthButton } from "#web/components/OAuthButton.js";
import { fetchJson } from "#web/lib/api.js";
import { SSEProvider, useSSEContext } from "#web/lib/sse-context.js";
import { ToastProvider, useToast } from "#web/lib/toast.js";
import { DashboardStatsSchema, OAuthStatusSchema } from "#web/lib/types.js";

import { Clips } from "./pages/Clips.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Debug } from "./pages/Debug.js";
import { Logs } from "./pages/Logs.js";

function PauseResumeControls() {
  const queryClient = useQueryClient();
  const { notify } = useToast();

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => fetchJson("/api/stats", DashboardStatsSchema),
  });

  const pauseMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/engine/pause", { method: "POST" });
      if (!res.ok) throw new Error(`Pause failed: ${res.status}`);
    },
    onSuccess: () => {
      notify("success", "Engine paused");
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) => {
      notify("error", err instanceof Error ? err.message : "Failed to pause");
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/engine/resume", { method: "POST" });
      if (!res.ok) throw new Error(`Resume failed: ${res.status}`);
    },
    onSuccess: () => {
      notify("success", "Engine resumed");
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) => {
      notify("error", err instanceof Error ? err.message : "Failed to resume");
    },
  });

  if (!stats) return null;
  const state = stats.engine.state;
  const isPaused = state === "active.blocked.userPaused";
  const isActive = state.startsWith("active.");
  if (!isActive) return null;

  return isPaused ? (
    <button
      onClick={() => {
        resumeMutation.mutate();
      }}
      disabled={resumeMutation.isPending}
      className="rounded border border-green-300 px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-50 dark:border-green-700 dark:text-green-300 dark:hover:bg-green-900/40"
    >
      {resumeMutation.isPending ? "Resuming…" : "Resume"}
    </button>
  ) : stats.engine.context.userPaused ? (
    <button disabled className="rounded border border-orange-300 px-2 py-1 text-xs text-orange-500">
      Pausing…
    </button>
  ) : (
    <button
      onClick={() => {
        pauseMutation.mutate();
      }}
      disabled={pauseMutation.isPending}
      className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-700"
    >
      {pauseMutation.isPending ? "Pausing…" : "Pause"}
    </button>
  );
}

function Layout() {
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
    `px-3 py-1 rounded text-sm ${isActive ? "bg-gray-200 font-medium dark:bg-gray-700" : "hover:bg-gray-100 dark:hover:bg-gray-700"}`;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 dark:text-gray-100">
      <nav className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b bg-white px-4 py-3 sm:gap-4 sm:px-6 dark:border-gray-700 dark:bg-gray-800">
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
          <PauseResumeControls />
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
      {stats && <AuthBanner state={stats.engine.state} />}
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
      <ToastProvider>
        <SSEProvider>
          <Layout />
        </SSEProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
