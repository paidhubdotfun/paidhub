// The hub: the paidhub banner, alive. The big file in the middle is $paidhub's own file (premise, contract,
// buy, X); repo files fly into it. Then the one number that matters, the search, the coins and the last events.
import { CONFIG, esc, sol, int, usd, ago, px, MARK, avatar, bindCopy, coinState, personState, explorer, go } from "../ui.js";
import { front, board } from "../api.js";
import { startFlow } from "../hub.js";

function hubFile() {
  const ca = CONFIG.HAS_CA
    ? `<code class="num" id="ca">${esc(CONFIG.CA)}</code>`
    : `<code class="ca--empty dim">not yet: the $paidhub contract lands here at launch</code>`;
  const buy = CONFIG.HAS_PUMP
    ? `<a class="btn btn--black" href="${esc(CONFIG.PUMP_URL)}" target="_blank" rel="noopener">${MARK.pump}Buy $paidhub on pump.fun</a>`
    : `<span class="btn btn--black" aria-disabled="true">${MARK.pump}Buy $paidhub · not yet</span>`;
  const x = CONFIG.HAS_X
    ? `<a class="btn" href="${esc(CONFIG.X)}" target="_blank" rel="noopener" aria-label="paidhub on X">${MARK.x}</a>`
    : `<span class="btn" aria-disabled="true" aria-label="paidhub on X, not yet">${MARK.x}</span>`;
  return `
    <div class="hub panel" id="hub">
      <p class="hub__name dim">${px("file", 1)} paidhub.md</p>
      <h1>Coins for GitHub repos. Half of every fee goes to the people who wrote the code.</h1>
      <div class="ca">
        <span class="label">$paidhub contract</span>
        ${ca}
      </div>
      <div class="row">
        ${buy}
        ${CONFIG.HAS_CA ? `<button class="btn" type="button" data-copy="${esc(CONFIG.CA)}" data-what="contract">Copy</button>` : `<span class="btn" aria-disabled="true">Copy</span>`}
        ${x}
      </div>
      <p class="hub__burn" id="ph-burn" hidden></p>
    </div>`;
}

/** What the keeper has bought back and burned of $paidhub itself (6 decimals), with the last burn. */
function burnLine(ph) {
  if (!ph?.spent) return "";
  const tokens = Number(BigInt(ph.burned || "0") / 1_000_000n);
  const last = ph.last?.burnSig ? ` · <a href="${explorer("tx", ph.last.burnSig)}" target="_blank" rel="noopener">last burn</a> ${ago(ph.last.at)}` : "";
  return `${px("flame", 1)}<span>The keeper bought back ${sol(ph.spent)} of $paidhub and burned ${int(tokens)} tokens${last}</span>`;
}

function coinRow(c) {
  const st = coinState(c);
  const people = (c.people || [])
    .map((p) => {
      const s = personState(p);
      return `<span class="person">${avatar(p.avatar)}<a href="/@${esc(p.login)}">@${esc(p.login)}</a>${s.text === "not claimed yet" ? "" : `<span class="tag">${esc(s.text)}</span>`}</span>`;
    })
    .join("");
  const sent = (c.people || []).reduce((s, p) => s + (p.sent || 0), 0);
  const m = c.market || {};
  return `<li class="file-row">
    ${px(st.icon, 2, "state", st.text)}
    <div class="file-row__title">
      <a href="/${esc(c.repo?.fullName || "")}">$${esc(c.symbol)} · ${esc(c.name)}</a>
      <span class="dim">github.com/${esc(c.repo?.fullName || "")}</span>
    </div>
    <div class="people">${people}</div>
    <div class="num"><span class="label dim">sent to devs</span><br>${sol(sent)}${m.marketCap ? `<br><span class="dim">mcap ${usd(m.marketCap)}</span>` : ""}</div>
  </li>`;
}

function events(state) {
  const items = [];
  for (const b of state.buybacks || []) {
    items.push({ at: b.at, html: `${px("flame", 1)} <span>The pot bought back <a href="/${esc(state.coins.find((c) => c.mint === b.mint)?.repo?.fullName || "")}">$${esc(b.symbol)}</a> after <a href="/@${esc(b.login)}">@${esc(b.login)}</a> claimed: ${b.done ? `${sol(b.spent)} spent, every token burned` : `${b.parts.filter((p) => p.state === "done").length} of ${b.parts.length} parts done`}${b.memo ? ` · <a href="${explorer("tx", b.memo)}" target="_blank" rel="noopener">memo</a>` : ""}</span>` });
  }
  for (const c of state.claims || []) {
    items.push({ at: c.at, html: `${px("file-paid", 1)} <span><a href="/@${esc(c.login)}">@${esc(c.login)}</a> claimed ${sol(c.lamports)} from pump.fun</span>` });
  }
  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (!items.length) return `<p class="empty">No claims yet. The first developer who claims sets off the first buyback.</p>`;
  return `<ul class="files">${items
    .slice(0, 10)
    .map((i) => `<li class="file-row" style="grid-template-columns:28px minmax(0,1fr) auto">${i.html.replace("<span>", "<span>")}<span class="dim">${ago(i.at)}</span></li>`)
    .join("")}</ul>`;
}

export default async function home(root) {
  root.innerHTML = `
  <div class="page">
    <section class="hero" aria-label="paidhub">
      <canvas aria-hidden="true"></canvas>
      <div class="hero__center">
        ${hubFile()}
        <div class="hero__brand">
          <img src="/px/wordmark.png" alt="paidhub" width="302" height="71" />
          <img src="/px/tagline.png" alt="code pays" width="183" height="19" />
        </div>
      </div>
    </section>

    <section class="numbers" aria-labelledby="owed">
      <p class="label">waiting on pump.fun for GitHub developers</p>
      <p class="big" id="owed">… SOL</p>
      <p class="lede" id="owed-note">Read straight off the chain: every GitHub account pump.fun routes creator fees to, and what sits there unclaimed.</p>
      <form class="search" id="find" role="search">
        <label class="sr" for="login">GitHub login</label>
        <input class="well" id="login" name="login" placeholder="@github-login" autocomplete="off" autocapitalize="off" spellcheck="false" />
        <button class="btn btn--black" type="submit">${px("lens", 1)} Look up</button>
      </form>
      <div class="row" style="justify-content:center">
        <a class="btn btn--black" href="/launch">Launch a coin on a repo</a>
        <a class="btn" href="/unclaimed">See who is owed</a>
      </div>
    </section>

    <section aria-labelledby="how">
      <div class="section-head"><h2 id="how">How it works</h2><span class="row" style="gap:18px"><a href="/docs">Read the docs</a><a href="https://github.com/paidhubdotfun/paidhub" target="_blank" rel="noopener">Read the code</a></span></div>
      <div class="steps">
        <div class="step panel">${px("file", 3)}<h3>Paste a repo</h3><p>Any public GitHub repo. paidhub finds who wrote it: the owner, or the top three committers of an organisation's repo.</p></div>
        <div class="step panel">${px("coin", 2)}<h3>Launch the coin</h3><p>One coin per repo, on pump.fun, from your wallet. Its fee split is locked by pump the moment it lands and can never change.</p></div>
        <div class="step panel">${px("wallet", 2)}<h3>The devs get paid</h3><p>Half of every creator fee goes to the developers' GitHub accounts on pump.fun. Only they can claim it, by signing in with GitHub.</p></div>
        <div class="step panel">${px("flame", 2)}<h3>A claim pays holders</h3><p>When a developer claims for the first time, the pot buys that coin back over an hour and burns every token it buys.</p></div>
      </div>
      <div class="split" style="margin-top:22px">
        <span><b>50%</b><br>the developers</span><span><b>20%</b><br>the pot</span><span><b>20%</b><br>$paidhub keeper</span><span><b>10%</b><br>whoever launched</span>
      </div>
    </section>

    <section aria-labelledby="coins">
      <div class="section-head"><h2 id="coins">Coins on paidhub</h2><span class="dim" id="coins-count"></span></div>
      <div id="coin-list"><p class="empty">Loading the coins…</p></div>
    </section>

    <section aria-labelledby="log">
      <div class="section-head"><h2 id="log">Claims and buybacks</h2><span class="dim" id="pot"></span></div>
      <div id="events"><p class="empty">Loading…</p></div>
    </section>
  </div>`;

  bindCopy(root);
  root.querySelector("#find").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = root.querySelector("#login").value.trim().replace(/^@/, "").replace(/^https?:\/\/github\.com\//, "").split("/")[0];
    if (v) go(`/@${v}`);
  });

  const flow = startFlow(root.querySelector(".hero canvas"), root.querySelector("#hub"));

  board()
    .then(({ data }) => {
      if (!data) {
        root.querySelector("#owed").textContent = "counting…";
        root.querySelector("#owed-note").textContent = "The keeper reads every GitHub fee account on pump.fun once an hour. The first count lands soon.";
        return;
      }
      const t = data.totals;
      root.querySelector("#owed").textContent = sol(t.waiting);
      root.querySelector("#owed-note").innerHTML = `${int(t.accounts)} GitHub accounts have fees waiting on pump.fun. ${int(t.neverClaimed)} of them never claimed once. Read off the chain ${ago(data.updatedAt)}.`;
      flow.setLabels(data.top.filter((a) => a.login && !a.gone && a.type !== "Organization").slice(0, 40).map((a) => `@${a.login} ${sol(a.waiting)}`));
    })
    .catch((e) => {
      root.querySelector("#owed").textContent = "unavailable";
      root.querySelector("#owed-note").textContent = `The count could not load: ${e.message}`;
    });

  front()
    .then(({ data }) => {
      const list = root.querySelector("#coin-list");
      const burn = burnLine(data?.paidhub);
      if (burn) Object.assign(root.querySelector("#ph-burn"), { innerHTML: burn, hidden: false });
      if (!data || !data.coins.length) {
        list.innerHTML = `<p class="empty">No coins yet. ${CONFIG.LAUNCH_OPEN ? `<a href="/launch">Launch the first one</a>.` : "Launching opens when the pad goes live."}</p>`;
        root.querySelector("#events").innerHTML = `<p class="empty">No claims yet. The first developer who claims sets off the first buyback.</p>`;
        return;
      }
      root.querySelector("#coins-count").textContent = `${data.coins.length} coin${data.coins.length === 1 ? "" : "s"} · ${sol(data.totals.sent)} sent to developers`;
      list.innerHTML = `<ul class="files">${data.coins.map(coinRow).join("")}</ul>`;
      root.querySelector("#events").innerHTML = events(data);
      if (data.pot?.lamports != null) root.querySelector("#pot").textContent = `the pot holds ${sol(data.pot.lamports)}`;
    })
    .catch((e) => {
      root.querySelector("#coin-list").innerHTML = `<p class="empty">The coins could not load: ${esc(e.message)}</p>`;
      root.querySelector("#events").innerHTML = "";
    });

  return () => flow.stop();
}
