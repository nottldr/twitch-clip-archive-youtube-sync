interface Option {
  value: string;
  label: string;
  count?: number;
}

interface Props {
  options: readonly Option[];
  selected: ReadonlySet<string>;
  onToggle: (value: string) => void;
}

/**
 * Multi-select chip group. Click a chip to toggle it. Replaces the older
 * `<input type=checkbox>` pattern with a more scannable pill row that also
 * shows counts inline.
 */
export function FilterChips({ options, selected, onToggle }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((opt) => {
        const isOn = selected.has(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              onToggle(opt.value);
            }}
            aria-pressed={isOn}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              isOn
                ? "border-blue-400 bg-blue-50 text-blue-800 dark:border-blue-600 dark:bg-blue-900/40 dark:text-blue-100"
                : "border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            }`}
          >
            <span className="capitalize">{opt.label}</span>
            {opt.count !== undefined && (
              <span
                className={`ml-1.5 text-[10px] ${isOn ? "opacity-80" : "text-gray-400 dark:text-gray-500"}`}
              >
                {opt.count.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
