/**
 * The pad's register. A coin is on paidhub only from the pad's own launch record, and only once the
 * chain shows its split locked to the people it was built for, the pot, the keeper and the launcher.
 * The send route, the coin page and the keeper all register through here, so a coin whose last
 * confirmation was lost still lands on the pad. One coin per repo: the first registered wins.
 */
import { PublicKey } from "@solana/web3.js";
import { isPadCoin, readSharingConfig } from "./chain.js";
import { coinKey, repoKey } from "./store.js";

export function coinFromLaunch(built, signatures = []) {
  return {
    mint: built.mint,
    name: built.name,
    symbol: built.symbol,
    description: built.description,
    image: built.image,
    uri: built.uri,
    twitter: built.twitter || "",
    website: built.website || "",
    launcher: built.launcher,
    repo: built.repo,
    people: built.people,
    launchedAt: new Date().toISOString(),
    signatures,
  };
}

export const peopleIds = (built) => (built.people || []).map((p) => String(p.id));

/** Register the coin if its split is the pad's and the repo has no coin yet. Never overwrites a record. */
export async function registerIfLaunched(store, connection, built, signatures = []) {
  const config = await readSharingConfig(connection, built.mint);
  const onPad = isPadCoin(config, built.launcher, peopleIds(built));
  if (!onPad) return { onPad, config, coin: null };
  const existing = await store.read(coinKey(built.mint), null);
  if (existing) return { onPad, config, coin: existing };
  const holder = await store.read(repoKey(built.repo.id), null);
  if (holder && holder.mint !== built.mint) return { onPad: false, config, coin: null, taken: holder.mint };
  const coin = coinFromLaunch(built, signatures);
  await store.write(repoKey(built.repo.id), { mint: built.mint, at: coin.launchedAt });
  await store.write(coinKey(built.mint), coin);
  return { onPad, config, coin, registered: true };
}

// what a launch transaction may call at its top level: compute budget, the system and token programs,
// pump's three programs and mayhem, memo, and Lighthouse (the guard some wallets add)
export const LAUNCH_PROGRAMS = new Set([
  "ComputeBudget111111111111111111111111111111",
  "11111111111111111111111111111111",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95",
]);

/**
 * Only a launch goes out through the pad's send route: paid by the coin's launcher, naming the coin,
 * calling nothing but the programs a launch calls. Anything else is refused before it reaches the chain.
 */
export function checkLaunchTx(tx, { mint, launcher }) {
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  if (keys[0] !== new PublicKey(launcher).toBase58()) throw new Error("this transaction is not paid by the coin's launcher");
  if (!keys.includes(mint)) throw new Error("this transaction does not name the coin");
  for (const ix of tx.message.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    if (!program || !LAUNCH_PROGRAMS.has(program)) throw new Error(`this transaction does more than launch the coin (it calls ${program || "an unknown program"})`);
  }
}
