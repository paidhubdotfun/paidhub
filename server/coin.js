/**
 * One coin's page: the pad's record, the keeper's live page (what each person was sent and claimed,
 * buybacks) and a fresh read of each person's GitHub fee account. Found by mint or by the repo
 * (paidhub.io/owner/repo, the numeric repo id behind it survives renames).
 */
import { PublicKey } from "@solana/web3.js";
import { ok, bad, route, query } from "./lib/http.js";
import { openStore, coinKey, launchKey, pageKey, repoKey, repoHoldKey } from "./lib/store.js";
import { rpc, readPerson, readSharingConfig, isLocked } from "./lib/chain.js";
import { registerIfLaunched } from "./lib/register.js";
import { readRepo } from "./lib/github.js";
import { parseRepo } from "../shared/rules.js";

export const handler = route(async (req, res) => {
  const store = openStore();
  let mint = String(query(req, "mint") || "").trim();
  const repoArg = String(query(req, "repo") || "").trim();
  let repo = null;
  if (!mint && repoArg) {
    const parsed = parseRepo(repoArg);
    if (!parsed) return bad(res, "that is not owner/repo");
    repo = await readRepo(parsed.owner, parsed.name);
    if (!repo) return ok(res, { found: false, reason: "no public repo there" }, 60);
    mint = (await store.read(repoKey(repo.id), null))?.mint || "";
    if (!mint) {
      // the last launch built for this repo may exist on chain without its split: offer to finish it
      const hold = await store.read(repoHoldKey(repo.id), null);
      const exists = hold?.mint && (await rpc().getAccountInfo(new PublicKey(hold.mint)).catch(() => null));
      if (!exists) return ok(res, { found: false, repo, reason: "no coin yet" }, 30);
      mint = hold.mint;
    }
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return bad(res, "that is not a mint address");

  const connection = rpc();
  let coin = await store.read(coinKey(mint), null);
  let unfinished = null;
  if (!coin) {
    // a launch whose last confirmation was lost: register it now if the chain shows the split locked
    const built = await store.read(launchKey(mint), null);
    if (!built) return ok(res, { found: false, reason: "not a paidhub coin" }, 30);
    const r = await registerIfLaunched(store, connection, built);
    coin = r.coin;
    if (!coin) {
      const config = await readSharingConfig(connection, mint);
      unfinished = { mint, launcher: built.launcher, locked: isLocked(config), repo: built.repo, people: built.people, name: built.name, symbol: built.symbol, image: built.image };
      return ok(res, { found: false, unfinished, reason: "the coin exists but its fees are not locked yet" });
    }
  }
  const page = await store.read(pageKey(mint), null);
  const live = await Promise.all((coin.people || []).map((p) => readPerson(connection, p.id).catch(() => null)));
  return ok(res, { found: true, coin, page, live, repo }, 15);
});

export default handler;
