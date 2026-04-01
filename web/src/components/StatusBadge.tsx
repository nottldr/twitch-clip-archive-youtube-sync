const colors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  uploading: "bg-blue-100 text-blue-800",
  uploaded: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  skipped: "bg-gray-100 text-gray-800",
  running: "bg-green-100 text-green-800",
  idle: "bg-yellow-100 text-yellow-800",
  paused: "bg-orange-100 text-orange-800",
  error: "bg-red-100 text-red-800",
  stopped: "bg-gray-100 text-gray-800",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = colors[status] ?? "bg-gray-100 text-gray-800";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>
  );
}
