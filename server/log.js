// The error journal's door. The site posts what failed (a launch, a
// wallet refusal, a script error); this keeps it as one small file in the pad's store. Same-origin
// only, a few reports a minute per visitor, no IP and no wallet address stored. Read it with
// the ops journal reader.
import crypto from "node:crypto";
import { ok, bad, route, body } from "./lib/http.js";
import { openStore } from "./lib/store.js";

const seen = new Map();
const WINDOW_MS = 60_000;
const PER_WINDOW = 6;

export const handler = route(async (req, res) => {
  if (req.method && req.method !== "POST") return bad(res, "post a report here", 405);
  const origin = String(req.headers?.origin || "");
  const host = String(req.headers?.host || "");
  if (origin && host && !origin.endsWith(`//${host}`)) return bad(res, "reports come from the site itself", 403);

  // rate limit by a hash of the address, kept in memory only for a minute
  const who = crypto.createHash("sha256").update(String(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "")).digest("hex").slice(0, 16);
  const now = Date.now();
  const list = (seen.get(who) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= PER_WINDOW) return bad(res, "too many reports", 429);
  list.push(now);
  seen.set(who, list);
  if (seen.size > 5000) seen.clear();

  const input = await body(req);
  const clean = (v, n) => String(v ?? "").replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, (m) => `${m.slice(0, 4)}..`).slice(0, n);
  const entry = {
    kind: clean(input.kind, 40),
    page: clean(input.page, 120),
    at: new Date().toISOString(),
    detail: Object.fromEntries(Object.entries(input.detail || {}).slice(0, 8).map(([k, v]) => [clean(k, 40), clean(v, 1500)])),
  };
  const key = `logs/${entry.at.replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
  await openStore().write(key, entry);
  return ok(res, { kept: true });
});

export default handler;
