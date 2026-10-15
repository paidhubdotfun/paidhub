/**
 * The one swap the pad makes: the keeper's spare SOL into $paidhub (or a coin the pot buys back), which it then burns. Jupiter is the route; it exists only on mainnet, so this path is proved by
 * simulating it there (tools/preflight.mjs), never by pretending a local validator has a market.
 *
 * Jupiter takes SOL as WRAPPED sol, and the setup instructions that wrap it are part of the
 * transaction it returns, so `wrapAndUnwrapSol` stays on for a plain wallet and the route's own
 * lookup tables come back with it.
 */
import { VersionedTransaction } from "@solana/web3.js";

const LITE = "https://lite-api.jup.ag";
// the keyed host when the pad has a key (higher limits), the free one otherwise
const HOST = process.env.JUPITER_API_KEY ? "https://api.jup.ag" : LITE;
const keyed = (host) => (host !== LITE && process.env.JUPITER_API_KEY ? { "x-api-key": process.env.JUPITER_API_KEY } : {});

export async function quote({ inputMint, outputMint, amount, slippageBps = 900, host = HOST, fetchImpl = fetch }) {
  const url =
    `${host}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
    `&amount=${amount}&slippageBps=${slippageBps}&restrictIntermediateTokens=true`;
  const res = await fetchImpl(url, { headers: keyed(host) });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`jupiter quote: ${body.error || res.status}`);
  return body;
}

export async function swapTransaction({ quoteResponse, userPublicKey, host = HOST, fetchImpl = fetch }) {
  const res = await fetchImpl(`${host}/swap/v1/swap`, {
    method: "POST",
    headers: { "content-type": "application/json", ...keyed(host) },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      // a small buyback must not spend a visible part of itself on priority
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 100_000, priorityLevel: "medium" } },
    }),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`jupiter swap: ${body.error || res.status}`);
  return VersionedTransaction.deserialize(Buffer.from(body.swapTransaction, "base64"));
}

const WSOL = "So11111111111111111111111111111111111111112";

/** Buy `mint` with `lamports` of the owner's SOL; returns the base units received and the signature. */
export async function swapSolInto({ connection, mint, lamports, owner, fetchImpl = fetch, host = HOST }) {
  const q = await quote({ inputMint: WSOL, outputMint: mint, amount: lamports, host, fetchImpl });
  const tx = await swapTransaction({
    quoteResponse: q,
    userPublicKey: owner.publicKey.toBase58(),
    host,
    fetchImpl,
  });
  tx.sign([owner]);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature]);
    if (value[0]?.err) throw new Error(`buyback failed: ${JSON.stringify(value[0].err)}`);
    if (value[0]?.confirmationStatus === "confirmed" || value[0]?.confirmationStatus === "finalized") break;
    await new Promise((r) => setTimeout(r, 600));
  }
  return { amount: Number(q.outAmount), signature };
}
