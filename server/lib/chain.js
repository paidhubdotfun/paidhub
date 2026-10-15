// Everything paidhub knows about Solana in one place: the connection, the pad's wallets, pump's
// GitHub fee accounts (social fee PDAs) and the one account the pad has to trust, a coin's locked split.
import { Connection, PublicKey } from "@solana/web3.js";
import * as pumpSdkPkg from "@pump-fun/pump-sdk";
import { SHARES, GITHUB_PLATFORM, devShares } from "../../shared/rules.js";

const { PumpSdk, OnlinePumpSdk, PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID } = pumpSdkPkg;

export const SDK = pumpSdkPkg;
export const PUMP = PUMP_PROGRAM_ID;
export const FEES = PUMP_FEE_PROGRAM_ID;
export const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
export { SHARES };

export function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

/** The RPC list: the paid Solana Tracker node first, then Helius, then whatever else is configured. */
export function rpcUrls() {
  const list = [
    ...String(env("PH_RPCS", "")).split(","),
    env("PH_RPC_URL"),
    env("SOLANATRACKER_RPC_URL"),
    env("HELIUS_RPC_URL"),
    env("HELIUS_API_KEY") ? `https://mainnet.helius-rpc.com/?api-key=${env("HELIUS_API_KEY")}` : "",
  ]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  return [...new Set(list)];
}

export function rpc() {
  const url = rpcUrls()[0];
  if (!url) throw new Error("no RPC configured (PH_RPCS)");
  return new Connection(url, { commitment: "confirmed" });
}

/** getProgramAccounts goes to Helius: other nodes take tens of seconds on a program this big. */
export function gpaRpc() {
  const url = env("PH_GPA_RPC") || (env("HELIUS_API_KEY") ? `https://mainnet.helius-rpc.com/?api-key=${env("HELIUS_API_KEY")}` : rpcUrls()[0]);
  if (!url) throw new Error("no RPC configured (PH_GPA_RPC)");
  return new Connection(url, { commitment: "confirmed" });
}

export const online = (connection = rpc()) => new OnlinePumpSdk(connection);
export const offline = () => new PumpSdk();

function pubkeyEnv(name, what) {
  const k = env(name);
  if (!k) throw new Error(`the pad's ${what} wallet is not configured yet`);
  return new PublicKey(k);
}
/** The pot (20% of every coin): buys a coin back when its developer first claims. Public key only. */
export const potWallet = () => pubkeyEnv("PH_POT_PUBKEY", "pot");
/** The keeper (20%: the $paidhub buyback and the pad's work). Public key only. */
export const keeperWallet = () => pubkeyEnv("PH_KEEPER_PUBKEY", "keeper");

/** Pump's GitHub fee account for a numeric GitHub user id: only that person can ever take what lands here. */
export const githubPda = (userId) => SDK.socialFeePda(String(userId), GITHUB_PLATFORM);

/**
 * A coin's shareholders, in the order the launch writes them: the people (50% between them), the
 * pot, the keeper, the launcher. `people` are numeric GitHub ids as strings.
 */
export function shareholdersFor(launcher, people) {
  const shares = devShares(people.length);
  const holders = people.map((id, i) => ({ address: githubPda(id), shareBps: shares[i], githubId: String(id) }));
  holders.push({ address: potWallet(), shareBps: SHARES.pot });
  holders.push({ address: keeperWallet(), shareBps: SHARES.keeper });
  const launcherKey = new PublicKey(launcher);
  // pump refuses a duplicate shareholder: a launch from the keeper itself (golive's preflight) folds
  // the launcher's share into the keeper's row
  const keeperRow = holders[holders.length - 1];
  if (keeperRow.address.equals(launcherKey)) keeperRow.shareBps += SHARES.launcher;
  else holders.push({ address: launcherKey, shareBps: SHARES.launcher });
  return holders;
}

export const sharingConfigPda = (mint) =>
  PublicKey.findProgramAddressSync([Buffer.from("sharing-config"), new PublicKey(mint).toBuffer()], FEES)[0];

/** The coin's split, read off the chain. Null when pump has no config for it. */
export async function readSharingConfig(connection, mint) {
  const address = sharingConfigPda(new PublicKey(mint));
  const info = await connection.getAccountInfo(address);
  if (!info) return null;
  const decoded = decodeSharingConfig(info.data);
  return decoded && { address, ...decoded };
}

/** Byte offset of shareholder i's address inside a SharingConfig (for getProgramAccounts memcmp). */
export const SHAREHOLDER_OFFSET = (i) => 80 + 34 * i;
export const SHARING_CONFIG_SIZE = 1024;

/**
 * pump's SharingConfig, read by hand because this is the one account the pad has to trust:
 * 8 disc, bump, version, status, mint 32, admin 32, admin_revoked, then a Borsh vec of
 * {pubkey, u16 bps}. Checked against a real launch on the local chain in the suite.
 */
export function decodeSharingConfig(data) {
  if (!data || data.length < 80) return null;
  let o = 8;
  const bump = data[o++];
  const version = data[o++];
  const status = data[o++];
  const mint = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const admin = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const adminRevoked = data[o++] === 1;
  const n = data.readUInt32LE(o);
  o += 4;
  const shareholders = [];
  for (let i = 0; i < n && i < 10 && o + 34 <= data.length; i++) {
    shareholders.push({ address: new PublicKey(data.subarray(o, o + 32)), shareBps: data.readUInt16LE(o + 32) });
    o += 34;
  }
  return { bump, version, status, mint, admin, adminRevoked, shareholders };
}

/** pump's own rule (SDK isSharingConfigEditable): a config set once is final. */
export const isLocked = (config) => !!config && (config.version === 1 || config.adminRevoked);

/** Is this coin really on the pad? Only if its split is final and is exactly the pad's, row for row. */
export function isPadCoin(config, launcher, people) {
  if (!isLocked(config)) return false;
  let want;
  try {
    want = shareholdersFor(launcher, people);
  } catch {
    return false;
  }
  if (config.shareholders.length !== want.length) return false;
  return want.every((w) => config.shareholders.some((s) => s.address.equals(w.address) && s.shareBps === w.shareBps));
}

/**
 * pump's SocialFeePda (179 bytes): 8 disc, bump, version, user_id (Borsh string), platform u8,
 * total_claimed u64, last_claimed u64 (unix seconds), total_stable_claimed u64, 120 reserved. The lamports above rent are what
 * waits for the person; total_claimed is everything they ever took.
 */
export const SOCIAL_PDA_SIZE = 179;
export const SOCIAL_PDA_DISCRIMINATOR = Buffer.from([139, 96, 53, 17, 42, 169, 206, 150]);
export function decodeSocialPda(data) {
  if (!data || data.length < 16) return null;
  let o = 8;
  const bump = data[o++];
  const version = data[o++];
  const len = data.readUInt32LE(o);
  o += 4;
  if (len > 32 || o + len + 1 + 24 > data.length) return null;
  const userId = data.subarray(o, o + len).toString("utf8");
  o += len;
  const platform = data[o++];
  const totalClaimed = data.readBigUInt64LE(o);
  o += 8;
  const lastClaimed = Number(data.readBigUInt64LE(o));
  o += 8;
  const totalStableClaimed = data.readBigUInt64LE(o);
  return { bump, version, userId, platform, totalClaimed, lastClaimed, totalStableClaimed };
}

/** One person's GitHub fee account as the site shows it. Null fields when pump has not opened it yet. */
export async function readPerson(connection, userId) {
  const address = githubPda(userId);
  const info = await connection.getAccountInfo(address);
  if (!info) return { address: address.toBase58(), exists: false, waiting: 0, claimed: 0, lastClaimed: 0 };
  const rent = await connection.getMinimumBalanceForRentExemption(info.data.length);
  const d = decodeSocialPda(info.data);
  return {
    address: address.toBase58(),
    exists: true,
    waiting: Math.max(0, info.lamports - rent),
    claimed: Number(d?.totalClaimed || 0n),
    lastClaimed: d?.lastClaimed || 0,
  };
}

