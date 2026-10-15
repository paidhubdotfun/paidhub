// The site's reads and writes, all through its own /api routes.
const cache = new Map();

export async function api(path, { method = "GET", body, ttl = 0 } = {}) {
  const key = `${method} ${path}`;
  const hit = cache.get(key);
  if (method === "GET" && ttl && hit && Date.now() - hit.at < ttl) return hit.value;
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new Error("the pad did not answer: check your connection and try again");
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`the pad answered ${res.status} without data`);
  }
  if (!res.ok || json.ok === false) throw new Error(json.error || `the pad answered ${res.status}`);
  if (method === "GET" && ttl) cache.set(key, { at: Date.now(), value: json });
  return json;
}

export const front = () => api("/api/state?part=front", { ttl: 20_000 });
export const board = () => api("/api/state?part=board", { ttl: 60_000 });
export const scout = () => api("/api/state?part=scout", { ttl: 300_000 });
export const repo = (r, wallet = "") => api(`/api/repo?repo=${encodeURIComponent(r)}${wallet ? `&wallet=${wallet}` : ""}`);
export const coinByRepo = (r) => api(`/api/coin?repo=${encodeURIComponent(r)}`, { ttl: 15_000 });
export const person = (login, anywhere = false) => api(`/api/person?login=${encodeURIComponent(login)}${anywhere ? "&anywhere=1" : ""}`, { ttl: 30_000 });
export const me = () => api("/api/me");
export const saveMe = (body) => api("/api/me", { method: "POST", body });
