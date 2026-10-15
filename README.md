<p align="center"><img src="docs/home.png" alt="paidhub: repo files flying into the hub" width="100%"></p>

# paidhub

**Coins for GitHub repos on pump.fun. Half of every fee goes to the people who wrote the code.**

[paidhub.io](https://paidhub.io) · [Docs](https://paidhub.io/docs) · [Who is owed](https://paidhub.io/unclaimed) · [Look yourself up](https://paidhub.io/@your-login)

Anyone can launch one coin per GitHub repo. Half of the coin's creator fees land in pump.fun's own GitHub
fee accounts for that repo's developers. paidhub never holds that money and cannot move it: only the
developer can claim it, on pump.fun, by signing in with GitHub.

The first time a developer claims, the pad's pot buys their coin back over an hour and burns every token it buys.

## How it works

1. **Paste a repo.** paidhub works out who wrote it: the owner of a personal repo, or the three people with the
   most commits on an organisation's repo.
2. **Launch the coin** from your own wallet. Its fee split is written once and pump.fun locks it for good.
3. **The developers get paid.** Every 10 minutes the keeper pays out the coin's fee vault, split like this:

<p align="center"><img src="docs/fees.png" alt="Where a coin's fees go: 50% developers, 20% pot, 20% keeper, 10% launcher" width="720"></p>

4. **A claim pays holders.** When a developer claims for the first time, the pot spends a quarter of itself
   (at most 3 SOL) buying that coin in six parts over an hour, and burns all of it.

## Who a coin pays

<p align="center"><img src="docs/who.png" alt="Who a coin pays: the owner, or up to three top committers" width="720"></p>

People are identified by their numeric GitHub id, which survives renames. A repo is identified by its numeric
id too, so a renamed or moved repo keeps its one coin. pump.fun loses fees routed to an organisation's id,
so paidhub never pays an organisation, only its people.

Developers have the last word on the [developers page](https://paidhub.io/developers): **never** (no new coin
can pay them), **I'm in** (every coin that pays them says so), or close specific repos. paidhub does not email
developers, open issues or tag anyone.

## From a claim to a buyback

<p align="center"><img src="docs/claim.png" alt="Fees pile up, the developer finds out, claims, paidhub sees it, the pot buys back" width="720"></p>

The buyback runs once per developer per coin. It needs a claim of at least 0.1 SOL, the coin must have sent
that developer at least 0.01 SOL, and the coin needs 25 holders. Every number lives in
[`shared/rules.js`](shared/rules.js), read by the site, the API and the keeper alike.

## Check it yourself

paidhub has no program of its own. A launch is two ordinary pump.fun transactions signed by the launcher's
wallet:

| transaction | instructions |
|---|---|
| 1 · the coin | `create_v2`, the launcher's associated token account, `buy_v2` |
| 2 · the split | `create_social_fee_pda` for each developer, `create_fee_sharing_config`, `update_fee_shares_v2` |

The API sends a transaction only if the launcher pays for it, it names the coin and it calls nothing but
pump.fun's programs and Solana's system, token and compute budget programs. A coin is registered only once
the chain shows its split locked to exactly the pad's shares
([`server/lib/register.js`](server/lib/register.js), [`server/lib/chain.js`](server/lib/chain.js)).

Where everything sits on chain:

| what | address |
|---|---|
| a developer's GitHub account on pump.fun | PDA `["social-fee-pda", <github id>, [2]]` of the fee program |
| a coin's split | PDA `["sharing-config", <mint>]` of the fee program, `admin_revoked = true` |
| pump.fun fee program | [`pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`](https://solscan.io/account/pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ) |
| pump.fun | [`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`](https://solscan.io/account/6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P) |
| the pot and the keeper | `POT_WALLET` and `KEEPER_WALLET` in [`public/config.js`](public/config.js) |

Find any developer's account in a few lines:

```js
import { socialFeePda } from "@pump-fun/pump-sdk";

// GitHub user id -> the account only that person can claim from
socialFeePda("76467478", 2).toBase58();
```

## What is in this repo

```
public/        what the site serves: config.js, the pixel art, fonts, official marks
src/           the website: one page per file in src/pages, the hub animation in hub.js
server/        the API routes (Vercel functions), with their shared code in server/lib
api/           the same routes bundled for Vercel by tools/bundle.mjs (generated, do not edit)
shared/        rules.js: every number of the mechanic
keeper/        the keeper: pays out fee vaults, watches claims, runs buybacks, builds the board and the scout
tests/         the whole money path on a local chain with the real pump.fun programs, and unit tests
tools/         bundle.mjs (API bundles), fixtures.mjs (mainnet program dumps for the tests), env.mjs
docs/          the pictures in this README
```

## Run it

Node 20 or newer, then `npm install`.

| command | what it does |
|---|---|
| `npm run dev` | the site on Vite; `/api/*` runs straight from `server/` |
| `npm test` | unit tests: shares, the developers' split, repo links, the launch form |
| `npm run fixtures` | dumps pump.fun, PumpSwap, the fee program and the accounts they read from mainnet into `tests/fixtures` |
| `npm run test:chain` | launch, distribute, claim, buyback and burn on `solana-test-validator` with those dumps; pump.fun's claim authority is swapped for a test key so a real claim runs |
| `npm run bundle` | rebuilds `api/` from `server/` (Vercel's tracer misses `@solana/web3.js` in ESM functions, so the routes ship as CommonJS bundles) |
| `npm run keeper` | the keeper, on a 20 second pulse |

Settings come from a `.config/.env` above the repo, never from the repo itself. [`.env.example`](.env.example)
lists every name.

## What paidhub cannot do

- Pay out a developer's money. It sits in pump.fun's account for their GitHub id, and pump.fun's own key
  co-signs every claim.
- Change a split or undo a coin. pump.fun locks the split at launch.
- Speak for developers. A coin is a community coin; the developers have not endorsed it unless they say they are in.

## Credits

[Departure Mono](https://departuremono.com) by Helena Zhang and Tobias Fried (MIT) ·
[Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) (OFL) ·
[@pump-fun/pump-sdk](https://www.npmjs.com/package/@pump-fun/pump-sdk) ·
GitHub's [star history endpoint](https://github.blog/changelog/2026-09-04-new-api-endpoint-provides-privacy-safe-star-history-data) ·
prices from Solana Tracker and DexScreener.

Not affiliated with GitHub or pump.fun.
