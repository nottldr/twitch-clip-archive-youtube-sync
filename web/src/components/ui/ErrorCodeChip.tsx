type Tone = "fatal" | "transient" | "input";

const TONE_CLASSES: Record<Tone, string> = {
  // Permanent / user-actionable: clip rejected, missing file, malformed request.
  fatal: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
  // Likely to clear on its own / on retry: quota, rate-limit, network blips, 5xx.
  transient: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  // Input-shape / auth issues that need a non-clip action.
  input: "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100",
};

const CODE_TONES: Record<string, Tone> = {
  REJECTED: "fatal",
  BAD_REQUEST: "fatal",
  FILE_NOT_FOUND: "fatal",
  QUOTA_EXCEEDED: "transient",
  UPLOAD_LIMIT_EXCEEDED: "transient",
  RATE_LIMITED: "transient",
  SERVER_ERROR: "transient",
  NETWORK_ERROR: "transient",
  UNAUTHORIZED: "input",
  FILE_TOO_SMALL: "input",
};

interface Props {
  code: string;
  title?: string;
}

export function ErrorCodeChip({ code, title }: Props) {
  const tone = CODE_TONES[code] ?? "input";
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide uppercase ${TONE_CLASSES[tone]}`}
      title={title ?? code}
    >
      {code}
    </span>
  );
}
