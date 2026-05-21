import type { ReactNode } from "react";

interface Props {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  tone?: "neutral" | "success";
}

export function EmptyState({ icon, title, hint, tone = "neutral" }: Props) {
  const toneCls =
    tone === "success" ? "text-green-700 dark:text-green-300" : "text-gray-500 dark:text-gray-400";
  return (
    <div
      className={`flex flex-col items-center justify-center gap-1 py-8 text-center text-sm ${toneCls}`}
    >
      {icon && <div className="text-2xl leading-none">{icon}</div>}
      <div className="font-medium">{title}</div>
      {hint && <div className="text-xs opacity-80">{hint}</div>}
    </div>
  );
}
