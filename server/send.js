/**
 * The signed launch, sent in order, and the coin written into the pad's register.
 *
 * Only a launch the pad built goes out through here (paid by its launcher, calling only the programs a
 * launch calls). A coin is registered only once the chain shows its split locked to the people, the pot,
 * the keeper and the launcher, from the pad's own launch record, never from what the browser posts.
 */
import { VersionedTransaction } from "@solana/web3.js";
import { ok, bad, route, body } from "./lib/http.js";
import { rpc } from "./lib/chain.js";
import { openStore, coinKey, launchKey, pendingKey, repoHoldKey } from "./lib/store.js";
import { registerIfLaunched, checkLaunchTx } from "./lib/register.js";

export async function sendInOrder(connection, transactions, { label = "launch" } = {}) {
  const signatures = [];
  for (const [i, base64] of transactions.entries()) {
    const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
    const raw = tx.serialize();
    // preflight ON: a dropped transaction otherwise reads as a confirmation timeout
    let signature = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 });
    const deadline = Date.now() + 90000;
    let lastSend = Date.now();
    for (;;) {
      const { value } = await connection.getSignatureStatuses([signature]);
      if (value[0]?.err) throw new Error(`${label} step ${i + 1} failed: ${JSON.stringify(value[0].err)}`);
      if (value[0]?.confirmationStatus === "confirmed" || value[0]?.confirmationStatus === "finalized") break;
      if (Date.now() > deadline) throw new Error(`${label} step ${i + 1} never confirmed (${signature})`);
      // the same signed transaction can be re-sent for free: it is identified by its signature
      if (Date.now() - lastSend > 1500) {
        lastSend = Date.now();
        signature = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    signatures.push(signature);
  }
  return signatures;
}

export const handler = route(async (req, res) => {
  if (req.method && req.method !== "POST") return bad(res, "post the signed transactions here", 405);
  const input = await body(req);
  const transactions = Array.isArray(input.transactions) ? input.transactions : [];
  if (!transactions.length || transactions.length > 2) return bad(res, "send one or two signed transactions");

  const mint = String(input.mint || "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return bad(res, "that is not a mint address");

  const store = openStore();
  const built = await store.read(launchKey(mint));
  if (!built) return bad(res, "this coin was not built by the pad's launch form", 404);
  if (await store.read(coinKey(mint))) return ok(res, { mint, signatures: [], onPad: true, split: null, note: "this coin is already on paidhub" });

  let txs;
  try {
    txs = transactions.map((t) => VersionedTransaction.deserialize(Buffer.from(String(t), "base64")));
    for (const tx of txs) checkLaunchTx(tx, built);
  } catch (e) {
    return bad(res, e.message || "those are not the coin's launch transactions");
  }

  const connection = rpc();
  const signatures = await sendInOrder(connection, transactions, { label: "launch" });

  const { onPad, config, taken } = await registerIfLaunched(store, connection, built, signatures);
  const pending = await store.read(pendingKey(built.launcher), null);
  if (pending?.mint === mint) await store.write(pendingKey(built.launcher), { ...pending, landed: true, symbol: "" });
  if (onPad) await store.remove(repoHoldKey(built.repo.id));

  return ok(res, {
    mint,
    signatures,
    onPad,
    split: config ? config.shareholders.map((s) => ({ address: s.address.toBase58(), shareBps: s.shareBps })) : null,
    note: onPad
      ? "launched: half of every fee now goes to the repo's people, locked for good"
      : taken
        ? "the coin exists, but another coin on this repo was registered first"
        : "the coin exists but its fees are not locked yet: finish it from its page",
  });
});

export default handler;
