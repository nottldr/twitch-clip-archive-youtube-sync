import { useEffect, useState } from "react";

/** Returns milliseconds remaining until the target time. Updates every second. */
export function useCountdown(targetIso: string): number {
  const [remaining, setRemaining] = useState(() => new Date(targetIso).getTime() - Date.now());

  useEffect(() => {
    const target = new Date(targetIso).getTime();
    setRemaining(target - Date.now());

    const interval = setInterval(() => {
      const ms = target - Date.now();
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
