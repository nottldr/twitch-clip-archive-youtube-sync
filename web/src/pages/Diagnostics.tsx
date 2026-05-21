import { useState } from "react";

import { EngineStateIndicator } from "#web/components/EngineStateIndicator.js";
import { ConfirmDialog } from "#web/components/ui/ConfirmDialog.js";
import { PageHeader } from "#web/components/ui/PageHeader.js";
import { Skeleton } from "#web/components/ui/Skeleton.js";
import { useAdminAction } from "#web/lib/mutations.js";
import {
  useDebugFlags,
  useEngineSnapshot,
  useOAuthStatus,
  useQuotaHistory,
  useStats,
} from "#web/lib/queries.js";
import { formatTimeAgo, formatTimeUntil, useTick } from "#web/lib/time.js";

const FAULT_INJECTION_ENABLED = import.meta.env.VITE_ENABLE_FAULT_INJECTION === "true";

interface ActionButton {
  label: string;
  url: string;
  danger?: boolean;
  confirmTitle?: string;
  confirmBody?: string;
}

interface ActionGroup {
  title: string;
  description?: string;
  actions: ActionButton[];
}

const SAFE_GROUPS: ActionGroup[] = [
  {
    title: "Engine",
    description: "Nudge background tasks. Safe to run any time.",
    actions: [
      { label: "Force re-import archive", url: "/api/engine/import-now" },
      { label: "Force quota discovery", url: "/api/engine/discover-now" },
      { label: "Reset today's quota counter", url: "/api/debug/reset-quota" },
    ],
  },
  {
    title: "Clips",
    description: "Reset clip state. Resets touch sync_status, retry_count, and last_error.",
    actions: [
      { label: "Reset all failed → pending", url: "/api/engine/reset-failed" },
      {
        label: "Reset ALL clips → pending",
        url: "/api/engine/reset-all",
        danger: true,
        confirmTitle: "Reset every non-ignored clip?",
        confirmBody:
          "Every uploaded/failed/skipped clip becomes pending again. The engine will re-attempt uploads. Ignored clips are left alone.",
      },
    ],
  },
  {
    title: "Test data",
    actions: [
      { label: "Add 5 test clips", url: "/api/debug/add-clips?count=5" },
      {
        label: "Clear engine log",
        url: "/api/logs/clear",
        danger: true,
        confirmTitle: "Clear the entire engine log?",
        confirmBody:
          "All historical state changes, upload audits, and errors are deleted. New events from this point on are kept.",
      },
    ],
  },
];

const FAULT_INJECTION_GROUP: ActionGroup = {
  title: "Fault injection",
  description:
    "Forces the engine into specific failure modes. Useful for testing the UI; do NOT leave flags on in production.",
  actions: [
    { label: "Force next upload to fail", url: "/api/debug/set-flag/fail" },
    { label: "Force quota exhausted", url: "/api/debug/set-flag/quota" },
    { label: "Force upload limit hit", url: "/api/debug/set-flag/uploadLimit" },
    { label: "Clear all fault-injection flags", url: "/api/debug/clear-all-flags" },
  ],
};

export function Diagnostics() {
  const [pendingConfirm, setPendingConfirm] = useState<ActionButton | null>(null);

  const { data: stats } = useStats();
  const { data: snapshot } = useEngineSnapshot({ refetchInterval: 2000 });
  const { data: history } = useQuotaHistory(7);
  const { data: oauth } = useOAuthStatus();
  const { data: flags } = useDebugFlags();
  const adminMutation = useAdminAction();

  function runAction(action: ActionButton) {
    adminMutation.mutate({ url: action.url, label: action.label });
  }

  function handleClick(action: ActionButton) {
    if (action.confirmTitle) {
      setPendingConfirm(action);
    } else {
      runAction(action);
    }
  }

  const lastResult = adminMutation.data
    ? `${adminMutation.data.label}: ${JSON.stringify(adminMutation.data.result)}`
    : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Diagnostics" subtitle="Inspect engine state and run admin actions." />

      <Panel title="Engine state" defaultOpen>
        {snapshot ? (
          <div className="space-y-3">
            <EngineStateIndicator snapshot={snapshot} />
            <KvGrid
              entries={[
                ["State path", snapshot.state],
                ["User paused", String(snapshot.context.userPaused)],
                ["Current clip", snapshot.context.clipId ?? "—"],
                ["Wait resumes at", snapshot.context.waitResumeAt ?? "—"],
                ["Last error", snapshot.context.lastError ?? "—"],
                ["Last archive import", snapshot.context.lastImportAt ?? "—"],
                ["Clips imported (last)", snapshot.context.clipsImported?.toString() ?? "—"],
                ["Last quota discovery", snapshot.context.lastQuotaDiscoveryAt ?? "—"],
                ["Quota limit", snapshot.context.quotaLimit?.toLocaleString() ?? "—"],
              ]}
            />
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-500 dark:text-gray-400">
                Raw snapshot (debug)
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto rounded bg-gray-50 p-3 dark:bg-gray-900">
                {JSON.stringify(snapshot, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </Panel>

      <Panel title="Quota" defaultOpen>
        {stats ? (
          <div className="space-y-2">
            <KvGrid
              entries={[
                ["Used today", `${stats.quota.used.toLocaleString()} units`],
                ["Daily limit", `${stats.quota.limit.toLocaleString()} units`],
                ["Source", stats.quota.limitSource],
                ["Uploads today", stats.quota.uploadsToday.toLocaleString()],
                ["Resets at", stats.quota.resetsAt],
              ]}
            />
            {history && history.length > 0 && (
              <table className="mt-3 w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400">
                    <th className="py-1">Date (PT)</th>
                    <th className="py-1">Uploads</th>
                    <th className="py-1">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.date} className="border-t dark:border-gray-700">
                      <td className="py-1 font-mono">{row.date}</td>
                      <td className="py-1">{row.uploadsCount}</td>
                      <td className="py-1">{row.unitsUsed.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </Panel>

      <Panel title="OAuth" defaultOpen>
        <OAuthPanel oauth={oauth} />
      </Panel>

      <Panel title="Clip counts">
        {stats ? (
          <KvGrid
            entries={[
              ["Total", stats.clips.total.toLocaleString()],
              ["Pending", stats.clips.pending.toLocaleString()],
              ["Uploading", stats.clips.uploading.toLocaleString()],
              ["Uploaded", stats.clips.uploaded.toLocaleString()],
              ["Failed", stats.clips.failed.toLocaleString()],
              ["Skipped", stats.clips.skipped.toLocaleString()],
              ["Ignored", stats.clips.ignored.toLocaleString()],
            ]}
          />
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </Panel>

      <Panel title="Actions" defaultOpen>
        <div className="grid gap-4 sm:grid-cols-2">
          {SAFE_GROUPS.map((group) => (
            <ActionGroupCard key={group.title} group={group} onClick={handleClick} />
          ))}
          {FAULT_INJECTION_ENABLED && (
            <ActionGroupCard
              group={FAULT_INJECTION_GROUP}
              onClick={handleClick}
              activeFlags={flags}
            />
          )}
        </div>
        {!FAULT_INJECTION_ENABLED && (
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Fault-injection actions are hidden. Set{" "}
            <code className="rounded bg-gray-100 px-1 dark:bg-gray-700">
              VITE_ENABLE_FAULT_INJECTION=true
            </code>{" "}
            in the build env to expose them.
          </p>
        )}
        {lastResult && (
          <pre className="mt-3 max-h-40 overflow-auto rounded bg-gray-50 p-3 text-xs dark:bg-gray-900">
            {lastResult}
          </pre>
        )}
      </Panel>

      <ConfirmDialog
        open={!!pendingConfirm}
        title={pendingConfirm?.confirmTitle ?? ""}
        body={pendingConfirm?.confirmBody}
        confirmLabel={pendingConfirm?.label ?? "Confirm"}
        destructive={pendingConfirm?.danger}
        onCancel={() => {
          setPendingConfirm(null);
        }}
        onConfirm={() => {
          if (pendingConfirm) runAction(pendingConfirm);
          setPendingConfirm(null);
        }}
      />
    </div>
  );
}

function Panel({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-lg border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
    >
      <summary className="cursor-pointer list-none px-4 py-3 font-medium text-gray-700 select-none dark:text-gray-200">
        <span className="mr-1.5 inline-block text-xs text-gray-400 transition-transform group-open:rotate-90 dark:text-gray-500">
          ▸
        </span>
        {title}
      </summary>
      <div className="border-t px-4 py-3 dark:border-gray-700">{children}</div>
    </details>
  );
}

function KvGrid({ entries }: { entries: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
          <dd className="font-mono break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActionGroupCard({
  group,
  onClick,
  activeFlags,
}: {
  group: ActionGroup;
  onClick: (action: ActionButton) => void;
  activeFlags?: { fail: boolean; quota: boolean; uploadLimit: boolean };
}) {
  function flagFor(url: string): boolean {
    if (!activeFlags) return false;
    if (url.endsWith("/fail")) return activeFlags.fail;
    if (url.endsWith("/quota")) return activeFlags.quota;
    if (url.endsWith("/uploadLimit")) return activeFlags.uploadLimit;
    return false;
  }

  return (
    <div className="rounded-lg border bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">{group.title}</h3>
      {group.description && (
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{group.description}</p>
      )}
      <div className="mt-2 flex flex-col gap-1.5">
        {group.actions.map((action) => {
          const isOn = flagFor(action.url);
          return (
            <button
              key={action.url}
              onClick={() => {
                onClick(action);
              }}
              className={`rounded border px-3 py-1.5 text-left text-sm dark:border-gray-700 ${
                action.danger
                  ? "border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                  : isOn
                    ? "border-yellow-400 bg-yellow-50 text-yellow-800 dark:border-yellow-600 dark:bg-yellow-900/40 dark:text-yellow-100"
                    : "border-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              {action.label}
              {isOn && (
                <span className="ml-2 font-mono text-xs tracking-wide uppercase">active</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OAuthPanel({
  oauth,
}: {
  oauth?: {
    connected: boolean;
    expiryDate?: string | null;
    scope?: string | null;
    lastRefresh?: string | null;
  };
}) {
  useTick(15_000);
  if (!oauth) return <Skeleton className="h-16 w-full" />;
  if (!oauth.connected) {
    return (
      <div className="text-sm">
        <span className="font-medium text-yellow-700 dark:text-yellow-200">Not connected.</span>{" "}
        <a href="/api/oauth/connect" className="text-blue-600 hover:underline">
          Connect YouTube
        </a>
      </div>
    );
  }

  // Google returns expiry as either an ISO string or a millisecond-epoch string;
  // try both so the diagnostic surface doesn't look broken when the storage
  // format is the raw refresh response.
  const expiry = oauth.expiryDate ? parseExpiry(oauth.expiryDate) : null;
  const expiryDisplay = expiry
    ? `${expiry.toISOString()} (${formatTimeUntil(expiry.toISOString())})`
    : (oauth.expiryDate ?? "—");

  return (
    <KvGrid
      entries={[
        ["Connected", "yes"],
        ["Token expires", expiryDisplay],
        ["Last refresh", oauth.lastRefresh ? formatTimeAgo(oauth.lastRefresh) : "—"],
        ["Scope", oauth.scope ?? "—"],
      ]}
    />
  );
}

function parseExpiry(raw: string): Date | null {
  // Try ISO first, then millisecond-epoch string.
  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return new Date(n);
  return null;
}
