/**
 * The Unclaimed board: every GitHub fee account on pump, read straight off the chain (one
 * getProgramAccounts over pump-fees, ~13 000 accounts of 179 bytes), the biggest waits first, with the
 * GitHub login behind each numeric id (looked up once and kept; a few hundred new ones per run).
 */
import bs58 from "bs58";
import { FEES, SOCIAL_PDA_SIZE, SOCIAL_PDA_DISCRIMINATOR, decodeSocialPda } from "../server/lib/chain.js";
import { readUser } from "../server/lib/github.js";
import { GITHUB_PLATFORM } from "../shared/rules.js";

export const BOARD_SIZE = 300;

/** Every GitHub fee account: id, address, waiting lamports, lifetime claimed, last claim (unix s). */
export async function readAllGithubAccounts(gpa) {
  const accounts = await gpa.getProgramAccounts(FEES, {
    filters: [{ dataSize: SOCIAL_PDA_SIZE }, { memcmp: { offset: 0, bytes: bs58.encode(SOCIAL_PDA_DISCRIMINATOR) } }],
  });
  const rent = await gpa.getMinimumBalanceForRentExemption(SOCIAL_PDA_SIZE);
  const out = [];
  for (const { pubkey, account } of accounts) {
    const d = decodeSocialPda(account.data);
    if (!d || d.platform !== GITHUB_PLATFORM || !/^\d{1,20}$/.test(d.userId)) continue;
    out.push({
      id: d.userId,
      address: pubkey.toBase58(),
      waiting: Math.max(0, account.lamports - rent),
      claimed: Number(d.totalClaimed),
      lastClaimed: d.lastClaimed,
    });
  }
  return out;
}

/**
 * Build the board. `logins` is the keeper's cache {id: {login, avatar, at}} and is filled in place;
 * at most `lookups` new GitHub reads per run (the rest wait for the next run).
 */
export async function buildBoard(gpa, logins, { lookups = 250, log = () => {}, read = readUser } = {}) {
  const all = await readAllGithubAccounts(gpa);
  all.sort((a, b) => b.waiting - a.waiting);
  const top = all.filter((a) => a.waiting > 0).slice(0, BOARD_SIZE);
  let looked = 0;
  for (const a of top) {
    if (logins[a.id] || looked >= lookups) continue;
    looked++;
    try {
      const u = await read(a.id);
      logins[a.id] = u ? { login: u.login, avatar: u.avatar, type: u.type, x: u.x || "", at: Date.now() } : { gone: true, at: Date.now() };
    } catch (e) {
      log(`board: GitHub lookup stopped (${e.message})`);
      break;
    }
  }
  const totals = all.reduce(
    (t, a) => ({ accounts: t.accounts + 1, waiting: t.waiting + a.waiting, claimed: t.claimed + a.claimed, everClaimed: t.everClaimed + (a.claimed > 0 ? 1 : 0), neverClaimed: t.neverClaimed + (a.claimed === 0 && a.waiting > 0 ? 1 : 0) }),
    { accounts: 0, waiting: 0, claimed: 0, everClaimed: 0, neverClaimed: 0 }
  );
  return {
    updatedAt: new Date().toISOString(),
    totals,
    top: top.map((a) => ({ ...a, login: logins[a.id]?.login || "", avatar: logins[a.id]?.avatar || "", x: logins[a.id]?.x || "", type: logins[a.id]?.type || "", gone: !!logins[a.id]?.gone })),
    resolvedNow: looked,
  };
}
