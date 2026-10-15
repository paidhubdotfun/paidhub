/**
 * The one thing derived from PH_SECRET: launch mint keys, so a rebuild of the same launch within
 * the hour lands on the same mint and a lost signature never makes two coins. The secret never
 * leaves the environment and no wallet that holds money is derived from it.
 */
import crypto from "node:crypto";
import { Keypair } from "@solana/web3.js";

function secret() {
  const s = process.env.PH_SECRET;
  if (!s || s.length < 32) throw new Error("PH_SECRET is not set");
  return s;
}

export function mintFor(wallet, symbol, nonce) {
  return Keypair.fromSeed(crypto.createHmac("sha256", secret()).update(`mint:${wallet}:${symbol}:${nonce}`).digest());
}
