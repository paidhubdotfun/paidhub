/**
 * The whole money path on a local chain carrying the REAL pump programs (dumped from mainnet), through
 * the site's own routes and the keeper, with a fake GitHub:
 *   repo check (owner / top contributors, bots, young accounts and forks refused) -> launch route ->
 *   the launcher signs both transactions -> send route lands them and registers the coin, split locked
 *   to the people, the pot, the keeper and the launcher -> one coin per repo -> trades -> the keeper
 *   distributes and books what each person was sent -> a person claims (pump's claim authority swapped
 *   for a test key) -> the keeper sees it and the pot buys the coin back in six parts and burns it, with
 *   a memo -> the keeper's spare SOL buys $paidhub and tops up the pot -> the Unclaimed board -> a
 *   developer signs in and closes their repos -> the coin, person and front routes answer as the site reads them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { startValidator, fund, sendAndConfirm, sleep, PORTS } from "./helpers/validator.mjs";
import { buyOnCurve } from "./helpers/trade.mjs";
import { mockReq, call } from "./helpers/http.mjs";
import { installFakeGithub } from "./helpers/github.mjs";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "paidhub-suite-"));
const KEEPER = Keypair.generate();
const POT = Keypair.generate();
const CLAIMER = Keypair.generate(); // stands in for pump's social_claim_authority
process.env.PH_SECRET = crypto.randomBytes(32).toString("hex");
process.env.PH_STATE_DIR = path.join(TMP, "state");
process.env.PH_PUBLIC_DIR = path.join(TMP, "public");
process.env.PH_PUBLIC_BASE = "http://local.test/_local";
process.env.PH_RPCS = `http://127.0.0.1:${PORTS.rpc}`;
process.env.PH_GPA_RPC = `http://127.0.0.1:${PORTS.rpc}`;
process.env.PH_KEEPER_PUBKEY = KEEPER.publicKey.toBase58();
process.env.PH_POT_PUBKEY = POT.publicKey.toBase58();
process.env.PH_SITE_URL = "https://paidhub.io";
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.PH_GITHUB_TOKEN;

const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const MIN = 60_000;

const swapClaimAuthority = (raw) => {
  const j = JSON.parse(raw);
  const data = Buffer.from(j.account.data[0], "base64");
  CLAIMER.publicKey.toBuffer().copy(data, 42); // 8 disc + bump + authority 32 + disable_flags
  j.account.data[0] = data.toString("base64");
  return JSON.stringify(j);
};

test("repo, launch, distribute, claim, buyback, board, consent: the whole path", { timeout: 900_000 }, async (t) => {
  const github = installFakeGithub();
  const chain = await startValidator({ log: (m) => t.diagnostic(m), patch: { "fee_program_global.json": swapClaimAuthority } });
  const { connection } = chain;
  try {
    const { createLookupTable } = await import("../server/lib/alt.js");
    const { readSharingConfig, isPadCoin, githubPda, offline } = await import("../server/lib/chain.js");
    const { openStore, BOARD_KEY } = await import("../server/lib/store.js");
    const { sessionCookie } = await import("../server/lib/session.js");
    const { CLAIM_BUYBACK } = await import("../shared/rules.js");
    const repoRoute = (await import("../server/repo.js")).handler;
    const launchRoute = (await import("../server/launch.js")).handler;
    const sendRoute = (await import("../server/send.js")).handler;
    const coinRoute = (await import("../server/coin.js")).handler;
    const personRoute = (await import("../server/person.js")).handler;
    const stateRoute = (await import("../server/state.js")).handler;
    const meRoute = (await import("../server/me.js")).handler;
    const { Pad } = await import("../keeper/pad.mjs");
    const kchain = await import("../keeper/chain.mjs");

    // the suite's coins are small: the thresholds come down, the logic stays
    CLAIM_BUYBACK.minHolders = 2;
    CLAIM_BUYBACK.minClaimLamports = 1_000_000;
    CLAIM_BUYBACK.minSentLamports = 1_000_000;

    await fund(connection, KEEPER.publicKey, 0.7); // spare above the 0.1 float: ~0.6 SOL, a buy the small test curve can take
    await fund(connection, POT.publicKey, 2);
    await fund(connection, CLAIMER.publicKey, 1);
    const { table, count } = await createLookupTable({
      connection,
      authority: KEEPER.publicKey,
      extra: [KEEPER.publicKey.toBase58(), POT.publicKey.toBase58()],
      send: (tx, label) => sendAndConfirm(connection, tx, [KEEPER], { label }),
    });
    process.env.PH_LOOKUP_TABLE = table.toBase58();
    t.diagnostic(`lookup table: ${count} addresses`);
    await sleep(800);

    // ---- 1. who a coin pays -------------------------------------------------------------------
    const org = await call(repoRoute, mockReq({ query: { repo: "https://github.com/acme/engine" } }));
    assert.equal(org.status, 200, JSON.stringify(org.json));
    assert.deepEqual(org.json.people.map((p) => p.login), ["bob", "carol", "alice"], "an org pays its top committers: no bot, no young account");
    assert.deepEqual(org.json.people.map((p) => p.shareBps), [1668, 1666, 1666]);
    assert.equal((await call(repoRoute, mockReq({ query: { repo: "alice/forked" } }))).status, 400, "a fork is refused");
    assert.equal((await call(repoRoute, mockReq({ query: { repo: "dave/fresh" } }))).status, 400, "a young owner is refused");
    assert.equal((await call(repoRoute, mockReq({ query: { repo: "nobody/nothing" } }))).status, 400, "a missing repo is refused");

    // ---- 2. launches through the site's routes -----------------------------------------------
    const launch = async (wallet, repo, name, symbol) => {
      const r = await call(launchRoute, mockReq({ method: "POST", body: { wallet: wallet.publicKey.toBase58(), repo, name, symbol, description: "", twitter: "@x", website: "", image: PNG_1PX, devBuyLamports: 200_000_000 } }));
      if (r.status !== 200) return r;
      const signed = r.json.transactions.map((b) => {
        const tx = VersionedTransaction.deserialize(Buffer.from(b, "base64"));
        tx.sign([wallet]);
        return Buffer.from(tx.serialize()).toString("base64");
      });
      const s = await call(sendRoute, mockReq({ method: "POST", body: { mint: r.json.mint, transactions: signed } }));
      return { ...s, mint: r.json.mint, built: r.json };
    };
    const l1 = Keypair.generate();
    const l2 = Keypair.generate();
    await fund(connection, l1.publicKey, 10);
    await fund(connection, l2.publicKey, 10);

    const wrongName = await call(launchRoute, mockReq({ method: "POST", body: { wallet: l1.publicKey.toBase58(), repo: "acme/engine", name: "Rocket", symbol: "RKT", image: PNG_1PX, devBuyLamports: 200_000_000 } }));
    assert.equal(wrongName.status, 400, "a name that hides the repo is refused");

    const engine = await launch(l1, "acme/engine", "acme engine", "ENGINE");
    assert.equal(engine.status, 200, JSON.stringify(engine.json));
    assert.ok(engine.json.onPad, engine.json.note);
    const config = await readSharingConfig(connection, engine.mint);
    assert.ok(isPadCoin(config, l1.publicKey, ["1002", "1003", "1001"]), "the split is the pad's, locked");
    t.diagnostic(`engine split: ${config.shareholders.map((s) => s.shareBps).join("/")}`);
    const meta = JSON.parse(fs.readFileSync(path.join(TMP, "public", "metadata", `${engine.mint}.json`), "utf8"));
    assert.equal(meta.website, "https://paidhub.io/acme/engine", "the coin's website is its paidhub page");
    assert.equal(meta.twitter, "https://x.com/x");
    assert.match(meta.description, /@bob, @carol, @alice/);

    const again = await launch(l2, "acme/engine", "acme engine 2", "ENG2");
    assert.equal(again.status, 400, "one coin per repo");

    const tool = await launch(l2, "github.com/alice/tool", "tool", "TOOL");
    assert.ok(tool.json.onPad, tool.json.note);

    const byRepo = await call(coinRoute, mockReq({ query: { repo: "acme/engine" } }));
    assert.ok(byRepo.json.found && byRepo.json.coin.mint === engine.mint, "paidhub.io/acme/engine finds the coin");

    // ---- 3. trades -----------------------------------------------------------------------------
    const traders = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
    for (const tr of traders) await fund(connection, tr.publicKey, 40);
    for (const [i, tr] of traders.entries()) {
      for (const mint of [engine.mint, tool.mint]) {
        await buyOnCurve({ connection, mint: new PublicKey(mint), buyer: tr, lamports: (i + 2) * 1_000_000_000, send: (tx) => sendAndConfirm(connection, tx, [tr], { label: "buy" }) });
      }
    }

    // ---- 4. the keeper: distribute, board, spare ------------------------------------------------
    let clock = Date.now();
    const curveSwap = async ({ connection: c, mint, lamports, owner }) => {
      const amount = await buyOnCurve({ connection: c, mint: new PublicKey(mint), buyer: owner, lamports, send: (tx) => sendAndConfirm(c, tx, [owner], { label: "swap" }) });
      return { amount: Number(amount), signature: "curve" };
    };
    const store = openStore();
    const logs = [];
    const pad = new Pad({
      connection,
      gpa: connection,
      store,
      keeper: KEEPER,
      pot: POT,
      chain: kchain,
      padMint: async () => tool.mint, // stands in for $paidhub
      swap: curveSwap,
      stateDir: path.join(TMP, "keeper"),
      now: () => clock,
      log: (m) => {
        logs.push(m);
        t.diagnostic(`keeper: ${m}`);
      },
    });
    const potBefore = await connection.getBalance(POT.publicKey);
    const toolSupply0 = BigInt((await connection.getTokenSupply(new PublicKey(tool.mint))).value.amount);
    let state = await pad.pulse();
    assert.equal(state.coins.length, 2);
    const bobSent = pad.s.coins[engine.mint].sent["1002"] || 0;
    assert.ok(bobSent > 0, "the keeper distributed and booked what bob was sent");
    assert.ok(pad.s.coins[tool.mint].sent["1001"] > 0, "alice's coin paid alice");
    assert.ok(Number(pad.s.paidhub.burned) > 0, "the keeper's spare SOL bought and burned $paidhub");
    assert.ok(BigInt((await connection.getTokenSupply(new PublicKey(tool.mint))).value.amount) < toolSupply0, "the burn shrinks the supply");
    assert.ok((await connection.getBalance(POT.publicKey)) > potBefore, "a quarter of the spare went to the pot");
    const board = await store.read(BOARD_KEY);
    assert.ok(board.top.some((a) => a.login === "bob" && a.waiting > 0), "bob is on the Unclaimed board");
    assert.equal(board.totals.accounts, 3, "bob, carol and alice (alice is paid by both coins): three accounts");

    // ---- 5. bob claims; the pot buys ENGINE back -----------------------------------------------
    const sdk = offline();
    const bobWallet = Keypair.generate();
    await fund(connection, bobWallet.publicKey, 0.01);
    const ix = await sdk.claimSocialFeePda({ recipient: bobWallet.publicKey, socialClaimAuthority: CLAIMER.publicKey, userId: "1002", platform: 2 });
    await kchain.sendTx(connection, CLAIMER, [ix], [CLAIMER], "claim");
    const supply0 = BigInt((await connection.getTokenSupply(new PublicKey(engine.mint))).value.amount);

    clock += 3 * MIN;
    state = await pad.pulse();
    const bb = pad.s.buybacks.find((b) => b.mint === engine.mint);
    assert.ok(bb, `bob's first claim schedules a buyback (${logs.slice(-4).join(" | ")})`);
    assert.equal(bb.parts.length, 6);
    assert.equal(bb.parts.filter((p) => p.state === "done").length, 1, "the first part goes at once");
    assert.ok(state.coins.find((c) => c.mint === engine.mint).people.find((p) => p.login === "bob").claimedAt, "bob's row carries the PAID stamp");

    clock += 61 * MIN;
    await pad.pulse();
    assert.ok(bb.done, "all six parts done after the hour");
    assert.ok(bb.parts.every((p) => p.state === "done"));
    assert.ok(bb.memo, "a memo closes the buyback");
    const supply1 = BigInt((await connection.getTokenSupply(new PublicKey(engine.mint))).value.amount);
    assert.ok(supply1 < supply0, "the bought ENGINE was burned");
    t.diagnostic(`buyback: ${(bb.spent / 1e9).toFixed(4)} SOL, burned ${bb.burned}`);

    clock += 3 * MIN;
    await pad.pulse();
    assert.equal(pad.s.buybacks.filter((b) => b.mint === engine.mint).length, 1, "a person's first claim buys back once, never twice");

    // ---- 6. a developer's word -----------------------------------------------------------------
    const cookie = sessionCookie({ id: 1005, login: "erin" })[0].split(";")[0];
    const never = await call(meRoute, mockReq({ method: "POST", headers: { cookie }, body: { never: true } }));
    assert.equal(never.status, 200, JSON.stringify(never.json));
    const closed = await call(repoRoute, mockReq({ query: { repo: "erin/notes" } }));
    assert.equal(closed.status, 400, "a person who said never cannot be launched");
    assert.match(closed.json.error, /never/);
    const notMine = await call(meRoute, mockReq({ method: "POST", headers: { cookie }, body: { neverRepos: ["alice/tool"] } }));
    assert.equal(notMine.status, 400, "nobody can close someone else's repo");
    const yes = await call(meRoute, mockReq({ method: "POST", headers: { cookie: sessionCookie({ id: 1002, login: "bob" })[0].split(";")[0] }, body: { yes: true } }));
    assert.equal(yes.json.word.yes, true);
    assert.equal((await call(meRoute, mockReq({}))).json.signedIn, false, "no cookie, no session");

    // ---- 7. what the site reads ----------------------------------------------------------------
    clock += 3 * MIN;
    state = await pad.pulse();
    assert.equal(state.coins.find((c) => c.mint === engine.mint).people.find((p) => p.login === "bob").word, "yes");
    const person = await call(personRoute, mockReq({ query: { login: "bob", anywhere: "1" } }));
    assert.ok(person.json.found);
    assert.ok(person.json.account.claimed > 0, "bob's page shows what he claimed");
    assert.equal(person.json.account.address, githubPda("1002").toBase58());
    assert.equal(person.json.padCoins.length, 1);
    assert.equal(person.json.anywhere, 1, "one coin anywhere on pump pays bob");
    const org2 = await call(personRoute, mockReq({ query: { login: "acme" } }));
    assert.equal(org2.json.found, false, "an organisation has no page: pump cannot pay it");
    const front = await call(stateRoute, mockReq({ query: { part: "front" } }));
    assert.equal(front.json.data.coins.length, 2);
    assert.equal(front.json.data.totals.buybacks, 1);
    const coinPage = await call(coinRoute, mockReq({ query: { mint: engine.mint } }));
    assert.equal(coinPage.json.page.buybacks.length, 1);
    assert.equal(coinPage.json.live.length, 3);
  } finally {
    github.restore();
    chain.stop();
  }
});
