/**
 * The wallet, and only where the mechanic needs one: a launch is two transactions signed in one
 * approval. Reading coins, the board and people needs no wallet. The pad never asks for a
 * transaction it did not build itself.
 */
const PROVIDERS = [
  { key: "phantom", label: "Phantom", at: () => window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : null) },
  { key: "solflare", label: "Solflare", at: () => window.solflare?.isSolflare ? window.solflare : null },
  { key: "backpack", label: "Backpack", at: () => window.backpack?.isBackpack ? window.backpack : null },
];

export function available() {
  return PROVIDERS.map((p) => ({ ...p, provider: p.at() })).filter((p) => p.provider);
}

let current = null;

export function connected() {
  return current;
}

export async function connect(key) {
  const found = available();
  if (!found.length) {
    throw new Error("no Solana wallet in this browser. Phantom, Solflare and Backpack all work.");
  }
  const pick = key ? found.find((p) => p.key === key) : found[0];
  if (!pick) throw new Error("that wallet is not in this browser");
  const { publicKey } = await pick.provider.connect();
  current = { key: pick.key, label: pick.label, provider: pick.provider, address: publicKey.toString() };
  pick.provider.on?.("disconnect", () => (current = null));
  pick.provider.on?.("accountChanged", () => (current = null));
  return current;
}

export async function disconnect() {
  try {
    await current?.provider?.disconnect?.();
  } finally {
    current = null;
  }
}

/**
 * Sign every transaction of a launch in ONE approval. A wallet without signAllTransactions falls
 * back to signing them one at a time, which is two approvals and the same result.
 */
export async function signAll(base64List) {
  if (!current) throw new Error("connect a wallet first");
  const { VersionedTransaction } = await import("@solana/web3.js");
  const txs = base64List.map((b) => VersionedTransaction.deserialize(base64ToBytes(b)));
  const signed = current.provider.signAllTransactions
    ? await current.provider.signAllTransactions(txs)
    : await Promise.all(txs.map((t) => current.provider.signTransaction(t)));
  return signed.map((t) => bytesToBase64(t.serialize()));
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
