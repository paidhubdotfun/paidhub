/**
 * The keeper's hands on the chain. Nothing here decides anything: it pays out a coin's fee vault to its
 * shareholders (pump's distribute), moves SOL, writes memos, buys and burns, with the signers it is handed.
 */
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  createBurnCheckedInstruction,
  createCloseAccountInstruction,
} from "@solana/spl-token";
import { online, readSharingConfig, sharingConfigPda } from "../server/lib/chain.js";
import { swapSolInto } from "./jupiter.mjs";

export const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const PRIORITY = 60_000; // micro-lamports per unit

export const memoInstruction = (payer, text) =>
  new TransactionInstruction({
    programId: MEMO_PROGRAM,
    keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
    data: Buffer.from(String(text).slice(0, 500), "utf8"),
  });

export async function buildTx(connection, payer, instructions, lookupTables = []) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message(lookupTables));
  return { tx, lastValidBlockHeight };
}

/** Land a signed transaction and wait for "confirmed", polling (never a websocket). */
export async function land(connection, tx, label = "tx") {
  const raw = tx.serialize();
  let sig = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 });
  const deadline = Date.now() + 90_000;
  let last = Date.now();
  for (;;) {
    const { value } = await connection.getSignatureStatuses([sig]);
    if (value[0]?.err) throw new Error(`${label} failed: ${JSON.stringify(value[0].err)}`);
    if (value[0]?.confirmationStatus === "confirmed" || value[0]?.confirmationStatus === "finalized") return sig;
    if (Date.now() > deadline) throw new Error(`${label} never confirmed (${sig})`);
    if (Date.now() - last > 2000) {
      last = Date.now();
      sig = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function sendTx(connection, payer, instructions, signers, label) {
  const { tx } = await buildTx(connection, payer.publicKey, instructions);
  tx.sign(signers);
  return land(connection, tx, label);
}

/** A shareholder wallet emptied to 0 SOL: pump (6070) or the runtime (rent) refuses a share too small to open it again. */
const UNINITIALIZED = /0x17b6\b|UninitializedAccount|InsufficientFundsForRent|insufficient funds for rent/i;
/** An emptied shareholder is topped up to rent only when the bucket's 10% for the keeper covers it. */
const TOPUP_WORTH = 12_000_000;

/**
 * Pay out a coin's fee vault to its shareholders (the people's GitHub fee accounts get their 50%).
 * Permissionless; the keeper pays the fee. Null when there is nothing worth paying yet, by pump's own view
 * of the bucket: below pump's minimum, or below `minLamports` (a sweep costs the keeper about 10 000
 * lamports, so a quiet coin waits until its bucket is worth one). The view leaves a pool's own bucket out
 * (pump-amm trades), so a pool coin is still tried when `poolDue`. Anything else that stops a sweep is an
 * error or a log line, never a quiet null.
 */
export async function collect(connection, { mint, keeper, minLamports = 0, poolDue = true, log = () => {} }) {
  const sdk = online(connection);
  const mintKey = new PublicKey(mint);
  const view = await sdk.getMinimumDistributableFee(mintKey, keeper.publicKey);
  const worth = BigInt(view.distributableFees.toString());
  const tryPool = view.isGraduated && poolDue;
  if ((!view.canDistribute || worth < BigInt(minLamports)) && !tryPool) {
    if (view.canDistribute || worth > 0n) return null;
    // the SDK turns a failed view into "nothing": if the vault holds SOL all the same, the view broke, so say so
    const vault = BigInt((await sdk.getCreatorVaultBalanceBothPrograms(sharingConfigPda(mintKey))).toString());
    if (vault < BigInt(Math.max(minLamports, 5_000_000))) return null;
    log(`pump's view of the bucket reads nothing, but the vault holds ${Number(vault) / 1e9} SOL: sweeping anyway`);
  }
  const built = await sdk.buildDistributeCreatorFeesInstructions(mintKey, { payer: keeper.publicKey });
  let topUps = [];
  const make = (units) =>
    buildTx(connection, keeper.publicKey, [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }), ...topUps, ...built.instructions]);
  const simulate = async () => (await connection.simulateTransaction((await make(400_000)).tx, { sigVerify: false, replaceRecentBlockhash: true })).value;
  let sim = await simulate();
  if (sim.err && UNINITIALIZED.test(`${JSON.stringify(sim.err)} ${(sim.logs || []).join(" ")}`)) {
    // usually the launcher's wallet, drained to 0 (a GitHub fee account always holds its rent): put it back to rent in the same transaction, when worth it
    if (worth < BigInt(TOPUP_WORTH)) {
      log(`a shareholder wallet of ${String(mint).slice(0, 6)} is empty; it is topped up once the bucket holds ${TOPUP_WORTH / 1e9} SOL (now ${Number(worth) / 1e9})`);
      return null;
    }
    const { shareholders } = (await readSharingConfig(connection, mint)) || { shareholders: [] };
    const infos = await connection.getMultipleAccountsInfo(shareholders.map((s) => s.address));
    const rent = await connection.getMinimumBalanceForRentExemption(0);
    topUps = shareholders.filter((_, i) => !infos[i]).map((s) => SystemProgram.transfer({ fromPubkey: keeper.publicKey, toPubkey: s.address, lamports: rent }));
    if (topUps.length) {
      log(`topping up ${topUps.length} empty shareholder wallet(s) of ${String(mint).slice(0, 6)} to rent so pump can pay them`);
      sim = await simulate();
    }
  }
  if (sim.err && tryPool && !view.canDistribute) {
    log(`pool coin: nothing to sweep yet (looked again after 3 h)`);
    return null;
  }
  if (sim.err) throw new Error(`collect would fail: ${JSON.stringify(sim.err)} ${(sim.logs || []).join(" ").slice(-240)}`);
  // the priority fee is paid on the limit asked for, so ask for what the sweep measured, with room
  const units = Number(sim.unitsConsumed || 0);
  const { tx } = await make(units ? Math.min(400_000, Math.ceil(units * 1.25) + 5_000) : 400_000);
  tx.sign([keeper]);
  return land(connection, tx, `collect ${String(mint).slice(0, 6)}`);
}

/** Plain SOL from one pad wallet to another. */
export async function transfer(connection, { from, to, lamports }) {
  return sendTx(connection, from, [ComputeBudgetProgram.setComputeUnitLimit({ units: 2_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }), SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: new PublicKey(to), lamports })], [from], "transfer");
}

export async function memo(connection, { payer, text }) {
  return sendTx(connection, payer, [ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }), memoInstruction(payer.publicKey, text)], [payer], "memo");
}

/** Burn every unit of `mint` that `owner` holds. Never a transfer to a dead address. */
export async function burnAll(connection, { owner, mint }) {
  const mintKey = new PublicKey(mint);
  const info = await connection.getAccountInfo(mintKey);
  if (!info) return null;
  const program = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const account = getAssociatedTokenAddressSync(mintKey, owner.publicKey, true, program);
  let bal;
  try {
    bal = await getAccount(connection, account, "confirmed", program);
  } catch {
    return null;
  }
  if (bal.amount === 0n) return null;
  const supply = await connection.getTokenSupply(mintKey);
  const sig = await sendTx(
    connection,
    owner,
    [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 }),
      createBurnCheckedInstruction(account, mintKey, owner.publicKey, bal.amount, supply.value.decimals, [], program),
      // the emptied token account is closed, so its rent goes back to the wallet that bought
      createCloseAccountInstruction(account, owner.publicKey, owner.publicKey, [], program),
    ],
    [owner],
    `burn ${String(mint).slice(0, 6)}`
  );
  return { sig, amount: bal.amount.toString() };
}

/** Buy `mint` with `lamports` of the owner's SOL (Jupiter: curve or pool alike) and burn what was bought. */
export async function buyAndBurn(connection, { owner, mint, lamports, swap = swapSolInto }) {
  const bought = await swap({ connection, mint, lamports, owner });
  const burned = await burnAll(connection, { owner, mint });
  return { buySig: bought?.signature || null, bought: bought?.amount || 0, burnSig: burned?.sig || null, burned: burned?.amount || "0" };
}
