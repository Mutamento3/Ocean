import { useEffect, useState } from "react";

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function storageKey(scope: string, date: string) {
  return `ocean:daily-duration:${scope}:${date}`;
}

function readDuration(scope: string, date: string) {
  try {
    const value = Number(window.localStorage.getItem(storageKey(scope, date)) ?? 0);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

export function formatDailyDuration(seconds: number) {
  if (seconds < 60) return "0 H";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} min`;
  const hours = seconds / 3_600;
  return `${hours >= 10 ? Math.floor(hours) : hours.toFixed(1).replace(/\.0$/, "")} H`;
}

/**
 * Accumulates foreground time into a local-calendar-day bucket. A scope only
 * advances while its room mode is active and the document is visible.
 */
export function useDailyDuration(scope: string, active: boolean) {
  const [state, setState] = useState(() => {
    const date = localDateKey();
    return { date, seconds: readDuration(scope, date) };
  });

  useEffect(() => {
    const date = localDateKey();
    setState({ date, seconds: readDuration(scope, date) });
  }, [scope]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setState((current) => {
        const date = localDateKey();
        const seconds = date === current.date ? current.seconds + 1 : 1;
        try { window.localStorage.setItem(storageKey(scope, date), String(seconds)); } catch { /* local persistence is best-effort */ }
        return { date, seconds };
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [active, scope]);

  return state.seconds;
}
