import type { EngineStatePath } from "#web/lib/types.js";

export function AuthBanner({ state }: { state: EngineStatePath }) {
  if (state !== "active.blocked.awaitingAuth") return null;

  return (
    <div className="border-b border-yellow-300 bg-yellow-50 text-yellow-900 dark:border-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-100">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2 text-sm sm:px-6">
        <div>
          <span className="font-medium">YouTube authentication required.</span>{" "}
          <span className="opacity-90">
            Uploads are paused until you reconnect. This usually happens when the refresh token has
            been revoked or expired.
          </span>
        </div>
        <a
          href="/api/oauth/connect"
          className="rounded bg-yellow-600 px-3 py-1 text-xs font-medium whitespace-nowrap text-white hover:bg-yellow-700"
        >
          Connect YouTube
        </a>
      </div>
    </div>
  );
}
