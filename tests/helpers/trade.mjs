// Trading on a coin's curve, so the suite can make holders, sellers and real creator fees instead of
// pretending. v2 trades pay the creator fee straight into the vault; v3 trades leave it in the
// curve's bucket until a sweep (pump-sdk 4), so the keeper's sweep + distribute is exercised too.
import { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import anchor from "@coral-xyz/anchor";
import { SDK, WSOL, online, offline } from "../../server/lib/chain.js";

const { BN } = anchor;

async function land(connection, payer, ixs, send) {
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(
    new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs] }).compileToV0Message()
  );
  const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  const i = sim.value.err?.InsufficientFundsForRent?.account_index;
  if (i !== undefined) {
    // the local chain lacks some of pump's fee recipients (the dumped set rotates): a small fee into
    // one that does not exist yet is under rent. Give it rent, as mainnet's live account has, and retry.
    const key = tx.message.staticAccountKeys[i];
    const sig = await connection.requestAirdrop(key, 2_000_000);
    for (let n = 0; n < 40; n++) {
      const { value } = await connection.getSignatureStatuses([sig]);
      if (value[0]?.confirmationStatus) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    return land(connection, payer, ixs, send);
  }
  if (sim.value.err) return { err: sim.value.err, logs: sim.value.logs || [] };
  return { sig: await send(tx) };
}

export async function buyOnCurve({ connection, mint, buyer, lamports, send, v3 = false }) {
  const sdk = offline();
  const net = online(connection);
  const global = await net.fetchGlobal();
  const feeConfig = await net.fetchFeeConfig().catch(() => null);
  const state = await net.fetchBuyState(mint, buyer.publicKey, TOKEN_2022_PROGRAM_ID);
  // the real supply: with null the SDK prices a moved curve as a fresh one and asks for ~2x the SOL
  const mintSupply = new BN((await connection.getTokenSupply(mint)).value.amount);
  const amount = SDK.getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply, bondingCurve: state.bondingCurve, amount: new BN(lamports), quoteMint: WSOL });
  const needed = SDK.getBuySolAmountFromTokenAmount({ global, feeConfig, mintSupply, bondingCurve: state.bondingCurve, amount, quoteMint: WSOL });
  // the SDK's own arithmetic can disagree with the deployed program on a moved curve: it answers
  // TooMuchSolRequired (6002) with what it really needs as `Right:`, so take the chain's number
  let ceiling = needed.muln(118).divn(100);
  for (let attempt = 0; attempt < 3; attempt++) {
    const ixs = v3
      ? await sdk.buyV3Instructions({ bondingCurve: state.bondingCurve, associatedUserAccountInfo: state.associatedUserAccountInfo, mint, user: buyer.publicKey, amount, quoteAmount: ceiling, slippage: 1, tokenProgram: TOKEN_2022_PROGRAM_ID, quoteTokenProgram: state.quoteTokenProgram })
      : await sdk.buyV2Instructions({ global, bondingCurveAccountInfo: state.bondingCurveAccountInfo, bondingCurve: state.bondingCurve, associatedUserAccountInfo: state.associatedUserAccountInfo, mint, user: buyer.publicKey, amount, quoteAmount: ceiling, slippage: 1, tokenProgram: TOKEN_2022_PROGRAM_ID, quoteTokenProgram: state.quoteTokenProgram });
    const r = await land(connection, buyer.publicKey, ixs, send);
    if (r.sig) return BigInt(amount.toString());
    const right = r.logs.join("\n").match(/Right:\s*(\d+)/);
    if (!right) throw new Error(`buy failed: ${JSON.stringify(r.err)} ${r.logs.slice(-6).join(" | ")}`);
    ceiling = new BN(right[1]).muln(103).divn(100);
  }
  throw new Error("the chain never agreed with a buy ceiling");
}

