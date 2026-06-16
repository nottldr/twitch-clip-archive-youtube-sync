import { Link, Outlet } from "@tanstack/react-router";

import { AuthBanner } from "#web/components/AuthBanner.js";
import { EngineStateIndicator } from "#web/components/EngineStateIndicator.js";
import { OAuthButton } from "#web/components/OAuthButton.js";
import { ErrorBoundary } from "#web/components/ui/ErrorBoundary.js";
import { usePauseEngine, useResumeEngine } from "#web/lib/mutations.js";
import { useDebugFlags, useOAuthStatus, useStats } from "#web/lib/queries.js";
import { activityDefaults, queueDefaults } from "#web/router.js";

const NAV_LINK_BASE = "px-3 py-1 rounded text-sm hover:bg-gray-100 dark:hover:bg-gray-700";
const NAV_LINK_ACTIVE = "bg-gray-200 font-medium dark:bg-gray-700";

function PauseResumeControls() {
  const { data: stats } = useStats();
  const pauseMutation = usePauseEngine();
  const resumeMutation = useResumeEngine();

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
      className="rounded border border-green-300 px-3 py-1 text-sm text-green-700 hover:bg-green-50 disabled:opacity-50 dark:border-green-700 dark:text-green-300 dark:hover:bg-green-900/40"
    >
      {resumeMutation.isPending ? "Resuming…" : "Resume"}
    </button>
  ) : stats.engine.context.userPaused ? (
    <button disabled className="rounded border border-orange-300 px-3 py-1 text-sm text-orange-500">
      Pausing…
    </button>
  ) : (
    <button
      onClick={() => {
        pauseMutation.mutate();
      }}
      disabled={pauseMutation.isPending}
      className="rounded border px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-700"
    >
      {pauseMutation.isPending ? "Pausing…" : "Pause"}
    </button>
  );
}

/**
 * Yellow nav-bar pill that surfaces a live fault-injection flag — even when the
 * Diagnostics buttons are gated behind VITE_ENABLE_FAULT_INJECTION, a flag set
 * via curl (or left on by a previous dev session) must be visible.
 */
function FaultInjectionPill() {
  const { data: flags } = useDebugFlags({ refetchInterval: 5000 });
  if (!flags) return null;
  const active = [
    flags.fail && "force-fail",
    flags.quota && "force-quota",
    flags.uploadLimit && "force-upload-limit",
  ].filter(Boolean);
  if (active.length === 0) return null;
  return (
    <span
      className="rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/60 dark:text-yellow-100"
      title={`Active flags: ${active.join(", ")}`}
    >
      ⚠ Fault injection
    </span>
  );
}

export function RootLayout() {
  const { data: stats } = useStats();
  const { data: oauthStatus, refetch: refetchOAuth } = useOAuthStatus();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 dark:text-gray-100">
      <nav className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b bg-white px-4 py-3 sm:gap-4 sm:px-6 dark:border-gray-700 dark:bg-gray-800">
        <span className="font-bold text-gray-800 sm:mr-4 dark:text-gray-100">
          twitch-clip-archive-youtube-sync
        </span>
        <Link
          to="/"
          className={NAV_LINK_BASE}
          activeProps={{ className: NAV_LINK_ACTIVE }}
          activeOptions={{ exact: true }}
        >
          Overview
        </Link>
        <Link
          to="/queue"
          search={queueDefaults}
          className={NAV_LINK_BASE}
          activeProps={{ className: NAV_LINK_ACTIVE }}
        >
          Queue
        </Link>
        <Link
          to="/activity"
          search={activityDefaults}
          className={NAV_LINK_BASE}
          activeProps={{ className: NAV_LINK_ACTIVE }}
        >
          Activity
        </Link>
        <Link
          to="/diagnostics"
          className={NAV_LINK_BASE}
          activeProps={{ className: NAV_LINK_ACTIVE }}
        >
          Diagnostics
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <FaultInjectionPill />
          {stats && <EngineStateIndicator snapshot={stats.engine} />}
          <PauseResumeControls />
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
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
