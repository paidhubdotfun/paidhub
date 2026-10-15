/**
 * The second half of a launch, on its own.
 *
 * If the fee sharing transaction is lost, the coin exists and its creator is still the launcher,
 * so the split can be set afterwards. Without this route a half launched coin would be stuck
 * forever, and that is exactly the state a user hits when a wallet drops the second signature.
 */
import { PublicKey } from "@solana/web3.js";
import { ok, bad, route, body } from "./lib/http.js";
import { rpc, isLocked } from "./lib/chain.js";
import { buildFeeShare } from "./lib/launch.js";
import { loadLookupTable } from "./lib/alt.js";
import { readSharingConfig } from "./lib/chain.js";
import { openStore, launchKey } from "./lib/store.js";

export const handler = route(async (req, res) => {
  if (req.method && req.method !== "POST") return bad(res, "post here", 405);
  const input = await body(req);
  const mint = String(input.mint || "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return bad(res, "that is not a mint address");

  let user;
  try {
    user = new PublicKey(String(input.wallet || "").trim());
  } catch {
    return bad(res, "connect the wallet that launched the coin");
  }

  const launch = await openStore().read(launchKey(mint), null);
  if (!launch) return bad(res, "this coin was not built by the pad's launch form", 404);
  if (launch.launcher !== user.toBase58()) return bad(res, "only the wallet that launched the coin can finish it");

  const connection = rpc();
  const existing = await readSharingConfig(connection, mint);
  if (isLocked(existing)) return bad(res, "this coin's split is already set, and pump never lets it change");
  if (existing && !existing.admin.equals(user)) {
    return bad(res, "only the wallet that created the coin can set its split");
  }

  const lookupTable = await loadLookupTable(connection, process.env.PH_LOOKUP_TABLE);
  const built = await buildFeeShare({ connection, user, mint: new PublicKey(mint), people: (launch.people || []).map((p) => String(p.id)), lookupTable });
  return ok(res, { mint, ...built });
});

export default handler;
