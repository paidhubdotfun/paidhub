/**
 * The launch transaction's address lookup table.
 *
 * pump's create + ATA + buy is about 1700 bytes written out in full and 1128 with a table, so the
 * table is not an optimisation, it is the difference between a launch that can be signed and one
 * that cannot. Its contents are MEASURED, not listed: two sample launches are built for different
 * mints and different devs and the accounts they have in common are the static ones. On top of
 * that go every one of pump's fee recipients and their wrapped SOL accounts, because pump picks
 * one at random per build and a table missing the one it picked swings the size by ~128 bytes.
 */
import fs from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import anchor from "@coral-xyz/anchor";
import { SDK, WSOL, online, offline } from "./chain.js";
import { findFile } from "./paths.js";

const { BN } = anchor;
/** Every fee recipient the dumped mainnet Global carries, or an explicit list. */
export function feeRecipients() {
  const file = findFile([["tests", "fixtures", "manifest.json"]]);
  if (file) {
    return JSON.parse(fs.readFileSync(file, "utf8")).feeRecipients.map((a) => new PublicKey(a));
  }
  return [];
}

export async function deriveTableAddresses(connection, extra = []) {
  const sdk = offline();
  const net = online(connection);
  const global = await net.fetchGlobal();

  const sample = async () => {
    const mint = Keypair.generate().publicKey;
    const user = Keypair.generate().publicKey;
    const ixs = await sdk.createV2AndBuyV2Instructions({
      global,
      mint,
      name: "sample",
      symbol: "SMPL",
      uri: "https://example.invalid/x.json",
      creator: user,
      user,
      amount: new BN(1_000_000),
      quoteAmount: new BN(100_000_000),
      mayhemMode: false,
      quoteMint: WSOL,
    });
    const keys = new Set();
    for (const ix of ixs) {
      keys.add(ix.programId.toBase58());
      for (const k of ix.keys) if (!k.isSigner) keys.add(k.pubkey.toBase58());
    }
    return keys;
  };

  const a = await sample();
  const b = await sample();
  const common = [...a].filter((k) => b.has(k));

  const all = new Set(common);
  for (const r of feeRecipients()) {
    all.add(r.toBase58());
    all.add(getAssociatedTokenAddressSync(WSOL, r, true, TOKEN_PROGRAM_ID).toBase58());
  }
  // the fee sharing pair's own fixed accounts, so the second transaction shrinks too
  for (const k of [SDK.PUMP_FEE_PROGRAM_ID, SDK.PUMP_FEE_EVENT_AUTHORITY_PDA, SDK.FEE_PROGRAM_GLOBAL_PDA,
                   SDK.PUMP_PROGRAM_ID, SDK.PUMP_EVENT_AUTHORITY_PDA, SDK.PUMP_AMM_PROGRAM_ID,
                   SDK.PUMP_AMM_EVENT_AUTHORITY_PDA, SDK.PUMP_FEE_CONFIG_PDA, SDK.GLOBAL_PDA,
                   SDK.GLOBAL_VOLUME_ACCUMULATOR_PDA, SDK.MAYHEM_PROGRAM_ID, WSOL]) {
    if (k) all.add(k.toBase58());
  }
  // the pad's own wallet sits in every coin's split, and the rent transfer names the system program
  for (const k of [...extra, "11111111111111111111111111111111"]) all.add(String(k));
  return [...all].map((k) => new PublicKey(k));
}
