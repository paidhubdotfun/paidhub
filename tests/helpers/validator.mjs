/**
 * A local chain carrying the REAL pump programs, loaded at genesis from the dumps in
 * tests/fixtures (a cloned upgradeable program copies the account without
 * its program data and never executes).
 *
 * Everything about how this is started is a scar:
 *  - the script lives inside WSL at a plain path, because this repo's own path carries a `$` and
 *    spaces and bash eats both;
 *  - the validator is a HELD child of this process, not a detached one: a detached start through
 *    wsl.exe returns 0 and leaves nothing running;
 *  - the project owns its ports (the default gossip 8000 is what actually collides between
 *    sessions on this box);
 *  - readiness is getSlot >= 3 plus an airdrop that returns a signature, because getHealth answers
 *    "ok" well before the chain can take a transaction;
 *  - confirmations are polled with getSignatureStatuses, never confirmTransaction, which
 *    subscribes over the websocket and hangs forever when that socket is refused.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURES = path.join(ROOT, "tests", "fixtures");

export const PORTS = {
  rpc: 8991,
  faucet: 9991,
  gossip: 9891,
  dynamic: "10500-10600",
};
// the WSL user's own home: /root is not writable on every box this runs on
const HOME = `${spawnSync("wsl", ["-e", "bash", "-lc", "echo $HOME"], { encoding: "utf8" }).stdout.trim() || "/tmp"}/paidhub`;
const WORK = `${HOME}/chain`;

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const wsl = (args, opts = {}) =>
  spawnSync("wsl", ["-e", "bash", "-lc", args], { encoding: "utf8", ...opts });

/** Copy the dumps into WSL's own filesystem: /mnt paths are slow and this one carries a `$`. */
function stageFixtures() {
  const src = "/mnt/" + FIXTURES[0].toLowerCase() + FIXTURES.slice(2).replace(/\\/g, "/");
  const r = wsl(`rm -rf ${q(WORK)} && mkdir -p ${q(WORK + "/fixtures")} && cp -r ${q(src)}/. ${q(WORK + "/fixtures")}/ && ls ${q(WORK + "/fixtures")} | wc -l`);
  if (r.status !== 0) throw new Error(`staging fixtures failed: ${r.stderr || r.stdout}`);
  return Number(r.stdout.trim());
}

/**
 * The accounts are fed in as a directory, but the validator tries to deserialise EVERY json in it,
 * so the manifest is left behind, and `rentEpoch: u64::MAX` has to be spliced in as text because
 * JSON.stringify turns it into 1.8446744073709552e+19 and the validator refuses the whole folder.
 */
function stageAccounts(patch = {}) {
  const dir = path.join(FIXTURES);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "manifest.json" && !f.endsWith("-key.json"));
  const out = `${WORK}/accounts`;
  wsl(`mkdir -p ${q(out)}`);
  for (const f of files) {
    const raw = fs.readFileSync(path.join(dir, f), "utf8");
    const patched = patch[f] ? patch[f](raw) : raw;
    const fixed = patched.replace(/"rentEpoch"\s*:\s*[0-9.eE+]+/, '"rentEpoch": 18446744073709551615');
    const tmp = path.join(FIXTURES, `.staged-${f}`);
    fs.writeFileSync(tmp, fixed);
    const src = "/mnt/" + tmp[0].toLowerCase() + tmp.slice(2).replace(/\\/g, "/");
    wsl(`cp ${q(src)} ${q(`${out}/${f}`)}`);
    fs.unlinkSync(tmp);
  }
  return files.length;
}

/** `patch` maps a fixture file name to a function that rewrites its JSON text before the chain loads it. */
export async function startValidator({ log = console.log, patch = {} } = {}) {
  if (!fs.existsSync(path.join(FIXTURES, "pump.so"))) {
    throw new Error("tests/fixtures is empty: run `node tools/fixtures.mjs` first");
  }
  const n = stageFixtures();
  const accounts = stageAccounts(patch);
  log(`  staged ${n} fixtures, ${accounts} accounts into WSL`);

  const flags = [
    "--reset --quiet",
    "--ledger ledger",
    `--rpc-port ${PORTS.rpc}`,
    `--faucet-port ${PORTS.faucet}`,
    `--gossip-port ${PORTS.gossip}`,
    `--dynamic-port-range ${PORTS.dynamic}`,
    "--bpf-program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P fixtures/pump.so",
    "--bpf-program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA fixtures/pump_amm.so",
    "--bpf-program pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ fixtures/pump_fees.so",
    "--bpf-program MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e fixtures/mayhem.so",
    "--account-dir accounts",
  ].join(" \\\n  ");
  const script = `#!/bin/bash
set -e
cd ${WORK}
rm -rf ledger
echo $$ > validator.pid
exec solana-test-validator \\
  ${flags}
`;

  fs.mkdirSync(path.join(ROOT, ".cache"), { recursive: true });
  const local = path.join(ROOT, ".cache", "validator.sh");
  fs.writeFileSync(local, script.replace(/\r/g, ""), { encoding: "utf8" });
  const src = "/mnt/" + local[0].toLowerCase() + local.slice(2).replace(/\\/g, "/");
  const copied = wsl(`cp ${q(src)} ${q(WORK + "/validator.sh")} && sed -i 's/\\r$//' ${q(WORK + "/validator.sh")} && wc -l ${q(WORK + "/validator.sh")}`);
  if (copied.status !== 0) throw new Error(`could not place validator.sh: ${copied.stderr}`);

  const logFile = path.join(ROOT, ".cache", "validator.log");
  const fd = fs.openSync(logFile, "w");
  const child = spawn("wsl", ["-e", "bash", "-lc", `exec bash ${WORK}/validator.sh`], {
    stdio: ["ignore", fd, fd],
  });
  let exited = null;
  child.on("exit", (code) => (exited = code));

  const connection = new Connection(`http://127.0.0.1:${PORTS.rpc}`, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60000,
  });
  const payer = Keypair.generate();
  const deadline = Date.now() + 120000;
  let ready = false;
  while (Date.now() < deadline) {
    if (exited !== null) {
      throw new Error(`validator exited early (${exited}):\n${fs.readFileSync(logFile, "utf8").slice(-2000)}`);
    }
    try {
      const slot = await connection.getSlot();
      if (slot >= 3) {
        await connection.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
        ready = true;
        break;
      }
    } catch {
      /* not up yet */
    }
    await sleep(700);
  }
  if (!ready) {
    child.kill("SIGKILL");
    throw new Error(`validator never became ready:\n${fs.readFileSync(logFile, "utf8").slice(-2000)}`);
  }
  await sleep(2000);
  log(`  validator up on ${PORTS.rpc}`);

  return {
    connection,
    stop() {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      // kill only OUR process: a broad pkill takes out other sessions' validators (and the
      // pattern has to be broken up, or pkill matches the shell running it)
      wsl(`[ -f ${q(WORK + "/validator.pid")} ] && kill -9 $(cat ${q(WORK + "/validator.pid")}) 2>/dev/null; true`);
      try { fs.closeSync(fd); } catch { /* already closed */ }
    },
    alive: () => exited === null,
    logTail: () => fs.readFileSync(logFile, "utf8").slice(-3000),
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fund(connection, pubkey, sol = 10) {
  const sig = await connection.requestAirdrop(new PublicKey(pubkey), sol * LAMPORTS_PER_SOL);
  await waitForSignature(connection, sig);
  return sig;
}

/** Poll, never subscribe. And re-send: the local chain drops first packets often enough. */
export async function sendAndConfirm(connection, tx, signers = [], { label = "tx", resendMs = 1500 } = {}) {
  if (signers.length) tx.sign(signers);
  const raw = tx.serialize();
  let signature = null;
  const deadline = Date.now() + 60000;
  let lastSend = 0;
  while (Date.now() < deadline) {
    if (Date.now() - lastSend > resendMs) {
      lastSend = Date.now();
      signature = await connection.sendRawTransaction(raw, {
        skipPreflight: false,
        maxRetries: 0,
      });
    }
    const status = await connection.getSignatureStatuses([signature]);
    const value = status.value[0];
    if (value) {
      if (value.err) throw new Error(`${label} failed on chain: ${JSON.stringify(value.err)}`);
      if (value.confirmationStatus === "confirmed" || value.confirmationStatus === "finalized") {
        return signature;
      }
    }
    await sleep(400);
  }
  throw new Error(`${label} never confirmed (${signature})`);
}

export async function waitForSignature(connection, signature, ms = 45000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature]);
    if (value[0]?.err) throw new Error(`signature failed: ${JSON.stringify(value[0].err)}`);
    if (value[0]?.confirmationStatus === "confirmed" || value[0]?.confirmationStatus === "finalized") return;
    await sleep(350);
  }
  throw new Error(`signature ${signature} never confirmed`);
}

export function deserialize(base64) {
  return VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
}
