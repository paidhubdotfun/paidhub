/**
 * Prices for the pad's coins: Solana Tracker's data API first (a paid key, higher limits),
 * DexScreener's free batch endpoint when it fails. 30 coins a call.
 */
const ST = "https://data.solanatracker.io/tokens/multi";
const DS = "https://api.dexscreener.com/tokens/v1/solana/";

export function marketReader({ dataKey = process.env.SOLANATRACKER_DATA_KEY, fetchImpl = fetch } = {}) {
  return async function read(mints) {
    if (!mints.length) return {};
    if (dataKey) {
      try {
        const res = await fetchImpl(ST, { method: "POST", headers: { "x-api-key": dataKey, "content-type": "application/json" }, body: JSON.stringify({ tokens: mints }) });
        if (res.ok) {
          const j = await res.json();
          const out = {};
          for (const [mint, t] of Object.entries(j.tokens || {})) {
            const pool = [...(t.pools || [])].sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0] || {};
            out[mint] = {
              marketCap: pool.marketCap?.usd ?? null,
              price: pool.price?.usd ?? null,
              market: pool.market || "",
              holders: t.holders ?? null,
              change24h: t.events?.["24h"]?.priceChangePercentage ?? null,
              volume24h: pool.txns?.volume24h ?? null,
              graduated: pool.market ? pool.market !== "pumpfun" : null,
              at: new Date().toISOString(),
              source: "solanatracker",
            };
          }
          if (Object.keys(out).length) return out;
        }
      } catch {
        /* fall through to DexScreener */
      }
    }
    const res = await fetchImpl(`${DS}${mints.join(",")}`);
    if (!res.ok) return {};
    const out = {};
    for (const p of await res.json()) {
      const mint = p.baseToken?.address;
      if (!mint || (out[mint] && (out[mint].liquidity || 0) > (p.liquidity?.usd || 0))) continue;
      out[mint] = {
        marketCap: p.marketCap ?? p.fdv ?? null,
        price: Number(p.priceUsd) || null,
        market: p.dexId || "",
        holders: null,
        change24h: p.priceChange?.h24 ?? null,
        volume24h: p.volume?.h24 ?? null,
        liquidity: p.liquidity?.usd ?? null,
        graduated: p.dexId ? p.dexId !== "pumpfun" : null,
        at: new Date().toISOString(),
        source: "dexscreener",
      };
    }
    return out;
  };
}
