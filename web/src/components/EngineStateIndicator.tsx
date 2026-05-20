import { useCountdown } from "#web/hooks/use-countdown.js";
import type { EngineSnapshot, EngineStatePath } from "#web/lib/types.js";

interface StateDisplay {
  label: string;
  colour: string;
  extra?: string;
  showCountdown?: boolean;
}

const stateDisplayMap: Record<EngineStatePath, (ctx: EngineSnapshot["context"]) => StateDisplay> = {
  stopped: () => ({
    label: "Stopped",
    colour: "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100",
  }),
  "starting.importingArchive": () => ({
    label: "Importing archive...",
    colour: "bg-blue-100 text-blue-800 animate-pulse",
  }),
  "starting.discoveringQuota": () => ({
    label: "Checking quota...",
    colour: "bg-blue-100 text-blue-800 animate-pulse",
  }),
  "starting.settling": () => ({
    label: "Starting...",
    colour: "bg-blue-100 text-blue-800 animate-pulse",
  }),
  "active.blocked.awaitingAuth": () => ({
    label: "Awaiting auth",
    colour: "bg-yellow-100 text-yellow-800",
  }),
  "active.blocked.userPaused": () => ({
    label: "Paused",
    colour: "bg-orange-100 text-orange-800",
  }),
  "active.deciding": () => ({
    label: "Selecting...",
    colour: "bg-blue-100 text-blue-800 animate-pulse",
  }),
  "active.uploading": (ctx) => ({
    label: ctx.clipTitle ? `Uploading: ${ctx.clipTitle}` : "Uploading...",
    colour: "bg-blue-100 text-blue-800",
  }),
  "active.reimporting": () => ({
    label: "Re-importing archive...",
    colour: "bg-blue-100 text-blue-800 animate-pulse",
  }),
  "active.rediscovering": () => ({
    label: "Checking quota...",
    colour: "bg-blue-100 text-blue-800 animate-pulse",
  }),
  "active.waiting.quotaExhausted": () => ({
    label: "Quota exhausted",
    colour: "bg-red-100 text-red-800",
    showCountdown: true,
  }),
  "active.waiting.quotaProbing": () => ({
    label: "Probing quota…",
    colour: "bg-amber-100 text-amber-800 animate-pulse",
  }),
  "active.waiting.uploadLimit": () => ({
    label: "Upload limit",
    colour: "bg-orange-100 text-orange-800",
    showCountdown: true,
  }),
  "active.waiting.cooldown": () => ({
    label: "Cooldown",
    colour: "bg-blue-100 text-blue-800",
    showCountdown: true,
  }),
  "active.waiting.noClips": () => ({
    label: "No clips to upload",
    colour: "bg-green-100 text-green-800",
    showCountdown: true,
  }),
  "active.waiting.error": (ctx) => ({
    label: ctx.lastError ? `Error: ${ctx.lastError.slice(0, 50)}` : "Error",
    colour: "bg-red-100 text-red-800",
    showCountdown: true,
  }),
};

function Countdown({ resumeAt }: { resumeAt: string }) {
  const remaining = useCountdown(resumeAt);
  if (remaining <= 0) return null;

  const seconds = Math.ceil(remaining / 1000);
  if (seconds > 3600) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return (
      <span className="ml-1 text-xs opacity-70">
        ({hours}h {mins}m)
      </span>
    );
  }
  if (seconds > 60) {
    const mins = Math.floor(seconds / 60);
    return <span className="ml-1 text-xs opacity-70">({mins}m)</span>;
  }
  return <span className="ml-1 text-xs opacity-70">({seconds}s)</span>;
}

export function EngineStateIndicator({ snapshot }: { snapshot: EngineSnapshot }) {
  const displayFn = stateDisplayMap[snapshot.state];
  const display = displayFn(snapshot.context);

  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${display.colour}`}
    >
      <span className="max-w-[12rem] truncate">{display.label}</span>
      {display.showCountdown && snapshot.context.waitResumeAt && (
        <Countdown resumeAt={snapshot.context.waitResumeAt} />
      )}
    </span>
  );
}
