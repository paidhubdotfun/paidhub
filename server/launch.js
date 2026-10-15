/**
 * The launch form's route: a coin on a GitHub repo. It resolves the repo and the people it pays again
 * (never from the browser), stores the coin's picture and metadata where pump reads them (with the X and
 * website fields), builds the two transactions the launcher's wallet signs and records what this mint
 * was built for. It signs nothing itself except the mint, which has to sign its own creation.
 *
 * The metadata is hosted by the pad, not on pump's IPFS: pump answers 403 to data centre addresses,
 * and create_v2 takes any uri; pump's front end reads `twitter` and `website` from it.
 */
import crypto from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { ok, bad, route, body } from "./lib/http.js";
import { rpc, SHARES } from "./lib/chain.js";
import { buildLaunch, DEV_BUY } from "./lib/launch.js";
import { loadLookupTable } from "./lib/alt.js";
import { putPublic } from "./lib/blob.js";
import { mintFor } from "./lib/secret.js";
import { openStore, launchKey, pendingKey, repoHoldKey } from "./lib/store.js";
import { resolveTarget } from "./lib/target.js";
import { checkLaunch, devShares } from "../shared/rules.js";

const MAX_IMAGE = 1_500_000;
const REUSE_MS = 60 * 60 * 1000;
// a light brake per address on this instance: a person launches a few coins an hour, not hundreds
const BUILDS_PER_HOUR = 30;
const recent = new Map();
function braked(req) {
  const ip = String(req.headers?.["x-real-ip"] || req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  if (!ip) return false;
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < 3600_000);
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  return list.length > BUILDS_PER_HOUR;
}
// rent of the mint, the curve, the ATAs, the fee sharing config and up to three GitHub fee accounts, plus fees
const LAUNCH_OVERHEAD = 35_000_000;

export const handler = route(async (req, res) => {
  if (req.method && req.method !== "POST") return bad(res, "post the form here", 405);
  if (braked(req)) return bad(res, "too many launches from here in the last hour; try again later", 429);
  const input = await body(req);

  let user;
  try {
    user = new PublicKey(String(input.wallet || "").trim());
  } catch {
    return bad(res, "connect a wallet first");
  }

  const store = openStore();
  const target = await resolveTarget(store, input.repo, { wallet: user.toBase58() });
  if (target.taken) return bad(res, `${target.repo.fullName} already has its coin on paidhub`);
  if (target.held) return bad(res, `someone is launching ${target.repo.fullName} right now; look again in a few minutes`);

  let form;
  try {
    form = checkLaunch(input, target.repo);
  } catch (e) {
    return bad(res, e.message);
  }
  const devBuy = Math.round(Number(input.devBuyLamports || 0));
  if (!(devBuy >= DEV_BUY.min && devBuy <= DEV_BUY.max)) {
    return bad(res, `the first buy is between ${DEV_BUY.min / 1e9} and ${DEV_BUY.max / 1e9} SOL`);
  }

  const m = String(input.image || "").match(/^data:(image\/(png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return bad(res, "the coin needs a picture: png, jpeg, webp or gif");
  const imageBytes = Buffer.from(m[3], "base64");
  if (imageBytes.length > MAX_IMAGE) return bad(res, "the picture is over 1.5 MB");

  const connection = rpc();
  const lookupTable = await loadLookupTable(connection, process.env.PH_LOOKUP_TABLE);
  if (!lookupTable) return bad(res, "launching opens when the pad's lookup table is on chain", 503);

  const balance = await connection.getBalance(user);
  if (balance < devBuy + LAUNCH_OVERHEAD) {
    return bad(res, `this wallet holds ${(balance / 1e9).toFixed(3)} SOL; a launch needs about ${((devBuy + LAUNCH_OVERHEAD) / 1e9).toFixed(3)}`);
  }

  // a rebuild of the SAME coin (every field and the picture alike) within the hour reuses the mint, so a
  // lost signature never makes two coins; anything different is a new mint, so nobody who knows a wallet
  // and a ticker can rewrite what that wallet is about to sign. The mint key is derived from a
  // server-only secret and never stored.
  const content = crypto
    .createHash("sha256")
    .update(JSON.stringify([target.repo.id, target.people.map((p) => p.id).join(","), form.name, form.symbol, form.description, form.twitter, form.website, crypto.createHash("sha256").update(imageBytes).digest("hex")]))
    .digest("hex");
  const pending = await store.read(pendingKey(user.toBase58()), null);
  const reuse = pending && !pending.landed && pending.content === content && Date.now() - Date.parse(pending.at) < REUSE_MS ? pending : null;
  const nonce = reuse ? reuse.nonce : crypto.randomBytes(8).toString("hex");
  const mintKey = mintFor(user.toBase58(), form.symbol, nonce);
  if (reuse && (await connection.getAccountInfo(mintKey.publicKey))) {
    return bad(res, "this coin is already on chain: finish it from its page instead of launching again");
  }
  const mint = mintKey.publicKey.toBase58();
  const site = String(process.env.PH_SITE_URL || "").replace(/\/$/, "");
  const page = site ? `${site}/${target.repo.fullName}` : "";
  const website = form.website || page;
  const shares = devShares(target.people.length);
  const names = target.people.map((p) => `@${p.login}`).join(", ");

  const image = await putPublic(`coins/${mint}.${m[2] === "jpeg" ? "jpg" : m[2]}`, imageBytes, m[1]);
  const metadata = {
    name: form.name,
    symbol: form.symbol,
    description:
      (form.description ? `${form.description}

` : "") +
      `A community coin for github.com/${target.repo.fullName}. Half of its creator fees go to ${names} through pump's GitHub fee accounts, which only they can claim. The developers have not endorsed this coin unless paidhub marks them as in.`,
    image,
    showName: true,
    twitter: form.twitter,
    website,
    createdOn: site || "https://paidhub.io",
    attributes: [
      { trait_type: "Repo", value: `github.com/${target.repo.fullName}` },
      ...target.people.map((p, i) => ({ trait_type: "Pays", value: `@${p.login} ${shares[i] / 100}%` })),
    ],
  };
  const uri = await putPublic(`metadata/${mint}.json`, Buffer.from(JSON.stringify(metadata)), "application/json");

  const built = await buildLaunch({
    connection,
    user,
    people: target.people.map((p) => p.id),
    name: form.name,
    symbol: form.symbol,
    uri,
    devBuyLamports: devBuy,
    lookupTable,
    mintKey,
  });

  // what this mint was built for, written by the pad itself: /api/send registers the coin from
  // this record, never from what a browser posts
  await store.write(launchKey(mint), {
    mint,
    launcher: user.toBase58(),
    name: form.name,
    symbol: form.symbol,
    description: metadata.description,
    image,
    uri,
    twitter: form.twitter,
    website,
    repo: { id: target.repo.id, fullName: target.repo.fullName, url: target.repo.url, owner: target.repo.owner.login, name: target.repo.name },
    people: target.people,
    builtAt: new Date().toISOString(),
  });
  await store.write(pendingKey(user.toBase58()), { symbol: form.symbol, content, mint, nonce, at: reuse?.at || new Date().toISOString() });
  await store.write(repoHoldKey(target.repo.id), { wallet: user.toBase58(), mint, at: new Date().toISOString() });

  return ok(res, {
    ...built,
    uri,
    metadata,
    shares: SHARES,
    people: target.people.map((p, i) => ({ ...p, shareBps: shares[i] })),
    sign: "sign both, in order: the coin is created first, then its fees are locked onto the people, the pot, the pad and you",
  });
});

export default handler;
