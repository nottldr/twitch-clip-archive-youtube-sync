import { Temporal } from "@js-temporal/polyfill";
import { useEffect, useState } from "react";

import { parseInstant } from "#web/lib/time.js";

function remainingMs(targetIso: string): number {
  return parseInstant(targetIso).since(Temporal.Now.instant()).total({ unit: "millisecond" });
}

/** Returns milliseconds remaining until the target time. Updates every second. */
export function useCountdown(targetIso: string): number {
  const [remaining, setRemaining] = useState(() => remainingMs(targetIso));

  useEffect(() => {
    setRemaining(remainingMs(targetIso));

    const interval = setInterval(() => {
      const ms = remainingMs(targetIso);
      setRemaining(ms);
      if (ms <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [targetIso]);

  return remaining;
}
