#!/usr/bin/env node
/**
 * The keeper process on this PC: the pad (keeper/pad.mjs) on a 20 second pulse, with the pad's two
 * keys from G:Web.config.env, the paid RPC first, Helius for the full reads, GitHub through the gh
 * CLI's token (read into memory at start, never written anywhere), and everything published to the
 * pad's Blob store for the site.
 *
 *   node keeper/keeper.mjs            run forever
 *   node keeper/keeper.mjs --once     one pulse, then exit (a check)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import bs58 from "bs58";
import { Connection, Keypair } from "@solana/web3.js";
import { readEnv } from "../tools/env.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = readEnv();
for (const k of ["HELIUS_API_KEY", "SOLANATRACKER_RPC_URL", "SOLANATRACKER_DATA_KEY", "OPENROUTER_API_KEY", "PH_RPCS", "PH_GPA_RPC", "JUPITER_API_KEY", "PH_SITE_URL", "PH_GH_CLIENT_ID", "PH_GH_CLIENT_SECRET"]) if (env[k] && !process.env[k]) process.env[k] = env[k];
if (!process.env.PH_GITHUB_TOKEN) {
  const t = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
  if (t.status === 0 && t.stdout.trim()) process.env.PH_GITHUB_TOKEN = t.stdout.trim();
}
if (env.PH_BLOB_TOKEN && !process.env.PH_STATE_DIR) process.env.BLOB_READ_WRITE_TOKEN = env.PH_BLOB_TOKEN;

const key = (name) => {
  if (!env[name]) throw new Error(`${name} is missing from .config/.env (the keeper and pot keys are made once at setup)`);
  return Keypair.fromSecretKey(bs58.decode(env[name]));
};
const keeper = key("PH_KEEPER_KEY");
const pot = key("PH_POT_KEY");
process.env.PH_KEEPER_PUBKEY = keeper.publicKey.toBase58();
process.env.PH_POT_PUBKEY = pot.publicKey.toBase58();

const { rpcUrls } = await import("../server/lib/chain.js");
const { openStore } = await import("../server/lib/store.js");
const { Pad } = await import("./pad.mjs");
const chain = await import("./chain.mjs");
const { marketReader } = await import("./market.mjs");
const { makeScout } = await import("./scout.mjs");

const connection = new Connection(rpcUrls()[0], { commitment: "confirmed" });
const gpaUrl = env.PH_GPA_RPC || (env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}` : rpcUrls()[0]);
const gpa = new Connection(gpaUrl, { commitment: "confirmed" });

const LOG = path.join(ROOT, "logs", "keeper.log");
fs.mkdirSync(path.dirname(LOG), { recursive: true });

// one keeper at a time: two could each send the same buyback part
const LOCK = path.join(ROOT, ".state", "keeper.lock");
fs.mkdirSync(path.dirname(LOCK), { recursive: true });
/** Is this pid a running keeper? A pid Windows handed to another program after a crash is not. */
function isKeeper(pid) {
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e.code !== "EPERM") return false;
  }
  const r = spawnSync("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`], { encoding: "utf8" });
  if (r.error || r.status !== 0) return true; // cannot tell: never risk two keepers
  return /keeper[\\/]keeper\.mjs/.test(r.stdout);
}
try {
  fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" });
} catch {
  // a live keeper is never taken over, however long its pulse runs; only a crash leaves a lock behind
  const other = Number(fs.readFileSync(LOCK, "utf8"));
  if (other && other !== process.pid && isKeeper(other)) {
    console.log(`another keeper is running (pid ${other}); this one stops`);
    process.exit(0);
  }
  fs.writeFileSync(LOCK, String(process.pid));
}
/** Still this keeper's lock? Checked every pulse and before any buyback part is sent. */
const owns = () => {
  try {
    return Number(fs.readFileSync(LOCK, "utf8")) === process.pid;
  } catch {
    return false;
  }
};
const unlock = () => {
  try {
    if (Number(fs.readFileSync(LOCK, "utf8")) === process.pid) fs.unlinkSync(LOCK);
  } catch {}
};
process.on("exit", unlock);
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(sig, () => process.exit(0));
const log = (m) => {
  const line = `${new Date().toISOString()} ${m}`;
  console.log(line);
  fs.appendFileSync(LOG, `${line}\n`);
};

// $paidhub's mint is the CA written into public/config.js at launch: read it off the live site
let padCa = { mint: env.PH_PAD_MINT || null, at: 0 };
async function padMint() {
  const site = env.PH_SITE_URL || process.env.PH_SITE_URL;
  if (site && Date.now() - padCa.at > 10 * 60_000) {
    padCa.at = Date.now();
    const txt = await fetch(`${site.replace(/\/$/, "")}/config.js?t=${Date.now()}`).then((r) => r.text()).catch(() => "");
    const m = txt.match(/\bCA:\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"/);
    if (m) padCa.mint = m[1];
  }
  return padCa.mint;
}

const store = openStore();
const pad = new Pad({
  connection,
  gpa,
  store,
  keeper,
  pot,
  chain,
  padMint,
  market: marketReader(),
  scout: makeScout({ store, log: (m) => log(m) }),
  stateDir: path.join(ROOT, ".state", "keeper"),
  owns,
  log: (m) => log(m),
});

log(`paidhub keeper ${keeper.publicKey.toBase58()} · pot ${pot.publicKey.toBase58()} · store ${store.where} · github ${process.env.PH_GITHUB_TOKEN ? "token" : "anonymous"}`);
const once = process.argv.includes("--once");
for (;;) {
  const t = Date.now();
  if (!owns()) {
    log("the keeper lock now belongs to another process: this keeper stops");
    process.exit(0);
  }
  try {
    const state = await pad.pulse();
    if (once) log(`pulse: ${state.coins.length} coins published`);
  } catch (e) {
    log(`pulse failed: ${String(e?.message || e).slice(0, 300)}`);
  }
  if (once) break;
  await new Promise((r) => setTimeout(r, Math.max(2_000, 20_000 - (Date.now() - t))));
}
