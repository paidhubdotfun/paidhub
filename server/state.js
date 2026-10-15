/**
 * What the keeper publishes, for the site: the front page (every coin, the pot, the last claims and
 * buybacks), the Unclaimed board and today's scout list. Nothing here is computed on request.
 */
import { ok, bad, route, query } from "./lib/http.js";
import { openStore, STATE_KEY, BOARD_KEY, SCOUT_KEY } from "./lib/store.js";

const PARTS = { front: STATE_KEY, board: BOARD_KEY, scout: SCOUT_KEY };

export const handler = route(async (req, res) => {
  const part = String(query(req, "part") || "front");
  const key = PARTS[part];
  if (!key) return bad(res, "part is front, board or scout");
  const data = await openStore().read(key, null);
  return ok(res, { part, data, ready: !!data }, 20);
});

export default handler;
