/**
 * From whatever a launcher pastes to the repo, the people it pays and whether it can be launched at all.
 * The launch route runs this again on the server, so nothing about who gets paid comes from a browser.
 */
import { parseRepo } from "../../shared/rules.js";
import { readRepo, peopleFor } from "./github.js";
import { repoKey, repoHoldKey } from "./store.js";

/** The people's own word, kept as one small document: who said never, which repos, who said yes. */
export const CONSENT_KEY = "consent";
export const emptyConsent = () => ({ never: { users: [], repos: [] }, yes: [] });

export const HOLD_MS = 10 * 60_000;

export async function resolveTarget(store, input, { wallet = "", fetchImpl } = {}) {
  const parsed = parseRepo(input);
  if (!parsed) throw new Error("paste a GitHub repo: github.com/owner/repo");
  const repo = await readRepo(parsed.owner, parsed.name, { fetchImpl });
  if (!repo) throw new Error(`there is no public repo at github.com/${parsed.owner}/${parsed.name}`);

  const consent = { ...emptyConsent(), ...((await store.read(CONSENT_KEY, null)) || {}) };
  if (consent.never.repos.includes(repo.id)) throw new Error(`the people behind ${repo.fullName} asked never to have it launched`);
  const people = await peopleFor(repo, { fetchImpl, skip: new Set(consent.never.users) });
  const yes = new Set(consent.yes);

  const taken = await store.read(repoKey(repo.id), null);
  const hold = await store.read(repoHoldKey(repo.id), null);
  const held = hold && hold.wallet !== wallet && Date.now() - Date.parse(hold.at) < HOLD_MS;

  return {
    repo,
    people: people.map((p) => ({ id: p.id, login: p.login, name: p.name, avatar: p.avatar, x: p.x, why: p.why, commits: p.commits || 0, yes: yes.has(p.id) })),
    taken: taken?.mint || null,
    held: !!held,
  };
}
