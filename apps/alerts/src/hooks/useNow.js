import { useEffect, useState } from 'react';

// Returns a `Date.now()` value that refreshes on the given interval. Used to
// keep day-bucketing, "Nm ongoing" counters, and active-span overlap math
// honest as the wall clock advances — without a ticker, a tab open across
// midnight silently keeps "today" pointing at yesterday.
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
