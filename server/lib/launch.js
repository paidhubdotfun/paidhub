/**
 * paidhub's launch: an ORDINARY top level pump transaction signed by the launcher, with the creator
 * fee split locked in a second transaction the same wallet signs: 50% between the repo's people
 * (pump's GitHub fee accounts, which only they can ever empty), 20% the pot, 20% the keeper, 10% the
 * launcher. pump lets a split be set once only, so the second transaction makes it final.
 *
 * Never a CPI: a coin whose creator is not the wallet that signed the mint transaction is tagged
 * "Offchain" by Axiom and GMGN, so the pad builds the instructions and the user's wallet signs them.
 *
 * Two transactions because one does not fit: create + ATA + buy is ~1100 bytes as v0 even with the
 * static accounts in a lookup table. The second opens each person's GitHub fee account (idempotent:
 * pump accepts a create on an account that already exists), the sharing config, and locks the split.
 * The wallet approves both at once with signAllTransactions and the server sends them in order.
 */
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import anchor from "@coral-xyz/anchor";
import { SDK, WSOL, online, offline, shareholdersFor } from "./chain.js";
import { GITHUB_PLATFORM } from "../../shared/rules.js";

const { BN } = anchor;

/** pump's own ceiling on the first buy, and ours on the smallest one worth making. */
export const DEV_BUY = { min: 10_000_000, max: 5_000_000_000 }; // 0.01 .. 5 SOL

/**
 * Transaction 1: create the coin and make the launcher's first buy.
 * Transaction 2: open the people's GitHub fee accounts and the sharing config, lock the split.
 */
export async function buildLaunch({
  connection,
  user,
  people,
  name,
  symbol,
  uri,
  devBuyLamports,
  slippagePercent = 6,
  lookupTable = null,
  mintKey = Keypair.generate(),
}) {
  const sdk = offline();
  const net = online(connection);
  const mint = mintKey.publicKey;

  const global = await net.fetchGlobal();
  const feeConfig = await net.fetchFeeConfig().catch(() => null);
  const quoteControl = await net.fetchQuoteControl().catch(() => null);

  // buy_exact_quote_in_v2 answers BuyZeroAmount on a fresh SOL curve, so the buy is sized here:
  // tokens for the SOL we mean to spend, then the SOL that token amount really costs, then the
  // slippage on top of THAT (quoteAmount is a ceiling, not the amount).
  const lamports = new BN(Math.round(devBuyLamports));
  const amount = SDK.getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: null,
    bondingCurve: null,
    amount: lamports,
    quoteMint: WSOL,
    quoteControl,
  });
  const needed = SDK.getBuySolAmountFromTokenAmount({
    global,
    feeConfig,
    mintSupply: null,
    bondingCurve: null,
    amount,
    quoteMint: WSOL,
    quoteControl,
  });
  const quoteAmount = needed.muln(Math.round((100 + slippagePercent) * 100)).divn(10000);

  const tables = lookupTable ? [lookupTable] : [];
  const topUp = await mintRentTopUp({ connection, payer: user, mint, name, symbol, uri });
  const build = async () => [
    ...(await sdk.createV2AndBuyV2Instructions({
      global,
      mint,
      name,
      symbol,
      uri,
      creator: user,
      user,
      amount,
      quoteAmount,
      mayhemMode: false,
      quoteMint: WSOL,
    })),
    ...topUp,
  ];
  const createAndBuy = await acceptedRecipients(connection, build, user, tables);

  // The fee program alone spends about 100k units and the whole pair blows past 400k.
  const budget1 = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 120_000 }),
  ];
  const budget2 = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 120_000 }),
  ];

  const shareIxs = await feeShareInstructions({ sdk, user, mint, people });

  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const tx1 = v0(user, blockhash, [...budget1, ...createAndBuy], tables);
  tx1.sign([mintKey]); // the mint is a signer of its own creation; the user signs the rest
  const tx2 = v0(user, blockhash, [...budget2, ...shareIxs], tables);

  return {
    mint: mint.toBase58(),
    amount: amount.toString(),
    quoteAmount: quoteAmount.toString(),
    transactions: [serialize(tx1), serialize(tx2)],
  };
}

/**
 * The second transaction on its own, so a launch whose second signature was lost can be finished
 * without minting a second coin: the coin exists, the launcher is still its creator, and the
 * shares have not been set yet.
 */
export async function buildFeeShare({ connection, user, mint, people, lookupTable = null }) {
  const sdk = offline();
  const ixs = await feeShareInstructions({ sdk, user, mint, people });
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = v0(
    user,
    blockhash,
    [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 120_000 }),
      ...ixs,
    ],
    lookupTable ? [lookupTable] : []
  );
  return { transactions: [serialize(tx)] };
}

async function feeShareInstructions({ sdk, user, mint, people }) {
  if (!Array.isArray(people) || !people.length) throw new Error("a coin needs at least one person to pay");
  // each person's GitHub fee account, opened by the launcher (rent ~0.0016 SOL, once per person ever)
  const open = [];
  for (const id of people) open.push(await sdk.createSocialFeePda({ payer: user, userId: String(id), platform: GITHUB_PLATFORM }));
  // create_fee_sharing_config leaves the creator as the only shareholder and makes the sharing
  // config PDA the curve's creator, so update_fee_shares_v2 has to name the CREATOR as the current
  // shareholder: an empty list is 6013, a wrong one is 6020.
  const create = await sdk.createFeeSharingConfig({ creator: user, mint, pool: null });
  const update = await sdk.updateFeeSharesV2({
    authority: user,
    mint,
    currentShareholders: [user],
    newShareholders: shareholdersFor(user, people).map(({ address, shareBps }) => ({ address, shareBps })),
    quoteMint: WSOL,
    quoteTokenProgram: TOKEN_PROGRAM_ID,
    bondingCurveComplete: false,
  });
  return [...open, create, update];
}

/**
 * Token-2022 never lets a mint be 355 bytes long (a multisig's size) and adds two bytes, which
 * create_v2 does not pay rent for: the coin's mint is 318 bytes plus its name, symbol and uri, so a
 * coin whose three add up to exactly 37 bytes fails with InsufficientFundsForRent. The launcher pays
 * those two bytes (checked on mainnet, 2026-10-17).
 */
const MINT_BASE_LEN = 318;
const MULTISIG_LEN = 355;

async function mintRentTopUp({ connection, payer, mint, name, symbol, uri }) {
  if (MINT_BASE_LEN + Buffer.byteLength(name + symbol + uri) !== MULTISIG_LEN) return [];
  const [paid, needed] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(MULTISIG_LEN),
    connection.getMinimumBalanceForRentExemption(MULTISIG_LEN + 2),
  ]);
  return [SystemProgram.transfer({ fromPubkey: payer, toPubkey: mint, lamports: needed - paid })];
}

/**
 * pump keeps SIXTEEN fee recipients and picks one at random per build, but the deployed program
 * only accepts the set that is current RIGHT NOW, and that set rotates. Mainnet takes the reserved
 * one; a local validator replaying the same dumped Global takes the older one. There is no way to
 * know by reading the account, so the launch is simulated until one is accepted and the winner is
 * pinned for every later build against the same endpoint.
 *
 * buy_v2's accounts 6..9 are fee_recipient, its WSOL account, buyback_fee_recipient and its WSOL
 * account (checked against idl/external/pump.json).
 */
const pinned = new Map();
const BUY_V2_ACCOUNTS = 27;
const FEE_RECIPIENT = 6;
const BUYBACK_RECIPIENT = 8;

async function acceptedRecipients(connection, build, user, tables = [], tries = 24) {
  const key = connection.rpcEndpoint;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  if (pinned.has(key)) {
    const ixs = await build();
    patchRecipients(ixs, pinned.get(key));
    return ixs;
  }
  let last = "no attempt";
  for (let i = 0; i < tries; i++) {
    const ixs = await build();
    const tx = v0(user, blockhash, [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs], tables);
    const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
    if (!sim.value.err) {
      pinned.set(key, readRecipients(ixs));
      return ixs;
    }
    const logs = (sim.value.logs || []).join(" ");
    last = `${JSON.stringify(sim.value.err)} ${logs.slice(-300)}`;
    // 6000 NotAuthorized is "this recipient is not in today's set"; anything else is our own bug
    if (!/NotAuthorized|0x1770/.test(logs)) throw new Error(`the launch transaction fails on chain: ${last}`);
  }
  throw new Error(`pump refused every fee recipient it offered (${tries} tries): ${last}`);
}

const buyIx = (ixs) => ixs.find((ix) => ix.keys.length === BUY_V2_ACCOUNTS);

function readRecipients(ixs) {
  const buy = buyIx(ixs);
  if (!buy) throw new Error("the SDK did not build a buy_v2 instruction");
  return {
    fee: buy.keys[FEE_RECIPIENT].pubkey,
    feeAta: buy.keys[FEE_RECIPIENT + 1].pubkey,
    buyback: buy.keys[BUYBACK_RECIPIENT].pubkey,
    buybackAta: buy.keys[BUYBACK_RECIPIENT + 1].pubkey,
  };
}

function patchRecipients(ixs, r) {
  const buy = buyIx(ixs);
  if (!buy) return;
  buy.keys[FEE_RECIPIENT].pubkey = r.fee;
  buy.keys[FEE_RECIPIENT + 1].pubkey = r.feeAta;
  buy.keys[BUYBACK_RECIPIENT].pubkey = r.buyback;
  buy.keys[BUYBACK_RECIPIENT + 1].pubkey = r.buybackAta;
}

function v0(payer, blockhash, instructions, lookupTables) {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);
  return new VersionedTransaction(message);
}

/** VersionedTransaction.serialize() THROWS over 1232 bytes, so the size check is a try/catch. */
export function serialize(tx) {
  try {
    return Buffer.from(tx.serialize()).toString("base64");
  } catch (e) {
    const bytes = tx.message.serialize().length;
    throw new Error(`transaction is too big for one packet (${bytes} bytes of message): ${e.message}`);
  }
}

export function transactionBytes(tx) {
  // signatures are 64 bytes each plus the compact length prefix
  return tx.message.serialize().length + 1 + 64 * tx.message.header.numRequiredSignatures;
}

