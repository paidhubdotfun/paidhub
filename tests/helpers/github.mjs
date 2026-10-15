// A small fake GitHub, so the suite drives the pad's real routes without touching api.github.com.
// Everything else (the local chain) goes through the real fetch.
const OLD = "2019-04-01T00:00:00Z";
const DAY = 86_400_000;

export const USERS = {
  alice: { id: 1001, login: "alice", type: "User", created_at: OLD, twitter_username: "alice_codes" },
  bob: { id: 1002, login: "bob", type: "User", created_at: OLD, twitter_username: null },
  carol: { id: 1003, login: "carol", type: "User", created_at: OLD, twitter_username: "carol" },
  dave: { id: 1004, login: "dave", type: "User", created_at: new Date(Date.now() - 30 * DAY).toISOString() }, // too young
  erin: { id: 1005, login: "erin", type: "User", created_at: OLD },
  acme: { id: 2001, login: "acme", type: "Organization", created_at: OLD },
  "dependabot[bot]": { id: 9999, login: "dependabot[bot]", type: "Bot", created_at: OLD },
};

const repo = (id, owner, name, extra = {}) => ({
  id,
  name,
  full_name: `${owner}/${name}`,
  html_url: `https://github.com/${owner}/${name}`,
  owner: { id: USERS[owner].id, login: owner, type: USERS[owner].type, avatar_url: `https://avatars.example/${owner}` },
  description: `${name} does a thing`,
  stargazers_count: 1200,
  forks_count: 40,
  license: { spdx_id: "MIT" },
  fork: false,
  archived: false,
  private: false,
  created_at: "2026-09-20T00:00:00Z",
  pushed_at: "2026-10-14T00:00:00Z",
  ...extra,
});

export const REPOS = {
  "alice/tool": repo(5001, "alice", "tool"),
  "acme/engine": repo(5002, "acme", "engine"),
  "alice/forked": repo(5003, "alice", "forked", { fork: true }),
  "erin/notes": repo(5004, "erin", "notes"),
  "dave/fresh": repo(5005, "dave", "fresh"),
};

const CONTRIBUTORS = {
  "acme/engine": [
    { id: 9999, login: "dependabot[bot]", type: "Bot", contributions: 900 },
    { id: 1002, login: "bob", type: "User", contributions: 400 },
    { id: 1004, login: "dave", type: "User", contributions: 300 },
    { id: 1003, login: "carol", type: "User", contributions: 120 },
    { id: 1001, login: "alice", type: "User", contributions: 50 },
    { id: 1005, login: "erin", type: "User", contributions: 2 },
  ],
  "erin/notes": [{ id: 1005, login: "erin", type: "User", contributions: 30 }],
};

const userJson = (u) => ({ ...u, avatar_url: `https://avatars.example/${u.login}`, html_url: `https://github.com/${u.login}`, name: u.login });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function installFakeGithub() {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url || input);
    if (!url.startsWith("https://api.github.com/")) return real(input, init);
    const path = url.slice("https://api.github.com".length).split("?")[0];
    calls.push(path);
    let m;
    if ((m = path.match(/^\/repos\/([^/]+)\/([^/]+)$/))) {
      const r = REPOS[`${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`];
      return r ? json(r) : json({ message: "Not Found" }, 404);
    }
    if ((m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/contributors$/))) return json(CONTRIBUTORS[`${m[1]}/${m[2]}`] || []);
    if ((m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/stargazers\/history$/))) return json([{ week: Math.floor(Date.now() / 1000) - 3 * 86400, total: 300, days: [40, 50, 60, 70, 80, 0, 0] }]);
    if ((m = path.match(/^\/repositories\/(\d+)$/))) {
      const r = Object.values(REPOS).find((x) => String(x.id) === m[1]);
      return r ? json(r) : json({ message: "Not Found" }, 404);
    }
    if ((m = path.match(/^\/user\/(\d+)$/))) {
      const u = Object.values(USERS).find((x) => String(x.id) === m[1]);
      return u ? json(userJson(u)) : json({ message: "Not Found" }, 404);
    }
    if ((m = path.match(/^\/users\/([^/]+)$/))) {
      const u = USERS[decodeURIComponent(m[1])];
      return u ? json(userJson(u)) : json({ message: "Not Found" }, 404);
    }
    if (path === "/search/repositories") return json({ items: Object.values(REPOS) });
    if (/\/readme$/.test(path)) return json({ content: Buffer.from("# tool\nIt does a thing.").toString("base64") });
    return json({ message: "Not Found" }, 404);
  };
  return { calls, restore: () => (globalThis.fetch = real) };
}
