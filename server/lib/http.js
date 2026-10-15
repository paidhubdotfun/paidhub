// The same small shape for every route, so the suite can call them with a mock req/res and the
// browser gets honest errors instead of a stack trace.
export function json(res, status, body, cache = 0) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader(
    "cache-control",
    cache ? `public, s-maxage=${cache}, stale-while-revalidate=${cache * 4}` : "no-store"
  );
  res.end(JSON.stringify(body));
  return res;
}

export const ok = (res, body, cache = 0) => json(res, 200, { ok: true, ...body }, cache);
export const bad = (res, message, status = 400) => json(res, status, { ok: false, error: message });

export async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export function query(req, name) {
  if (req.query && name in req.query) return req.query[name];
  const url = new URL(req.url || "/", "http://local");
  return url.searchParams.get(name);
}

/** Wrap a handler so a thrown error is one honest line, never a 500 with a stack in it. */
export const route = (handler) => async (req, res) => {
  try {
    return await handler(req, res);
  } catch (e) {
    const message = String(e?.message || e);
    const status = /not configured|not set|no RPC/.test(message) ? 503 : 400;
    return bad(res, message, status);
  }
};
