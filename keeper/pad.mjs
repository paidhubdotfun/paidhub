/**
 * The keeper's whole job, one pulse at a time. Every decision is here; keeper/chain.mjs only signs.
 *
 *  1. the register: coins from the store, plus any launch that landed without its last confirmation;
 *  2. distribute: every 10 minutes each coin's fee vault is paid out once it holds 0.01 SOL, and what
 *     each person was sent is booked from the transaction's own balances;
 *  3. claims: every 2 minutes the people's GitHub fee accounts are read; total_claimed going up is a
 *     claim. A person's FIRST claim on a coin (claimed >= 0.1 SOL, coin sent them >= 0.01 SOL, coin has
 *     25+ holders) schedules the pot's buyback of that coin: 25% of the pot, at most 3 SOL, six parts
 *     over an hour, every part bought and burned, a memo when it is done;
 *  4. the keeper's spare SOL (above its float), once an hour: 3/4 buys and burns $paidhub, 1/4 to the pot;
 *     the pot above 20 SOL, once a week: the surplus buys and burns $paidhub;
 *  5. market data, the Unclaimed board (hourly), the scout (daily), and the pages the site reads.
 *
 * State lives in one JSON file written after every change; a buyback part is marked sent BEFORE its
 * swap goes out, so a crash can repeat a check but never a purchase.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { githubPda, decodeSocialPda } from "../server/lib/chain.js";
import { registerIfLaunched } from "../server/lib/register.js";
import { STATE_KEY, BOARD_KEY, SCOUT_KEY, coinKey, launchKey, pageKey } from "../server/lib/store.js";
import { CONSENT_KEY } from "../server/lib/target.js";
import { CLAIM_BUYBACK, POT, KEEPER } from "../shared/rules.js";
import { buildBoard } from "./board.mjs";

const MIN = 60_000;

export class Pad {
  constructor({ connection, gpa, store, keeper, pot, chain, padMint = async () => null, stateDir, log = () => {}, swap, market, scout, now = () => Date.now(), owns = () => true }) {
    Object.assign(this, { connection, gpa, store, keeper, pot, chain, padMint, stateDir, log, swap, market, scout, now, owns });
    this.file = path.join(stateDir, "pad.json");
    this.loginsFile = path.join(stateDir, "logins.json");
    fs.mkdirSync(stateDir, { recursive: true });
    this.s = readJson(this.file, { coins: {}, people: {}, buybacks: [], spare: {}, pot: {}, board: {}, scout: {}, paidhub: { bought: 0, burned: "0", spent: 0 }, timers: {} });
    this.logins = readJson(this.loginsFile, {});
    this.records = new Map(); // mint -> the store's coin record
  }

  save() {
    writeJson(this.file, this.s);
  }

  due(name, every) {
    const last = this.s.timers[name] || 0;
    if (this.now() - last < every) return false;
    this.s.timers[name] = this.now();
    return true;
  }

  async pulse() {
    await this.refreshRegister();
    await this.distributeAll();
    if (this.due("claims", KEEPER.claimWatchEveryMs)) await this.watchClaims();
    await this.runBuybacks();
    if (this.due("spare", KEEPER.spareEveryMs)) await this.spendSpare();
    if (this.due("overflow", POT.overflowEveryMs)) await this.potOverflow();
    if (this.market && this.due("market", KEEPER.marketEveryMs)) await this.readMarket();
    if (this.due("board", KEEPER.boardEveryMs)) await this.publishBoard().catch((e) => this.log(`board failed: ${e.message}`));
    if (this.scout && this.due("scout", 6 * 60 * MIN)) await this.runScout().catch((e) => this.log(`scout failed: ${e.message}`));
    this.save();
    return this.publish();
  }

  // ---- 1. the register ------------------------------------------------------------------------

  async refreshRegister() {
    if (!this.due("register", 2 * MIN) && this.records.size) return;
    for (const key of await this.store.list("coins/")) {
      const mint = key.slice("coins/".length);
      if (this.records.has(mint)) continue;
      const coin = await this.store.read(coinKey(mint), null);
      if (coin) this.adopt(coin);
    }
    // a launch that landed while its browser tab closed: registered here from the pad's own record
    for (const { key, uploadedAt } of await this.store.listMeta("launches/")) {
      const mint = key.slice("launches/".length);
      if (this.records.has(mint) || this.s.coins[mint]?.notOnPad) continue;
      if (this.now() - uploadedAt < 2 * MIN) continue;
      const built = await this.store.read(launchKey(mint), null);
      if (!built) continue;
      const exists = await this.connection.getAccountInfo(new PublicKey(mint)).catch(() => null);
      if (!exists) {
        if (this.now() - uploadedAt > 60 * MIN) this.s.coins[mint] = { notOnPad: "never launched" };
        continue;
      }
      const r = await registerIfLaunched(this.store, this.connection, built).catch(() => ({}));
      if (r.coin) {
        this.log(`registered ${built.symbol} (${mint.slice(0, 6)}) from its launch record`);
        this.adopt(r.coin);
      } else if (this.now() - uploadedAt > 24 * 60 * MIN) this.s.coins[mint] = { notOnPad: r.taken ? "repo taken" : "split never locked" };
    }
  }

  adopt(coin) {
    this.records.set(coin.mint, coin);
    const c = (this.s.coins[coin.mint] ||= { sent: {}, firstClaim: {}, lastDistribute: 0, distributes: 0 });
    c.sent ||= {};
    c.firstClaim ||= {};
    for (const p of coin.people || []) this.s.people[p.id] ||= { login: p.login, totalClaimed: null, claims: [] };
  }

  // ---- 2. distribute --------------------------------------------------------------------------

  async distributeAll() {
    for (const [mint, coin] of this.records) {
      const c = this.s.coins[mint];
      if (this.now() - (c.lastDistribute || 0) < KEEPER.distributeEveryMs) continue;
      c.lastDistribute = this.now();
      try {
        const sig = await this.chain.collect(this.connection, { mint, keeper: this.keeper, minLamports: KEEPER.distributeMinLamports, log: (m) => this.log(`${coin.symbol}: ${m}`) });
        if (!sig) continue;
        c.distributes = (c.distributes || 0) + 1;
        const moved = await this.balancesOf(sig, coin);
        for (const [id, lamports] of Object.entries(moved)) c.sent[id] = (c.sent[id] || 0) + lamports;
        this.log(`${coin.symbol}: distributed (${Object.entries(moved).map(([id, l]) => `${this.s.people[id]?.login || id} +${(l / 1e9).toFixed(4)}`).join(", ")})`);
        this.save();
      } catch (e) {
        this.log(`${coin.symbol}: distribute failed: ${String(e.message).slice(0, 200)}`);
      }
    }
  }

  /** What each person's GitHub account gained in one transaction, from its pre/post balances. */
  async balancesOf(signature, coin) {
    const tx = await this.connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const out = {};
    if (!tx?.meta) return out;
    const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses }).keySegments().flat();
    for (const p of coin.people || []) {
      const i = keys.findIndex((k) => k.equals(githubPda(p.id)));
      if (i >= 0) out[p.id] = Math.max(0, tx.meta.postBalances[i] - tx.meta.preBalances[i]);
    }
    return out;
  }

  // ---- 3. claims and the pot's buyback ----------------------------------------------------------

  async watchClaims() {
    const ids = Object.keys(this.s.people);
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const infos = await this.connection.getMultipleAccountsInfo(batch.map((id) => githubPda(id)));
      for (const [j, info] of infos.entries()) {
        const id = batch[j];
        const person = this.s.people[id];
        const d = info ? decodeSocialPda(info.data) : null;
        const total = d ? Number(d.totalClaimed) : 0;
        if (person.totalClaimed === null || person.totalClaimed === undefined) {
          person.totalClaimed = total; // the first look is the baseline, never a claim
          continue;
        }
        if (total <= person.totalClaimed) continue;
        const delta = total - person.totalClaimed;
        person.totalClaimed = total;
        person.claims.push({ at: new Date(this.now()).toISOString(), lamports: delta });
        this.log(`claim: ${person.login || id} took ${(delta / 1e9).toFixed(4)} SOL`);
        await this.onClaim(id, delta);
      }
    }
    this.save();
  }

  async onClaim(id, delta) {
    const triggered = [];
    for (const [mint, coin] of this.records) {
      if (!(coin.people || []).some((p) => String(p.id) === id)) continue;
      const c = this.s.coins[mint];
      c.claimedBy ||= {};
      c.claimedBy[id] ||= new Date(this.now()).toISOString(); // the PAID stamp, whatever the buyback does
      if (c.firstClaim[id]) continue;
      const why = [];
      if (delta < CLAIM_BUYBACK.minClaimLamports) why.push("claim under 0.1 SOL");
      if ((c.sent[id] || 0) < CLAIM_BUYBACK.minSentLamports) why.push("this coin had sent them under 0.01 SOL");
      if (!why.length) {
        const holders = await this.holders(mint).catch(() => 0);
        if (holders < CLAIM_BUYBACK.minHolders) why.push(`${holders} holders, the pot needs ${CLAIM_BUYBACK.minHolders}`);
      }
      if (why.length) {
        c.waived ||= {};
        c.waived[id] = { at: new Date(this.now()).toISOString(), why: why.join("; ") };
        continue;
      }
      triggered.push(mint);
    }
    if (!triggered.length) return;
    const free = (await this.connection.getBalance(this.pot.publicKey)) - this.potCommitted() - 10_000_000;
    const total = Math.min(Math.floor(Math.max(0, free) * CLAIM_BUYBACK.potFraction), CLAIM_BUYBACK.maxLamports);
    if (total < CLAIM_BUYBACK.chunks * 1_000_000) {
      this.log(`claim by ${id}: the pot is too empty for a buyback (${(free / 1e9).toFixed(4)} SOL free)`);
      return;
    }
    const each = Math.floor(total / triggered.length);
    for (const mint of triggered) {
      const coin = this.records.get(mint);
      const person = coin.people.find((p) => String(p.id) === id);
      const part = Math.floor(each / CLAIM_BUYBACK.chunks);
      const start = this.now();
      const bb = {
        id: `${mint.slice(0, 8)}-${id}-${start}`,
        mint,
        symbol: coin.symbol,
        login: person?.login || id,
        githubId: id,
        total: part * CLAIM_BUYBACK.chunks,
        at: new Date(start).toISOString(),
        parts: Array.from({ length: CLAIM_BUYBACK.chunks }, (_, k) => ({ due: start + Math.round((k * CLAIM_BUYBACK.spreadMs) / (CLAIM_BUYBACK.chunks - 1)), lamports: part, state: "due", tries: 0 })),
      };
      this.s.coins[mint].firstClaim[id] = bb.id;
      this.s.buybacks.push(bb);
      this.log(`buyback scheduled: ${coin.symbol} for ${bb.login}, ${(bb.total / 1e9).toFixed(4)} SOL in ${CLAIM_BUYBACK.chunks} parts`);
    }
    this.save();
  }

  potCommitted() {
    let n = 0;
    for (const b of this.s.buybacks) for (const p of b.parts) if (p.state === "due") n += p.lamports;
    return n;
  }

  async runBuybacks() {
    for (const b of this.s.buybacks) {
      if (b.done) continue;
      for (const p of b.parts) {
        if (p.state !== "due" || p.due > this.now()) continue;
        if (!this.owns()) return;
        p.state = "sending"; // written before the swap: a crash leaves it here, checked by hand, never re-bought
        p.tries++;
        this.save();
        try {
          const r = await this.chain.buyAndBurn(this.connection, { owner: this.pot, mint: b.mint, lamports: p.lamports, swap: this.swap });
          Object.assign(p, { state: "done", buySig: r.buySig, burnSig: r.burnSig, bought: String(r.bought), burned: r.burned, at: new Date(this.now()).toISOString() });
          this.log(`buyback ${b.symbol}: bought ${r.bought} and burned ${r.burned} for ${(p.lamports / 1e9).toFixed(4)} SOL`);
        } catch (e) {
          // the swap never landed (its error says so): it may go again, a few times
          p.state = p.tries >= 4 ? "failed" : "due";
          p.due = this.now() + 5 * MIN;
          p.error = String(e.message).slice(-300);
          this.log(`buyback ${b.symbol} part failed (${p.tries}): ${p.error}`);
        }
        this.save();
      }
      if (b.parts.every((p) => p.state === "done" || p.state === "failed")) {
        b.done = true;
        const spent = b.parts.filter((p) => p.state === "done").reduce((s, p) => s + p.lamports, 0);
        const burned = b.parts.reduce((s, p) => s + BigInt(p.burned || 0), 0n);
        b.spent = spent;
        b.burned = burned.toString();
        try {
          b.memo = await this.chain.memo(this.connection, { payer: this.keeper, text: `paidhub claim buyback ${b.symbol} @${b.login} ${(spent / 1e9).toFixed(4)} SOL burned ${burned} mint ${b.mint}` });
        } catch (e) {
          this.log(`memo failed: ${e.message}`);
        }
        this.save();
      }
    }
  }

  /** Wallets holding a coin, counted on chain (the coin's own token program). */
  async holders(mint) {
    const info = await this.connection.getAccountInfo(new PublicKey(mint));
    const program = info?.owner?.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const list = await this.gpa.getProgramAccounts(program, { dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: mint } }] });
    const owners = new Set();
    for (const a of list) {
      const amount = a.account.data.readBigUInt64LE(32);
      if (amount > 0n) owners.add(new PublicKey(a.account.data.subarray(0, 32)).toBase58());
    }
    return owners.size;
  }

  // ---- 4. the keeper's spare SOL and the pot's overflow ------------------------------------------

  async spendSpare() {
    // before $paidhub exists nothing moves: the keeper keeps its SOL until there is a coin to buy back
    const mint = await this.padMint();
    if (!mint) return;
    const balance = await this.connection.getBalance(this.keeper.publicKey);
    const spare = balance - KEEPER.floatLamports;
    if (spare < KEEPER.spareMinLamports) return;
    const toPot = Math.floor(spare * (1 - KEEPER.buybackShare));
    const toBuy = spare - toPot;
    try {
      const sig = await this.chain.transfer(this.connection, { from: this.keeper, to: this.pot.publicKey, lamports: toPot });
      this.s.spare.toPot = (this.s.spare.toPot || 0) + toPot;
      this.log(`spare: ${(toPot / 1e9).toFixed(4)} SOL to the pot (${sig.slice(0, 8)})`);
    } catch (e) {
      this.log(`spare to pot failed: ${e.message}`);
      return;
    }
    await this.buyPaidhub(this.keeper, toBuy, mint, "spare");
  }

  async potOverflow() {
    const balance = await this.connection.getBalance(this.pot.publicKey);
    const over = balance - this.potCommitted() - POT.overflowLamports;
    if (over < KEEPER.spareMinLamports) return;
    const mint = await this.padMint();
    if (!mint) return;
    await this.buyPaidhub(this.pot, over, mint, "pot overflow");
  }

  async buyPaidhub(owner, lamports, mint, why) {
    try {
      const r = await this.chain.buyAndBurn(this.connection, { owner, mint, lamports, swap: this.swap });
      const ph = this.s.paidhub;
      ph.spent += lamports;
      ph.burned = (BigInt(ph.burned || 0) + BigInt(r.burned || 0)).toString();
      ph.last = { at: new Date(this.now()).toISOString(), lamports, burned: r.burned, buySig: r.buySig, burnSig: r.burnSig, why };
      this.log(`$paidhub (${why}): ${(lamports / 1e9).toFixed(4)} SOL bought and burned ${r.burned}`);
    } catch (e) {
      this.log(`$paidhub buyback (${why}) failed: ${e.message}`);
    }
  }

  // ---- 5. market, board, scout, publish ----------------------------------------------------------

  async readMarket() {
    const mints = [...this.records.keys()];
    for (let i = 0; i < mints.length; i += 30) {
      const rows = await this.market(mints.slice(i, i + 30)).catch(() => ({}));
      for (const [mint, m] of Object.entries(rows)) if (this.s.coins[mint]) this.s.coins[mint].market = m;
    }
  }

  async publishBoard() {
    const board = await buildBoard(this.gpa, this.logins, { log: this.log });
    writeJson(this.loginsFile, this.logins);
    await this.store.write(BOARD_KEY, board);
    this.s.board = { at: board.updatedAt, totals: board.totals };
    this.log(`board: ${board.totals.accounts} GitHub accounts, ${(board.totals.waiting / 1e9).toFixed(0)} SOL waiting, ${board.resolvedNow} logins looked up`);
  }

  async runScout() {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (this.s.scout.date === today) return;
    const list = await this.scout();
    if (!list) return;
    await this.store.write(SCOUT_KEY, { date: today, ...list });
    this.s.scout = { date: today, count: list.items.length };
    this.log(`scout: ${list.items.length} repos for ${today}`);
  }

  coinView(mint) {
    const coin = this.records.get(mint);
    const c = this.s.coins[mint] || {};
    return {
      mint,
      name: coin.name,
      symbol: coin.symbol,
      image: coin.image,
      repo: coin.repo,
      launcher: coin.launcher,
      launchedAt: coin.launchedAt,
      market: c.market || null,
      people: (coin.people || []).map((p) => ({
        id: p.id,
        login: p.login,
        avatar: p.avatar,
        why: p.why,
        commits: p.commits || 0,
        sent: c.sent?.[p.id] || 0,
        claimedAt: c.claimedBy?.[p.id] || null,
        buyback: c.firstClaim?.[p.id] || null,
        waived: c.waived?.[p.id] || null,
      })),
    };
  }

  async publish() {
    const consent = (await this.store.read(CONSENT_KEY, null)) || { never: { users: [] }, yes: [] };
    const yes = new Set(consent.yes || []);
    const never = new Set(consent.never?.users || []);
    const word = (p) => (yes.has(String(p.id)) ? "yes" : never.has(String(p.id)) ? "never" : "");
    const coins = [...this.records.keys()]
      .map((m) => this.coinView(m))
      .map((c) => ({ ...c, people: c.people.map((p) => ({ ...p, word: word(p) })) }))
      .sort((a, b) => Date.parse(b.launchedAt) - Date.parse(a.launchedAt));
    const potBalance = await this.connection.getBalance(this.pot.publicKey).catch(() => null);
    const buybacks = this.s.buybacks.slice(-30).reverse().map((b) => ({
      mint: b.mint,
      symbol: b.symbol,
      login: b.login,
      at: b.at,
      total: b.total,
      done: !!b.done,
      spent: b.spent || 0,
      burned: b.burned || "0",
      parts: b.parts.map((p) => ({ state: p.state, lamports: p.lamports, buySig: p.buySig || null, burnSig: p.burnSig || null })),
      memo: b.memo || null,
    }));
    const claims = [];
    for (const [id, p] of Object.entries(this.s.people)) for (const cl of p.claims || []) claims.push({ id, login: p.login, ...cl });
    claims.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const state = {
      updatedAt: new Date(this.now()).toISOString(),
      pot: { address: this.pot.publicKey.toBase58(), lamports: potBalance, committed: this.potCommitted() },
      keeper: { address: this.keeper.publicKey.toBase58() },
      paidhub: { mint: (await this.padMint().catch(() => null)) || null, ...this.s.paidhub },
      totals: {
        coins: coins.length,
        sent: coins.reduce((s, c) => s + c.people.reduce((t, p) => t + p.sent, 0), 0),
        claimedPeople: Object.values(this.s.people).filter((p) => (p.claims || []).length).length,
        buybacks: this.s.buybacks.filter((b) => b.done).length,
        buybackSpent: this.s.buybacks.reduce((s, b) => s + (b.spent || 0), 0),
      },
      board: this.s.board,
      coins,
      buybacks,
      claims: claims.slice(0, 30),
    };
    const fingerprint = JSON.stringify({ ...state, updatedAt: 0 });
    if (fingerprint !== this.lastPublished || this.now() - (this.lastPublishedAt || 0) > 3 * MIN) {
      await this.store.write(STATE_KEY, state);
      for (const c of coins) {
        const page = { ...c, buybacks: buybacks.filter((b) => b.mint === c.mint), distributes: this.s.coins[c.mint]?.distributes || 0 };
        const pf = crypto.createHash("sha1").update(JSON.stringify(page)).digest("hex");
        if (this.s.coins[c.mint].published !== pf) {
          await this.store.write(pageKey(c.mint), page);
          this.s.coins[c.mint].published = pf;
        }
      }
      this.lastPublished = fingerprint;
      this.lastPublishedAt = this.now();
    }
    return state;
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}
