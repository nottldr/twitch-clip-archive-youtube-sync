export function OAuthButton({
  connected,
  onDisconnect,
}: {
  connected: boolean;
  onDisconnect: () => void;
}) {
  if (connected) {
    return (
      <button
        onClick={() => {
          void fetch("/api/oauth/disconnect", { method: "POST" }).then(() => {
            onDisconnect();
          });
        }}
        className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50"
      >
        Disconnect
      </button>
    );
  }

  return (
    <a
      href="/api/oauth/connect"
      className="inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
    >
      Connect YouTube
    </a>
  );
}
