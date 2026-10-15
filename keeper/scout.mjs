/**
 * The scout: once a day, the repos a launcher might want, from real signals only.
 *
 *  - candidates: GitHub search, repos made in the last 30 days with 50+ stars, and older repos pushed
 *    this week with 300+ stars;
 *  - the signal: stars gained in the last 7 days, from GitHub's own star history endpoint;
 *  - the filter: someone payable (an owner, or people with commits, accounts over 90 days), not closed
 *    by its people, no coin on paidhub yet;
 *  - one plain paragraph per repo from a small model (OpenRouter, the product's own key), saying what it
 *    does and why people star it now. The numbers never come from the model.
 */
import { gh, readRepo, peopleFor, starHistory } from "../server/lib/github.js";
import { repoKey } from "../server/lib/store.js";
import { CONSENT_KEY } from "../server/lib/target.js";

const DAY = 86_400_000;
const PICKS = 20;
const MODEL = process.env.PH_SCOUT_MODEL || "anthropic/claude-haiku-5.5";

export function makeScout({ store, log = () => {}, now = () => Date.now(), openrouterKey = process.env.OPENROUTER_API_KEY, fetchImpl = fetch } = {}) {
  return async function scout() {
    const day = (n) => new Date(now() - n * DAY).toISOString().slice(0, 10);
    const queries = [`created:>${day(30)} stars:>50`, `pushed:>${day(7)} stars:>300 created:>${day(365)}`];
    const seen = new Map();
    for (const q of queries) {
      const r = await gh(`/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=60`).catch((e) => (log(`scout search: ${e.message}`), null));
      for (const it of r?.items || []) if (!it.fork && !it.private && !it.archived) seen.set(String(it.id), it);
    }
    const consent = (await store.read(CONSENT_KEY, null)) || { never: { users: [], repos: [] } };
    const closedRepos = new Set(consent.never?.repos || []);
    const skip = new Set(consent.never?.users || []);

    // star growth for every candidate, then the payable check only for the strongest
    const ranked = [];
    for (const it of seen.values()) {
      if (closedRepos.has(String(it.id))) continue;
      if (await store.read(repoKey(String(it.id)), null)) continue;
      const days = await starHistory(it.owner.login, it.name, { days: 7 });
      if (!days) continue;
      const week = days.reduce((s, n) => s + n, 0);
      if (week < 30) continue;
      ranked.push({ it, week, days });
    }
    ranked.sort((a, b) => b.week - a.week);

    const items = [];
    for (const { it, week, days } of ranked) {
      if (items.length >= PICKS) break;
      const repo = await readRepo(it.owner.login, it.name).catch(() => null);
      if (!repo) continue;
      let people;
      try {
        people = await peopleFor(repo, { skip });
      } catch {
        continue;
      }
      items.push({
        id: repo.id,
        fullName: repo.fullName,
        url: repo.url,
        description: repo.description,
        language: repo.language,
        license: repo.license,
        stars: repo.stars,
        week,
        days,
        createdAt: repo.createdAt,
        pushedAt: repo.pushedAt,
        people: people.map((p) => ({ id: p.id, login: p.login, avatar: p.avatar, x: p.x, why: p.why, commits: p.commits || 0 })),
        note: "",
      });
    }

    if (openrouterKey) {
      for (const item of items) {
        try {
          item.note = await noteFor(item, { openrouterKey, fetchImpl });
        } catch (e) {
          log(`scout note for ${item.fullName}: ${e.message}`);
        }
      }
    }
    return { model: openrouterKey ? MODEL : "", items, checked: seen.size };
  };
}

async function readme(item) {
  const r = await gh(`/repos/${item.fullName}/readme`).catch(() => null);
  if (!r?.content) return "";
  return Buffer.from(r.content, "base64").toString("utf8").replace(/<[^>]+>/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\s+/g, " ").slice(0, 2500);
}

async function noteFor(item, { openrouterKey, fetchImpl }) {
  const text = await readme(item);
  const prompt =
    `Repo: ${item.fullName}\nDescription: ${item.description || "(none)"}\nLanguage: ${item.language || "?"}\n` +
    `Stars: ${item.stars} total, ${item.week} in the last 7 days\nREADME excerpt: ${text}\n\n` +
    "In two plain sentences for a non-developer: what this repo does, and why people are starring it this week. " +
    "No hype words, no emojis, no price talk, no advice, no numbers beyond the ones given.";
  const res = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${openrouterKey}`, "content-type": "application/json", "x-title": "paidhub scout" },
    // no hidden reasoning: the whole budget goes to the two sentences
    body: JSON.stringify({ model: MODEL, max_tokens: 400, temperature: 0.3, reasoning: { enabled: false }, messages: [{ role: "user", content: prompt }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message || `OpenRouter ${res.status}`);
  const msg = j.choices?.[0]?.message || {};
  const answer = Array.isArray(msg.content) ? msg.content.map((p) => p.text || "").join("") : String(msg.content || "");
  if (!answer.trim()) throw new Error(`empty answer (finish: ${j.choices?.[0]?.finish_reason || "?"})`);
  // whole sentences only: a long answer is cut at the last full stop that fits
  const flat = answer.trim().replace(/\s+/g, " ");
  if (flat.length <= 520) return flat;
  const cut = flat.slice(0, 520);
  const end = cut.lastIndexOf(". ");
  return end > 120 ? cut.slice(0, end + 1) : `${cut.slice(0, 517)}...`;
}
