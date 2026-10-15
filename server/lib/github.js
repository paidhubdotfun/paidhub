/**
 * GitHub, read only and public only. A coin pays numeric GitHub ids (they never change; logins do),
 * and a repo is known by its numeric id (it survives renames and transfers).
 *
 * Who gets paid:
 *  - a repo of a person's own account: that person;
 *  - a repo of an organisation: up to three people with the most commits, never the organisation
 *    itself (pump loses fees routed to an organisation id), never a bot;
 *  - nobody younger than 90 days.
 *
 * Auth, best first: a token (the keeper on this PC), the paidhub OAuth app's id + secret (5 000
 * requests an hour for public data, what the site uses), nothing (60 an hour per address).
 */
import { PEOPLE } from "../../shared/rules.js";

const API = "https://api.github.com";
const DAY = 86_400_000;

function authHeader() {
  const token = process.env.PH_GITHUB_TOKEN;
  if (token) return { authorization: `Bearer ${token}` };
  const id = process.env.PH_GH_CLIENT_ID;
  const secret = process.env.PH_GH_CLIENT_SECRET;
  if (id && secret) return { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` };
  return {};
}

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function gh(path, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${API}${path}`, {
    headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "paidhub", ...authHeader() },
  });
  if (res.status === 404) return null;
  if (res.status === 202) return { pending: true }; // stats being computed
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get("x-ratelimit-reset") || 0);
    const wait = reset ? Math.max(1, Math.round(reset - Date.now() / 1000)) : 60;
    throw new GitHubError(`GitHub is rate limiting the pad right now; try again in ${Math.ceil(wait / 60)} min`, 429);
  }
  if (!res.ok) throw new GitHubError(`GitHub answered ${res.status}`, res.status);
  return res.json();
}

const isBot = (u) => !u || u.type === "Bot" || /\[bot\]$|-bot$|^dependabot|^renovate/i.test(u.login || "");

/** The repo as the pad cares about it, or null. Follows renames (GitHub redirects old names). */
export async function readRepo(owner, name, opts) {
  const r = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, opts);
  if (!r || !r.id) return null;
  return shapeRepo(r);
}

function shapeRepo(r) {
  return {
    id: String(r.id),
    owner: { id: String(r.owner.id), login: r.owner.login, type: r.owner.type, avatar: r.owner.avatar_url },
    name: r.name,
    fullName: r.full_name,
    url: r.html_url,
    description: r.description || "",
    homepage: r.homepage || "",
    stars: r.stargazers_count || 0,
    forks: r.forks_count || 0,
    license: r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? r.license.spdx_id : "",
    fork: !!r.fork,
    archived: !!r.archived,
    private: !!r.private,
    createdAt: r.created_at,
    pushedAt: r.pushed_at,
    topics: r.topics || [],
    language: r.language || "",
  };
}

export async function readUser(idOrLogin, opts) {
  const path = /^\d+$/.test(String(idOrLogin)) ? `/user/${idOrLogin}` : `/users/${encodeURIComponent(idOrLogin)}`;
  const u = await gh(path, opts);
  if (!u || !u.id) return null;
  return {
    id: String(u.id),
    login: u.login,
    type: u.type,
    name: u.name || "",
    avatar: u.avatar_url,
    createdAt: u.created_at,
    x: u.twitter_username || "",
    url: u.html_url,
  };
}

const oldEnough = (u, now) => u && Date.parse(u.createdAt) <= now - PEOPLE.minAgeDays * DAY;

/**
 * Who a coin on this repo pays, in pay order, each with why. Throws a plain sentence when nobody can
 * be paid (a fork, a bot, accounts too young, an organisation with no eligible contributor).
 */
export async function peopleFor(repo, { now = Date.now(), fetchImpl, skip = new Set() } = {}) {
  const opts = { fetchImpl };
  if (repo.private) throw new Error("that repo is private");
  if (repo.fork) throw new Error("that repo is a fork: launch the original, the people who wrote it get paid");

  if (repo.owner.type === "User") {
    const u = await readUser(repo.owner.id, opts);
    if (!u) throw new Error("the repo's owner account is gone");
    if (isBot(u)) throw new Error("the repo belongs to a bot");
    if (!oldEnough(u, now)) throw new Error(`the owner's GitHub account is younger than ${PEOPLE.minAgeDays} days`);
    if (skip.has(u.id)) throw new Error(`${u.login} asked never to be launched`);
    return [{ ...u, why: "owner" }];
  }

  // an organisation: the people with the most commits
  const list = (await gh(`/repos/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}/contributors?per_page=30`, opts)) || [];
  if (!Array.isArray(list) || !list.length) throw new Error("GitHub lists no contributors for that repo yet");
  const people = [];
  for (const c of list) {
    if (people.length >= PEOPLE.max) break;
    if (c.type !== "User" || isBot(c)) continue;
    if ((c.contributions || 0) < PEOPLE.minCommits) break; // sorted by commits: everyone after has fewer
    if (skip.has(String(c.id))) continue;
    const u = await readUser(c.id, opts);
    if (!u || u.type !== "User" || !oldEnough(u, now)) continue;
    people.push({ ...u, why: "commits", commits: c.contributions });
  }
  if (!people.length) throw new Error("nobody in that organisation's repo can be paid: no person with 3+ commits and an account over 90 days old");
  return people;
}

/** Stars per day for the last `days` days, from GitHub's privacy-safe star history endpoint (2026-09). */
export async function starHistory(owner, name, { days = 14, fetchImpl } = {}) {
  const r = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/stargazers/history?per_page=${Math.ceil(days / 7) + 1}`, { fetchImpl }).catch(() => null);
  if (!r || r.pending || !Array.isArray(r)) return null;
  // [{week: unix start, total, days: [7 counts]}], newest week first; days after today read 0
  const today = Date.now() / 1000;
  const perDay = [];
  for (const w of [...r].sort((a, b) => a.week - b.week)) {
    (w.days || []).forEach((n, i) => {
      if (w.week + i * 86400 <= today) perDay.push(Number(n) || 0);
    });
  }
  return perDay.slice(-days);
}
