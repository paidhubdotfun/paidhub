/**
 * The launch form's first step: paste a repo, see exactly who a coin on it would pay and why, or why
 * it cannot be launched. Read only.
 */
import { ok, bad, route, query } from "./lib/http.js";
import { openStore } from "./lib/store.js";
import { resolveTarget } from "./lib/target.js";
import { SHARES, devShares } from "../shared/rules.js";

export const handler = route(async (req, res) => {
  const input = String(query(req, "repo") || "").trim();
  if (!input) return bad(res, "paste a GitHub repo: github.com/owner/repo");
  const target = await resolveTarget(openStore(), input, { wallet: String(query(req, "wallet") || "") });
  const shares = devShares(target.people.length);
  return ok(
    res,
    { ...target, people: target.people.map((p, i) => ({ ...p, shareBps: shares[i] })), shares: SHARES },
    target.taken ? 300 : 30
  );
});

export default handler;
