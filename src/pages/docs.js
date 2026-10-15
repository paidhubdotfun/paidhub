// Docs: how paidhub works, with schemes built from the site's own pixel files and dotted paths.
import { CONFIG, esc, px, explorer, short } from "../ui.js";
import { SHARES, CLAIM_BUYBACK, POT, KEEPER, PEOPLE } from "../../shared/rules.js";

const pct = (bps) => `${bps / 100}%`;
const solN = (l) => `${l / 1e9} SOL`;
const addr = (a, label) => (a ? `<a href="${explorer("account", a)}" target="_blank" rel="noopener">${esc(short(a, 6))}</a>` : `<span class="dim">${label}</span>`);

function feesScheme() {
  const branch = (icon, share, title, text) => `
    <div class="br">
      <span class="br__line" aria-hidden="true"></span>
      <span class="br__pct">${share}</span>
      <span class="br__icon">${icon}</span>
      <span class="br__text"><b>${title}</b><br>${text}</span>
    </div>`;
  return `
  <figure class="scheme panel" aria-label="Where a coin's creator fees go">
    <div class="src">
      <span class="src__icon">${px("coin", 3)}</span>
      <span><b>A coin on paidhub</b><br>every trade on pump.fun pays a creator fee into the coin's fee vault</span>
    </div>
    <p class="hop">the keeper pays the vault out every ${KEEPER.distributeEveryMs / 60000} minutes, split exactly like this, locked by pump.fun</p>
    <div class="tree-scheme">
      ${branch(`${px("file-waiting", 1)}${px("file-waiting", 1)}${px("file-waiting", 1)}`, pct(SHARES.devs), "the repo's developers", `up to ${PEOPLE.max}, evenly. It lands in each one's GitHub account on pump.fun. Only they can claim it.`)}
      ${branch(px("jar", 2), pct(SHARES.pot), "the pot", "buys a coin back and burns it when its developer first claims")}
      ${branch(px("flame", 2), pct(SHARES.keeper), "the keeper", `once an hour, what it holds above ${solN(KEEPER.floatLamports)}: ${Math.round(KEEPER.buybackShare * 100)}% buys and burns $paidhub, ${100 - Math.round(KEEPER.buybackShare * 100)}% goes to the pot`)}
      ${branch(px("wallet", 2), pct(SHARES.launcher), "whoever launched it", "straight to the launcher's wallet")}
    </div>
  </figure>`;
}

function whoScheme() {
  return `
  <figure class="scheme panel" aria-label="Who a coin on a repo pays">
    <div class="src"><span class="src__icon">${px("file", 3)}</span><span><b>github.com/owner/repo</b><br>pasted into the launch form</span></div>
    <div class="fork">
      <div class="fork__col">
        <p class="label">owned by a person</p>
        <p>${px("file-waiting", 1)} <b>that person</b>: 100% of the developers' half</p>
      </div>
      <div class="fork__col">
        <p class="label">owned by an organisation</p>
        <p>${px("file-waiting", 1)} <b>up to ${PEOPLE.max} people with the most commits</b>, evenly. pump.fun cannot pay an organisation's own id: fees sent there are stuck for good.</p>
      </div>
    </div>
    <ul class="nolist">
      <li>${px("file-never", 1)} refused: a fork (launch the original), a private repo, a bot, an account younger than ${PEOPLE.minAgeDays} days, under ${PEOPLE.minCommits} commits</li>
      <li>${px("file-never", 1)} refused: a repo its people closed, a person who said never, a repo that already has its coin</li>
    </ul>
  </figure>`;
}

function claimScheme() {
  const s = (icon, title, text) => `<li class="hopstep"><span class="hopstep__icon">${icon}</span><span><b>${title}</b><br>${text}</span></li>`;
  return `
  <figure class="scheme panel" aria-label="From a claim to a buyback">
    <ol class="hops">
      ${s(px("file-waiting", 2), "Fees pile up", "in the developer's GitHub account on pump.fun, coin after coin")}
      ${s(px("lens", 2), "They find out", "on the Unclaimed board, their paidhub page, or from someone who tags them")}
      ${s(px("file-paid", 2), "They claim", "on pump.fun, signed in with GitHub. The money goes to their own wallet")}
      ${s(px("jar", 2), "paidhub sees it", "the keeper reads every paid account every 2 minutes; total claimed going up is a claim")}
      ${s(px("flame", 2), "The pot buys back", `${Math.round(CLAIM_BUYBACK.potFraction * 100)}% of the pot, at most ${solN(CLAIM_BUYBACK.maxLamports)}, in ${CLAIM_BUYBACK.chunks} parts over an hour; every token bought is burned; a memo closes it`)}
    </ol>
    <p class="dim" style="font-size:13px">Once per developer per coin. It needs a claim of at least ${solN(CLAIM_BUYBACK.minClaimLamports)}, the coin must have sent that developer at least ${solN(CLAIM_BUYBACK.minSentLamports)}, and the coin needs ${CLAIM_BUYBACK.minHolders} holders. If several of that developer's coins qualify, the buyback is split between them.</p>
  </figure>`;
}

export default function docsPage(root) {
  const toc = [
    ["what", "What paidhub is"],
    ["fees", "Where the fees go"],
    ["who", "Who a coin pays"],
    ["claim", "A claim pays holders"],
    ["token", "$paidhub"],
    ["board", "The Unclaimed board"],
    ["devs", "For developers"],
    ["limits", "What paidhub cannot do"],
    ["chain", "On chain"],
    ["faq", "Questions"],
  ];
  root.innerHTML = `
  <div class="page docs" style="max-width:920px">
    <section>
      <p class="label dim">docs.md</p>
      <h1>Docs</h1>
      <nav class="toc" aria-label="On this page">${toc.map(([id, t]) => `<a href="#${id}">${t}</a>`).join("")}</nav>
    </section>

    <section id="what">
      <h2>What paidhub is</h2>
      <p>A launchpad for pump.fun coins on GitHub repos. Anyone can launch one coin per repo. Half of the coin's creator fees go to the people who wrote the code, into pump.fun's own GitHub fee accounts. paidhub never holds that money and cannot move it: only the developer can claim it, on pump.fun, by signing in with GitHub.</p>
      <p>The rest pays for the mechanic: a pot that buys a coin back when its developer claims, the $paidhub buyback, and the launcher.</p>
      <p>The code is open: <a href="https://github.com/paidhubdotfun/paidhub" target="_blank" rel="noopener">github.com/paidhubdotfun/paidhub</a>. Every rule the site, the API and the keeper follow is in it, with a test that runs the whole money path on pump.fun's real programs.</p>
    </section>

    <section id="fees"><h2>Where the fees go</h2>${feesScheme()}<p>The split is written once, in the second transaction of every launch, and pump.fun locks it: nobody can change it later, paidhub included. Every coin's page lists its split with the addresses.</p></section>

    <section id="who"><h2>Who a coin pays</h2>${whoScheme()}<p>A person is identified by their numeric GitHub id, which never changes. A login can be renamed; the id cannot. A repo is identified by its numeric id too, so a renamed or moved repo keeps its one coin.</p></section>

    <section id="claim"><h2>A claim pays holders</h2>${claimScheme()}</section>

    <section id="token">
      <h2>$paidhub</h2>
      <p>The pad's own coin. Its creator fees are forwarded to the keeper by hand. The keeper holds ${pct(SHARES.keeper)} of every coin's fees. Once an hour, everything it holds above ${solN(KEEPER.floatLamports)}: ${Math.round(KEEPER.buybackShare * 100)}% buys $paidhub and burns it, the rest tops up the pot. When the pot holds more than ${solN(POT.overflowLamports)} beyond what it owes, the surplus buys and burns $paidhub once a week.</p>
      <div class="ca" style="margin-top:12px"><span class="label">$paidhub contract</span>${CONFIG.HAS_CA ? `<code class="num">${esc(CONFIG.CA)}</code>` : `<code class="ca--empty dim">not yet: it appears here at launch</code>`}</div>
    </section>

    <section id="board">
      <h2>The Unclaimed board</h2>
      <p>Every GitHub account pump.fun pays creator fees to, from any launchpad, read straight off the chain every hour: what waits, what was ever claimed, and when. Logins come from GitHub's public profile of each numeric id. Accounts of organisations are marked stuck. Search any login to see their page.</p>
    </section>

    <section id="devs">
      <h2>For developers</h2>
      <p>paidhub does not email developers, open issues or tag anyone automatically. GitHub's rules forbid using its data for unsolicited email, and nobody likes it. Instead the board is public and so is every developer's page. Sign in on <a href="/developers">developers</a> with GitHub (no permissions asked) to say never, say you are in, or close repos.</p>
    </section>

    <section id="limits">
      <h2>What paidhub cannot do</h2>
      <ul class="nolist">
        <li>${px("file-stuck", 1)} Pay out a developer's money. It sits in pump.fun's account for their GitHub id. pump.fun's own key co-signs every claim.</li>
        <li>${px("file-stuck", 1)} Change a split, or undo a coin. pump.fun locks the split at launch.</li>
        <li>${px("file-stuck", 1)} Speak for developers. A coin is a community coin; the developers have not endorsed it unless they say they are in.</li>
        <li>${px("file-stuck", 1)} Pay an organisation. pump.fun loses fees routed to an organisation's id, so paidhub pays its people.</li>
      </ul>
    </section>

    <section id="chain">
      <h2>On chain</h2>
      <table class="board"><tbody>
        <tr><td>the pot</td><td class="r">${addr(CONFIG.POT_WALLET, "set at go-live")}</td></tr>
        <tr><td>the keeper</td><td class="r">${addr(CONFIG.KEEPER_WALLET, "set at go-live")}</td></tr>
        <tr><td>pump.fun fee program (GitHub accounts, splits)</td><td class="r">${addr("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ")}</td></tr>
        <tr><td>pump.fun</td><td class="r">${addr("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P")}</td></tr>
      </tbody></table>
      <p class="dim" style="margin-top:10px">paidhub has no program of its own. A launch is two ordinary pump.fun transactions from the launcher's wallet: the coin with the first buy, then the fee split.</p>
    </section>

    <section id="faq">
      <h2>Questions</h2>
      <dl class="faq">
        <dt>Is the developer behind the coin?</dt><dd>Not unless their row says they are in. A coin pays them whether or not they ever show up.</dd>
        <dt>What if a developer never claims?</dt><dd>Their share keeps waiting in pump.fun's account for them, with no deadline. Nobody else can take it.</dd>
        <dt>Can I launch a coin on my own repo?</dt><dd>Yes. You get the developers' half for it and the launcher's 10% too.</dd>
        <dt>Why two transactions?</dt><dd>A coin and its fee split do not fit in one Solana transaction. Your wallet asks once for both. If the second never lands, the coin page lets the same wallet finish it.</dd>
        <dt>Where does the scout's text come from?</dt><dd>A small AI model reads each repo's README and writes two sentences. The star counts come from GitHub.</dd>
      </dl>
    </section>

    <p class="risk">A coin on paidhub can fall to nothing and so can $paidhub: put in only what you can lose, and read none of this as financial advice.</p>
  </div>`;
}
