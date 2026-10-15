// The site's own error journal: a failed launch, a wallet that said
// no, a script error. Each report goes to /api/log, which keeps the last thousand; no address and
// no IP is stored, only what failed and where.
let sent = 0;

export function report(kind, detail = {}) {
  if (sent > 20) return; // one broken page must not flood the journal
  sent += 1;
  try {
    const body = JSON.stringify({
      kind,
      page: location.pathname,
      at: new Date().toISOString(),
      detail: Object.fromEntries(
        Object.entries(detail).map(([k, v]) => [k, String(v instanceof Error ? v.message : v).slice(0, 1500)])
      ),
    });
    const queued = navigator.sendBeacon?.("/api/log", new Blob([body], { type: "application/json" }));
    if (!queued) fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
  } catch {
    /* the journal is best effort and never breaks the page */
  }
}

export function watchErrors() {
  window.addEventListener("error", (e) => {
    if (!e.filename || !e.filename.startsWith(location.origin)) return;
    report("script", { message: e.message, at: `${e.filename}:${e.lineno}` });
  });
  window.addEventListener("unhandledrejection", (e) => report("promise", { message: e.reason?.message || e.reason }));
}
