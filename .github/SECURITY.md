# Security

paidhub moves real money: coin launches, fee payouts and buybacks on Solana mainnet. If you find a way to
take funds that are not yours, to make the keeper spend the pot wrongly, to register a coin whose split is not
the pad's, or to impersonate a developer, please tell us privately first.

**Report it here:** the repo's **Security** tab → **Report a vulnerability**. Only the maintainers see it.

Please include what an attacker gains, the steps or a transaction that shows it, and the files involved. We
answer within 72 hours.

## Scope

- the API routes in `server/` (launch building, the send and finish routes, sign-in, the developers' word)
- the keeper in `keeper/` (fee payouts, claim detection, buybacks, burns)
- the split check in `server/lib/chain.js` and `server/lib/register.js`

Out of scope: pump.fun's own programs and its GitHub claim flow (report those to pump.fun), price movements of
any coin, and anything that needs a leaked key.
