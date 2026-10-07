// Schedule after completion, never concurrently or in a hidden browser tab.
// Returning null stops retries until the caller explicitly starts a new poll.
export function startVisiblePolling(read: () => Promise<number | null>, initialDelay = 0) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false, inFlight = false;
  let nextAt = Date.now() + initialDelay;
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!stopped && !inFlight && !document.hidden) timer = setTimeout(tick, Math.max(0, nextAt - Date.now()));
  }
  async function tick() {
    timer = undefined;
    if (stopped || document.hidden) return;
    inFlight = true;
    try {
      const delay = await read();
      if (delay === null) stopped = true;
      else nextAt = Date.now() + delay;
    } catch { stopped = true; }
    finally { inFlight = false; schedule(); }
  }
  document.addEventListener('visibilitychange', schedule);
  schedule();
  return () => { stopped = true; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', schedule); };
}
