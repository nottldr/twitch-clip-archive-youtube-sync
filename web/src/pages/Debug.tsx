import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { fetchJson } from "#web/lib/api.js";
import { DashboardStatsSchema, EngineSnapshotSchema, QuotaHistorySchema } from "#web/lib/types.js";

const TABS = ["engine", "quota", "clips", "actions"] as const;
type Tab = (typeof TABS)[number];

export function Debug() {
  const [activeTab, setActiveTab] = useState<Tab>("engine");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Debug</h1>

      <div className="flex gap-2 border-b dark:border-gray-700">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
            }}
            className={`border-b-2 px-3 py-2 text-sm capitalize ${
              activeTab === tab
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "engine" && <EngineTab />}
      {activeTab === "quota" && <QuotaTab />}
      {activeTab === "clips" && <ClipsTab />}
      {activeTab === "actions" && <ActionsTab />}
    </div>
  );
}

function EngineTab() {
  const { data: snapshot } = useQuery({
    queryKey: ["engine", "status"],
    queryFn: () => fetchJson("/api/engine/status", EngineSnapshotSchema),
    refetchInterval: 2000,
  });

  if (!snapshot) return <div className="p-4 text-gray-400 dark:text-gray-500">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
        <h3 className="mb-2 font-medium text-gray-700 dark:text-gray-200">Current State</h3>
        <code className="rounded bg-gray-100 px-2 py-1 text-sm font-bold dark:bg-gray-700">
          {snapshot.state}
        </code>
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
        <h3 className="mb-2 font-medium text-gray-700 dark:text-gray-200">Context</h3>
        <pre className="max-h-96 overflow-auto rounded bg-gray-50 p-3 text-xs dark:bg-gray-900">
          {JSON.stringify(snapshot.context, null, 2)}
        </pre>
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
        <h3 className="mb-2 font-medium text-gray-700 dark:text-gray-200">Tasks</h3>
        <pre className="rounded bg-gray-50 p-3 text-xs dark:bg-gray-900">
          {JSON.stringify(snapshot.tasks, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function QuotaTab() {
  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => fetchJson("/api/stats", DashboardStatsSchema),
  });

  const { data: history } = useQuery({
    queryKey: ["quota", "history", "debug"],
    queryFn: () => fetchJson("/api/quota/history?days=7", QuotaHistorySchema),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
        <h3 className="mb-2 font-medium text-gray-700 dark:text-gray-200">Quota Status</h3>
        {stats ? (
          <pre className="rounded bg-gray-50 p-3 text-xs dark:bg-gray-900">
            {JSON.stringify(stats.quota, null, 2)}
          </pre>
        ) : (
          <div className="text-gray-400 dark:text-gray-500">Loading...</div>
        )}
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
        <h3 className="mb-2 font-medium text-gray-700 dark:text-gray-200">
          Recent History (7 days)
        </h3>
        {history ? (
          <pre className="max-h-64 overflow-auto rounded bg-gray-50 p-3 text-xs dark:bg-gray-900">
            {JSON.stringify(history, null, 2)}
          </pre>
        ) : (
          <div className="text-gray-400 dark:text-gray-500">Loading...</div>
        )}
      </div>
    </div>
  );
}

function ClipsTab() {
  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => fetchJson("/api/stats", DashboardStatsSchema),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
        <h3 className="mb-2 font-medium text-gray-700 dark:text-gray-200">Clip Counts</h3>
        {stats ? (
          <pre className="rounded bg-gray-50 p-3 text-xs dark:bg-gray-900">
            {JSON.stringify(stats.clips, null, 2)}
          </pre>
        ) : (
          <div className="text-gray-400 dark:text-gray-500">Loading...</div>
        )}
      </div>
    </div>
  );
}

interface ActionButton {
  label: string;
  url: string;
  danger?: boolean;
}

interface ActionGroup {
  title: string;
  actions: ActionButton[];
}

const actionGroups: ActionGroup[] = [
  {
    title: "Engine",
    actions: [
      { label: "Force re-import", url: "/api/engine/import-now" },
      { label: "Force quota discovery", url: "/api/engine/discover-now" },
      { label: "Reset quota usage", url: "/api/debug/reset-quota" },
    ],
  },
  {
    title: "Clips",
    actions: [
      { label: "Reset failed clips", url: "/api/engine/reset-failed" },
      { label: "Reset ALL clips", url: "/api/engine/reset-all", danger: true },
    ],
  },
  {
    title: "Test Data",
    actions: [
      { label: "Add 5 test clips", url: "/api/debug/add-clips?count=5" },
      { label: "Clear logs", url: "/api/logs/clear" },
    ],
  },
  {
    title: "Simulate Failures",
    actions: [
      { label: "Force next upload fail", url: "/api/debug/set-flag/fail" },
      { label: "Force quota exhausted", url: "/api/debug/set-flag/quota" },
      { label: "Force upload limit", url: "/api/debug/set-flag/uploadLimit" },
      { label: "Clear all flags", url: "/api/debug/clear-all-flags" },
    ],
  },
];

function ActionsTab() {
  const queryClient = useQueryClient();
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function runAction(url: string, label: string) {
    const res = await fetch(url, { method: "POST" });
    const json = await res.json();
    setLastResult(`${label}: ${JSON.stringify(json)}`);
    void queryClient.invalidateQueries();
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {actionGroups.map((group) => (
          <div key={group.title} className="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
            <h3 className="mb-3 text-sm font-medium text-gray-500 dark:text-gray-400">
              {group.title}
            </h3>
            <div className="flex flex-col gap-2">
              {group.actions.map((action) => (
                <button
                  key={action.url}
                  onClick={() => {
                    void runAction(action.url, action.label);
                  }}
                  className={`rounded border px-3 py-1.5 text-left text-sm dark:border-gray-700 ${
                    action.danger
                      ? "border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                      : "hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {lastResult && (
        <div className="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
          <h3 className="mb-2 text-sm font-medium text-gray-500 dark:text-gray-400">Last Result</h3>
          <pre className="rounded bg-gray-50 p-3 text-xs dark:bg-gray-900">{lastResult}</pre>
        </div>
      )}
    </div>
  );
}
