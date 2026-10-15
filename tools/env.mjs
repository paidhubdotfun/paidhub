// Reads keys out of a .config/.env next to (or above) the repo, so no file in the repo ever carries a key.
// Nothing here writes a key anywhere.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The nearest .config/.env above the repo (PH_ENV_FILE overrides it). */
export function envFile() {
  if (process.env.PH_ENV_FILE) return process.env.PH_ENV_FILE;
  let dir = ROOT;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, ".config", ".env");
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return path.join(os.homedir(), ".config", ".env");
}

export function readEnv() {
  const file = envFile();
  const out = { ...process.env };
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    // A trailing newline inside a quoted value is a real source of "invalid key" at 2am.
    if (m && out[m[1]] === undefined) out[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, "$1");
  }
  return out;
}

/** The mainnet RPC used for dumps, IDL fetches and the preflight simulations. */
export function rpcUrl(env = readEnv()) {
  if (env.PH_RPC_URL) return env.PH_RPC_URL;
  if (env.SOLANATRACKER_RPC_URL) return env.SOLANATRACKER_RPC_URL;
  if (env.HELIUS_RPC_URL) return env.HELIUS_RPC_URL;
  if (env.HELIUS_API_KEY) return `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
  throw new Error("no mainnet RPC: set HELIUS_API_KEY or HELIUS_RPC_URL in .config/.env");
}
