/**
 * paidhub.io/@login: what waits for one GitHub account in pump's fee account, what it has ever
 * claimed, which paidhub coins pay it and how many coins anywhere on pump route fees to it.
 * Read from the chain on request (the coins elsewhere are cached for half an hour).
 */
import { ok, bad, route, query } from "./lib/http.js";
import { openStore, personKey, STATE_KEY } from "./lib/store.js";
import { rpc, gpaRpc, readPerson, githubPda, FEES, SHAREHOLDER_OFFSET, SHARING_CONFIG_SIZE } from "./lib/chain.js";
import { readUser } from "./lib/github.js";

const CACHE_MS = 30 * 60_000;

/** Every sharing config on pump that names this account in one of its ten rows, in parallel. */
async function coinsAnywhere(connection, pda) {
  const rows = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      connection
        .getProgramAccounts(FEES, {
          dataSlice: { offset: 8 + 3, length: 32 }, // the mint
          filters: [{ dataSize: SHARING_CONFIG_SIZE }, { memcmp: { offset: SHAREHOLDER_OFFSET(i), bytes: pda.toBase58() } }],
        })
        .then((list) => list.map((a) => a.account.data.toString("base64")))
        .catch(() => null)
    )
  );
  if (rows.some((r) => r === null)) return null;
  return [...new Set(rows.flat())].length;
}

export const handler = route(async (req, res) => {
  const login = String(query(req, "login") || "").trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) return bad(res, "that is not a GitHub login");
  const user = await readUser(login);
  if (!user) return ok(res, { found: false, reason: "no GitHub account by that name" }, 300);
  if (user.type !== "User") return ok(res, { found: false, user, reason: "an organisation: pump cannot pay it, only its people" }, 300);

  const store = openStore();
  const pda = githubPda(user.id);
  const [account, own, front] = await Promise.all([readPerson(rpc(), user.id), store.read(personKey(user.id), null), store.read(STATE_KEY, null)]);
  const padCoins = (front?.coins || []).filter((c) => (c.people || []).some((p) => String(p.id) === user.id));

  let anywhere = own?.anywhere && Date.now() - own.anywhere.at < CACHE_MS ? own.anywhere.count : null;
  // counting every coin on pump that pays this account takes seconds: only when asked (?anywhere=1)
  if (anywhere === null && query(req, "anywhere") === "1") {
    anywhere = await coinsAnywhere(gpaRpc(), pda);
    if (anywhere !== null) await store.write(personKey(user.id), { ...(own || {}), anywhere: { count: anywhere, at: Date.now() } });
  }
  return ok(
    res,
    {
      found: true,
      user,
      account: { ...account, address: pda.toBase58() },
      word: { never: !!own?.never, neverRepos: own?.neverRepos || [], yes: !!own?.yes },
      padCoins,
      anywhere,
    },
    60
  );
});

export default handler;
