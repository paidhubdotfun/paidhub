// Every number of paidhub in one place: the site shows them, the routes and the keeper obey them.

/** A coin's creator fees, in basis points, locked by pump the moment the launch lands. */
export const SHARES = {
  devs: 5000, // split evenly between the repo's people (pump's GitHub fee accounts)
  pot: 2000, // the pot that buys back a coin when its developer first claims
  keeper: 2000, // every hour, what the keeper holds above its float: 3/4 buys back and burns $paidhub, 1/4 tops up the pot
  launcher: 1000, // whoever launched the coin
};

/** Pump's GitHub platform id in a social fee PDA (Pump = 0, X = 1, GitHub = 2). */
export const GITHUB_PLATFORM = 2;

export const PEOPLE = {
  max: 3, // GitHub accounts a coin pays
  minAgeDays: 90, // younger accounts are skipped (fresh sockpuppets)
  minCommits: 3, // an organisation's contributor needs at least this many commits to count
};

/** A developer's first claim of the fees a coin sent them: the pot buys that coin back and burns it. */
export const CLAIM_BUYBACK = {
  potFraction: 0.25, // of the pot at the moment of the claim
  maxLamports: 3_000_000_000, // never more than 3 SOL for one claim
  chunks: 6, // spread over an hour so nobody sells the whole thing into one buy
  spreadMs: 60 * 60_000,
  minHolders: 25, // a coin with fewer holders is not worth the pot
  minClaimLamports: 100_000_000, // the claim has to move at least 0.1 SOL
  minSentLamports: 10_000_000, // and the coin must have sent the developer at least 0.01 SOL before it
};

export const POT = {
  // above this the surplus goes, once a week, into the $paidhub buyback
  overflowLamports: 20_000_000_000,
  overflowEveryMs: 7 * 86_400_000,
};

export const KEEPER = {
  distributeMinLamports: 10_000_000, // a coin's fee vault is paid out once it holds 0.01 SOL
  distributeEveryMs: 10 * 60_000,
  claimWatchEveryMs: 2 * 60_000,
  boardEveryMs: 60 * 60_000,
  // once an hour, the keeper's SOL above its float (its 20% of every coin, and $paidhub's own creator
  // fees forwarded to it by hand): 3/4 buys back and burns $paidhub, 1/4 goes to the pot
  floatLamports: 60_000_000, // pays every transaction the keeper sends
  buybackShare: 0.75,
  spareMinLamports: 20_000_000,
  spareEveryMs: 60 * 60_000,
  marketEveryMs: 5 * 60_000,
};

export const LAUNCH = {
  devBuyMin: 10_000_000, // 0.01 SOL
  devBuyMax: 5_000_000_000, // 5 SOL
  nameMax: 32,
  symbolMax: 10,
  descriptionMax: 600,
};

/** Split the developers' 50% evenly, the remainder to the first one, so it always sums exactly. */
export function devShares(count) {
  if (!(count >= 1 && count <= PEOPLE.max)) throw new Error(`a coin pays 1 to ${PEOPLE.max} people`);
  const each = Math.floor(SHARES.devs / count);
  return Array.from({ length: count }, (_, i) => (i === 0 ? SHARES.devs - each * (count - 1) : each));
}

const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** The launch form, checked the same way in the browser and on the server. */
export function checkLaunch(input, repo) {
  const name = String(input.name || "").trim();
  const symbol = String(input.symbol || "").trim().replace(/^\$/, "");
  const description = String(input.description || "").trim();
  if (!name) throw new Error("the coin needs a name");
  if (name.length > LAUNCH.nameMax) throw new Error(`the name is ${LAUNCH.nameMax} characters at most`);
  if (!/^[A-Za-z0-9]{1,10}$/.test(symbol)) throw new Error(`the ticker is 1 to ${LAUNCH.symbolMax} letters or digits`);
  if (description.length > LAUNCH.descriptionMax) throw new Error(`the description is ${LAUNCH.descriptionMax} characters at most`);
  // the coin is named after the repo it pays: a name that hides the repo reads like someone else's coin
  if (repo && squash(repo.name).length && squash(repo.name).length <= LAUNCH.nameMax && !squash(name).includes(squash(repo.name))) {
    throw new Error(`the name has to contain the repo's name, ${repo.name}`);
  }
  const twitter = normaliseX(input.twitter);
  const website = normaliseUrl(input.website);
  return { name, symbol, description, twitter, website };
}

function normaliseX(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  const handle = v.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error("the X field takes a handle or an x.com link");
  return `https://x.com/${handle}`;
}

function normaliseUrl(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
  } catch {
    throw new Error("the website field takes a link");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("the website field takes an http(s) link");
  return u.toString();
}

/** github.com/owner/repo, owner/repo, or a link into the repo: the two names, or null. */
export function parseRepo(input) {
  const v = String(input || "").trim().replace(/\.git$/, "");
  const m =
    v.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})(?:[/?#].*)?$/i) ||
    v.match(/^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/);
  if (!m) return null;
  return { owner: m[1], name: m[2] };
}

export const lamportsToSol = (l) => Number(l) / 1e9;
