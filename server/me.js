/**
 * A signed-in developer's own word, public on purpose:
 *  - never: no coin may be launched that pays them (the whole account);
 *  - neverRepos: no coin on these repos at all (only repos they own or committed to);
 *  - yes: they are in, and every coin that pays them says so.
 * A coin that already exists cannot be undone (pump locks its split): it shows their word instead.
 */
import { ok, bad, route, body } from "./lib/http.js";
import { openStore, personKey } from "./lib/store.js";
import { session } from "./lib/session.js";
import { CONSENT_KEY, emptyConsent } from "./lib/target.js";
import { readRepo, gh } from "./lib/github.js";
import { parseRepo } from "../shared/rules.js";

async function mayClose(user, input) {
  const parsed = parseRepo(input);
  if (!parsed) throw new Error(`${input} is not owner/repo`);
  const repo = await readRepo(parsed.owner, parsed.name);
  if (!repo) throw new Error(`there is no public repo at ${input}`);
  if (repo.owner.id === user.id) return repo;
  const list = (await gh(`/repos/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}/contributors?per_page=100`)) || [];
  if (Array.isArray(list) && list.some((c) => String(c.id) === user.id)) return repo;
  throw new Error(`you can only close repos you own or committed to; ${repo.fullName} is neither`);
}

const view = (o) => ({ never: !!o.never, yes: !!o.yes, neverRepos: o.neverRepos || [] });

export const handler = route(async (req, res) => {
  const user = session(req);
  if (!user) return ok(res, { signedIn: false });
  const store = openStore();
  const own = (await store.read(personKey(user.id), null)) || {};
  if (req.method !== "POST") return ok(res, { signedIn: true, user, word: view(own) });

  const input = await body(req);
  const next = { ...own, login: user.login };
  if (typeof input.never === "boolean") next.never = input.never;
  if (typeof input.yes === "boolean") next.yes = input.yes;
  if (next.never && next.yes) return bad(res, "you cannot be both in and never");
  if (Array.isArray(input.neverRepos)) {
    if (input.neverRepos.length > 50) return bad(res, "fifty repos at most");
    const repos = [];
    for (const r of input.neverRepos) {
      const repo = await mayClose(user, r);
      repos.push({ id: repo.id, fullName: repo.fullName });
    }
    next.neverRepos = repos;
  }
  next.updatedAt = new Date().toISOString();
  await store.write(personKey(user.id), next);

  // the one document the launch route reads
  const consent = { ...emptyConsent(), ...((await store.read(CONSENT_KEY, null)) || {}) };
  const without = (list, v) => list.filter((x) => x !== v);
  consent.never.users = next.never ? [...new Set([...consent.never.users, user.id])] : without(consent.never.users, user.id);
  consent.yes = next.yes ? [...new Set([...consent.yes, user.id])] : without(consent.yes, user.id);
  const before = new Set((own.neverRepos || []).map((r) => r.id));
  consent.never.repos = [...new Set([...consent.never.repos.filter((id) => !before.has(id)), ...(next.neverRepos || []).map((r) => r.id)])];
  await store.write(CONSENT_KEY, consent);
  return ok(res, { signedIn: true, user, word: view(next) });
});

export default handler;
