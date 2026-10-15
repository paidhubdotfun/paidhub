#!/usr/bin/env node
/**
 * Dump the real mainnet pump programs and the accounts they read, so the test suite runs against
 * the code that will actually run on mainnet. `[[test.validator.clone]]`
 * of an upgradeable program copies the program account WITHOUT its program data and never
 * executes, so everything here is dumped and loaded at genesis instead.
 *
 *   node tools/fixtures.mjs            # writes tests/fixtures/*.so and *.json (gitignored)
 *   node tools/fixtures.mjs --force    # re-dump even what is already there
 *
 * Needs solana-cli. On Windows it runs through WSL.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PublicKey } from "@solana/web3.js";
import * as SDK from "@pump-fun/pump-sdk";
import { rpcUrl } from "./env.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "tests", "fixtures");
const force = process.argv.includes("--force");
fs.mkdirSync(DIR, { recursive: true });

const PROGRAMS = {
  pump: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  pump_amm: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  pump_fees: "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
  mayhem: "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e",
};

/** Singleton accounts those programs read on every instruction. */
const ACCOUNTS = {
  pump_global: "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf",
  pump_fee_config: "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt",
  pump_volume_accumulator: "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y",
  fee_program_global: "CHqnuTkj6sXDFknM652aEFPECZh9qVsBXWkhPohmV9dA",
  amm_global: "HsC37rNFvJgpfH7y2Y6kqnwEQN4WfdM5FLArWnux5GUs",
  amm_volume_accumulator: "C2aFPdENg4A2HQsmrd5rTw5TaYBX5Ku887cWjbFKtZpw",
  quote_control: "6z6GDdfb2AjR9ZhJmAUQ5cipJCVxQvLJhB2H8mCwTFBP",
};
// and whatever the installed SDK derives today (SDK 4 moved pump-amm's GlobalConfig to its real PDA)
for (const [name, key] of Object.entries({
  sdk_global: SDK.GLOBAL_PDA, sdk_fee_config: SDK.PUMP_FEE_CONFIG_PDA, sdk_volume: SDK.GLOBAL_VOLUME_ACCUMULATOR_PDA,
  sdk_fee_global: SDK.FEE_PROGRAM_GLOBAL_PDA, sdk_amm_global: SDK.AMM_GLOBAL_PDA, sdk_amm_volume: SDK.AMM_GLOBAL_VOLUME_ACCUMULATOR_PDA,
  sdk_quote_control: SDK.QUOTE_CONTROL_PDA,
})) {
  if (key && !Object.values(ACCOUNTS).includes(key.toBase58())) ACCOUNTS[name] = key.toBase58();
}

const WSL = process.platform === "win32";
// Single quotes, always: this repo's own path carries a `$` and spaces, and a double quoted
// argument in `bash -lc` would silently expand it into nothing.
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
function solana(args, { capture = true } = {}) {
  const cmd = WSL
    ? ["wsl", ["-e", "bash", "-lc", `solana ${args.join(" ")}`]]
    : ["solana", args.map((a) => a.replace(/^'|'$/g, ""))];
  const r = spawnSync(cmd[0], cmd[1], { encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (r.status !== 0) throw new Error(`solana ${args[0]} failed: ${r.stderr || r.stdout}`);
  return r.stdout || "";
}
const wslPath = (p) =>
  WSL ? "/mnt/" + p[0].toLowerCase() + p.slice(2).replace(/\\/g, "/") : p;

const url = rpcUrl();
console.log(`dumping from ${url.replace(/(api[-_]key=).*/, "$1***")}`);

for (const [name, id] of Object.entries(PROGRAMS)) {
  const out = path.join(DIR, `${name}.so`);
  if (fs.existsSync(out) && !force) { console.log(`  ${name}.so  (have)`); continue; }
  solana(["program", "dump", id, q(wslPath(out)), "-u", q(url)]);
  console.log(`  ${name}.so  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

/**
 * pump picks one of sixteen fee recipients per build and the SDK picks a buyback recipient from
 * its own list, so EVERY one of them (and its wrapped SOL account) has to exist on the local
 * chain with its real lamports, or a launch fails with NotAuthorized (6000).
 * Their addresses are not reliably parseable out of Global by field (the deployed account does not
 * match its published IDL), so the funded system accounts are found by walking every byte offset.
 */
const globalInfo = await fetchAccount(ACCOUNTS.pump_global);
const recipients = await findRecipients(Buffer.from(globalInfo.data[0], "base64"));
console.log(`  fee recipients found in Global: ${recipients.length}`);

const extra = {};
for (const r of recipients) extra[`fee_recipient_${r}`] = r;


let saved = 0;
const missing = [];
for (const [name, id] of Object.entries({ ...ACCOUNTS, ...extra })) {
  const out = path.join(DIR, `${name}.json`);
  if (fs.existsSync(out) && !force) { saved++; continue; }
  try {
    solana(["account", id, "--output", "json", "--output-file", q(wslPath(out)), "-u", q(url)]);
    saved++;
  } catch (e) {
    // Some SDK constants point at accounts the deployed programs never created; the suite does not
    // need an account the instruction does not read, so a gap here is reported, not fatal.
    missing.push(name);
  }
}
console.log(`  ${saved} accounts${missing.length ? `, not on chain: ${missing.join(", ")}` : ""}`);

fs.writeFileSync(
  path.join(DIR, "manifest.json"),
  JSON.stringify({ programs: PROGRAMS, accounts: ACCOUNTS, feeRecipients: recipients }, null, 2)
);
console.log(`wrote ${path.join(DIR, "manifest.json")}`);

// --------------------------------------------------------------------------

async function fetchAccount(address) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "getAccountInfo",
      params: [address, { encoding: "base64" }],
    }),
  });
  const json = await res.json();
  if (!json.result?.value) throw new Error(`no account ${address}`);
  return json.result.value;
}

/** Every 32 byte window of Global that is a funded, data-less system account is a recipient. */
async function findRecipients(data) {
  const seen = new Set();
  const candidates = [];
  for (let i = 8; i + 32 <= data.length; i++) {
    const key = new PublicKey(data.subarray(i, i + 32));
    const b58 = key.toBase58();
    if (seen.has(b58) || key.equals(PublicKey.default)) continue;
    seen.add(b58);
    candidates.push(b58);
  }
  const found = [];
  for (let i = 0; i < candidates.length; i += 100) {
    const batch = candidates.slice(i, i + 100);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "getMultipleAccounts",
        params: [batch, { encoding: "base64" }],
      }),
    });
    const { result } = await res.json();
    result.value.forEach((v, j) => {
      if (v && v.owner === "11111111111111111111111111111111" && v.lamports > 0 && v.data[0] === "") {
        found.push(batch[j]);
      }
    });
  }
  return found;
}
