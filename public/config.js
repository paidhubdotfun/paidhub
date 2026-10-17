// ============================================================================
//  PAIDHUB CONFIG. PASTE HERE AND NOWHERE ELSE.
//  At launch paste two things: the $paidhub mint into CA and the X profile
//  url into X. Leave a value empty and the page shows an honest "not yet"
//  state; PUMP and DEXSCREENER are ready base urls, the mint is appended to
//  them automatically.
// ============================================================================
window.SITE_CONFIG = {
  CA: "",                                          // the $paidhub token MINT, base58, e.g. 7xKX...pump
  X: "",                                           // https://x.com/<handle>
  PUMP: "https://pump.fun/coin/",                  // launchpad base: the mint is appended (do not edit)
  DEXSCREENER: "https://dexscreener.com/solana/",  // chart base: the mint is appended (do not edit)

  NAME: "paidhub",
  TICKER: "$paidhub",
  CHAIN: "solana",
  SITE: "https://paidhub.io",                      // the public origin, for og/canonical

  // Written once at go-live by the setup script. Never edited by hand.
  KEEPER_WALLET: "5M6F9gpuSpkbR3w5sXY3vg8KxH8HE1TuQd1rffhYoK1b",                               // the keeper: 20% of every coin, buys back $paidhub, tops up the pot
  POT_WALLET: "SEsvqHHG9vY7s6bKcbaSc4H21eb5BJV3SAG52UGyJ8y",                                  // the pot: 20% of every coin, buys a coin back when its developer claims
  LOOKUP_TABLE: "CtrdcAxQQH3EA6tvAtNwRsoaJHpKoT92G6YirLm47324",                                // the launch transaction's address lookup table

  EXPLORER: "https://solscan.io",                  // /token/<mint>, /account/<addr>, /tx/<sig>
};
// ---- nothing below this line is edited by hand ----------------------------
// A bare base url (nothing after the last slash) counts as unset.
(function derive(c) {
  const set = (v) => typeof v === "string" && v.length > 0 && !/\/$/.test(v);
  const append = (base) => (set(base) ? base : base && set(c.CA) ? base.replace(/\/?$/, "/") + c.CA : "");
  c.HAS_CA = set(c.CA);
  c.HAS_X = set(c.X);
  c.PUMP_URL = append(c.PUMP);
  c.DEX_URL = append(c.DEXSCREENER);
  c.HAS_PUMP = Boolean(c.PUMP_URL);
  c.HAS_DEX = Boolean(c.DEX_URL);
  c.LAUNCH_OPEN = set(c.LOOKUP_TABLE) && set(c.KEEPER_WALLET) && set(c.POT_WALLET);
})(window.SITE_CONFIG);
