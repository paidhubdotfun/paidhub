// paidhub.io/owner/repo: the repo's coin. Who it pays and why, what they were sent and claimed, the locked
// split with every address, the buybacks. No coin yet: who a coin would pay, and the button to launch it.
import { CONFIG, esc, sol, usd, ago, px, MARK, avatar, bindCopy, explorer, personState, short } from "../ui.js";
import { coinByRepo, repo as repoCheck, api } from "../api.js";
import { connect, connected, signAll } from "../wallet.js";
import { SHARES, devShares } from "../../shared/rules.js";

const PUMP = "https://pump.fun/coin/";
const DEX = "https://dexscreener.com/solana/";

function notYet(root, full, reason) {
  root.innerHTML = `
  <div class="page">
    <section class="panel" style="display:grid;gap:14px;max-width:820px">
      <p class="label dim">${esc(full)}.md</p>
      <h1>${esc(full)}</h1>
      <p class="lede">${reason === "no public repo there" ? "There is no public GitHub repo at this address." : "This repo has no coin on paidhub yet."}</p>
      <div id="would"></div>
    </section>
  </div>`;
  if (reason === "no public repo there") return;
  const would = root.querySelector("#would");
  would.innerHTML = `<p class="empty">Checking who a coin on it would pay…</p>`;
  repoCheck(full)
    .then((r) => {
      would.innerHTML = `
        <p style="margin-bottom:10px">A coin on it would send half of its creator fees to:</p>
        <ul class="files">${r.people
          .map((p) => `<li class="file-row" style="grid-template-columns:44px minmax(0,1fr) auto">${px("file-waiting", 2, "state")}<span class="person">${avatar(p.avatar)}<a href="/@${esc(p.login)}">@${esc(p.login)}</a> <span class="dim">${p.why === "owner" ? "owner" : `${p.commits} commits`}</span>${p.yes ? `<span class="tag">is in</span>` : ""}</span><span class="num">${(p.shareBps / 100).toFixed(2)}%</span></li>`)
          .join("")}</ul>
        <div class="row" style="margin-top:18px"><a class="btn btn--black" href="/launch?repo=${encodeURIComponent(full)}">Launch a coin on ${esc(full)}</a><a class="btn" href="https://github.com/${esc(full)}" target="_blank" rel="noopener">${MARK.github} Open on GitHub</a></div>`;
    })
    .catch((e) => {
      would.innerHTML = `<p>${esc(e.message)}</p><div class="row" style="margin-top:14px"><a class="btn" href="https://github.com/${esc(full)}" target="_blank" rel="noopener">${MARK.github} Open on GitHub</a></div>`;
    });
}

export default async function coinPage(root, owner, name) {
  const full = `${owner}/${name}`;
  root.innerHTML = `<div class="page"><section><p class="label dim">${esc(full)}.md</p><h1>${esc(full)}</h1><p class="empty">Reading the coin…</p></section></div>`;
  let r;
  try {
    r = await coinByRepo(full);
  } catch (e) {
    root.innerHTML = `<div class="page"><section><h1>${esc(full)}</h1><p class="empty">Could not read this coin: ${esc(e.message)}</p></section></div>`;
    return;
  }
  if (!r.found) {
    if (r.unfinished) {
      const u = r.unfinished;
      root.innerHTML = `<div class="page"><section class="panel" style="max-width:760px;display:grid;gap:12px"><p class="label dim">${esc(full)}.md</p><h1>$${esc(u.symbol)} is not finished</h1><p>The coin exists on pump.fun, but its fee split was never locked, so it is not on paidhub yet. Only the wallet that launched it (${esc(short(u.launcher, 6))}) can finish it: one more approval sets the split.</p><div class="row"><button class="btn btn--black" type="button" id="finish">Connect that wallet and finish</button></div><div class="status" id="status" aria-live="polite"></div></section></div>`;
      root.querySelector("#finish").addEventListener("click", async () => {
        const say = (t, err) => (root.querySelector("#status").innerHTML = `<p class="${err ? "err" : ""}">${t}</p>`);
        try {
          if (!connected()) await connect();
          if (connected().address !== u.launcher) return say("This is not the wallet that launched the coin.", true);
          say("Building the split…");
          const built = await api("/api/finish", { method: "POST", body: { mint: u.mint, wallet: connected().address } });
          say("Approve it in your wallet…");
          const signed = await signAll(built.transactions);
          say("Sending…");
          const sent = await api("/api/send", { method: "POST", body: { mint: u.mint, transactions: signed } });
          say(sent.onPad ? "Done: the split is locked. Reloading…" : esc(sent.note), !sent.onPad);
          if (sent.onPad) setTimeout(() => location.reload(), 1200);
        } catch (e) {
          say(esc(e.message), true);
        }
      });
      return;
    }
    return notYet(root, full, r.reason);
  }
  const { coin, page, live } = r;
  const people = (page?.people || coin.people || []).map((p, i) => ({ ...p, live: live?.[i] || null }));
  const shares = devShares(people.length);
  const m = page?.market || {};
  const pump = `${PUMP}${coin.mint}`;
  const rows = people
    .map((p, i) => {
      const s = personState(p);
      return `<li class="file-row">
        ${px(s.icon, 2, "state", s.text)}
        <div class="file-row__title"><span class="person">${avatar(p.avatar)}<a href="/@${esc(p.login)}">@${esc(p.login)}</a></span><span class="dim">${p.why === "owner" ? "repo owner" : `${p.commits} commits`} · ${(shares[i] / 100).toFixed(2)}% of every fee</span></div>
        <div class="num">${s.text === "claimed" ? `<span class="tag">claimed ${ago(p.claimedAt)}</span>` : `<span class="tag tag--paper">${esc(s.text)}</span>`}${p.waived ? `<br><span class="dim" style="font-size:12px">no buyback: ${esc(p.waived.why)}</span>` : ""}</div>
        <div class="num"><span class="label dim">sent by this coin</span><br>${sol(p.sent || 0)}${p.live ? `<br><span class="dim">waiting in their account ${sol(p.live.waiting)}</span>` : ""}</div>
      </li>`;
    })
    .join("");
  const bbs = (page?.buybacks || [])
    .map(
      (b) => `<li class="file-row" style="grid-template-columns:28px minmax(0,1fr) auto">${px("flame", 1)}<span>After @${esc(b.login)} claimed, the pot bought ${b.done ? `${sol(b.spent)} of $${esc(coin.symbol)} and burned all of it` : `in ${b.parts.length} parts, ${b.parts.filter((x) => x.state === "done").length} done so far`}. ${b.parts
        .filter((x) => x.buySig && x.buySig !== "curve")
        .map((x, k) => `<a href="${explorer("tx", x.buySig)}" target="_blank" rel="noopener">buy ${k + 1}</a>`)
        .join(" ")}${b.memo ? ` <a href="${explorer("tx", b.memo)}" target="_blank" rel="noopener">memo</a>` : ""}</span><span class="dim">${ago(b.at)}</span></li>`
    )
    .join("");
  root.innerHTML = `
  <div class="page">
    <section class="panel" style="display:grid;gap:18px">
      <p class="label dim">${esc(full)}.md</p>
      <div class="row" style="gap:18px;align-items:center">
        ${coin.image ? `<img src="${esc(coin.image)}" alt="" width="88" height="88" style="border:4px solid #000;object-fit:cover;background:#fff" />` : ""}
        <div style="display:grid;gap:4px;min-width:0">
          <h1>$${esc(coin.symbol)} · ${esc(coin.name)}</h1>
          <a href="https://github.com/${esc(coin.repo.fullName)}" target="_blank" rel="noopener">github.com/${esc(coin.repo.fullName)}</a>
        </div>
      </div>
      <div class="ca"><span class="label">contract</span><code class="num">${esc(coin.mint)}</code></div>
      <div class="row">
        <a class="btn btn--black" href="${esc(pump)}" target="_blank" rel="noopener">${MARK.pump}Buy $${esc(coin.symbol)} on pump.fun</a>
        <button class="btn" type="button" data-copy="${esc(coin.mint)}" data-what="contract">Copy</button>
        <a class="btn" href="${DEX}${esc(coin.mint)}" target="_blank" rel="noopener">Chart</a>
        ${coin.twitter ? `<a class="btn" href="${esc(coin.twitter)}" target="_blank" rel="noopener" aria-label="the coin on X">${MARK.x}</a>` : ""}
      </div>
      <p class="dim">${m.marketCap ? `Market cap ${usd(m.marketCap)}${m.holders ? ` · ${m.holders} holders` : ""} · ` : ""}launched ${ago(coin.launchedAt)} by <a href="${explorer("account", coin.launcher)}" target="_blank" rel="noopener">${esc(short(coin.launcher, 5))}</a>. The developers have not endorsed this coin unless a row below says they are in.</p>
    </section>

    <section aria-labelledby="who">
      <div class="section-head"><h2 id="who">Who this coin pays</h2><span class="dim">50% of every creator fee, split evenly</span></div>
      <ul class="files">${rows}</ul>
    </section>

    <section class="panel" aria-labelledby="split">
      <h2 id="split">The split, locked by pump.fun</h2>
      <p class="dim" style="margin:8px 0 14px">Set once when the coin launched. pump.fun never lets it change, not even for paidhub.</p>
      <table class="board">
        <tbody>
          ${people.map((p, i) => `<tr><td>@${esc(p.login)}'s GitHub account on pump.fun</td><td class="r num">${(shares[i] / 100).toFixed(2)}%</td><td class="r hide-s">${p.live ? `<a href="${explorer("account", p.live.address)}" target="_blank" rel="noopener">${esc(short(p.live.address, 5))}</a>` : ""}</td></tr>`).join("")}
          <tr><td>the pot: buys this coin back when a developer first claims</td><td class="r num">${SHARES.pot / 100}%</td><td class="r hide-s">${CONFIG.POT_WALLET ? `<a href="${explorer("account", CONFIG.POT_WALLET)}" target="_blank" rel="noopener">${esc(short(CONFIG.POT_WALLET, 5))}</a>` : ""}</td></tr>
          <tr><td>the keeper: buys back and burns $paidhub, tops up the pot</td><td class="r num">${SHARES.keeper / 100}%</td><td class="r hide-s">${CONFIG.KEEPER_WALLET ? `<a href="${explorer("account", CONFIG.KEEPER_WALLET)}" target="_blank" rel="noopener">${esc(short(CONFIG.KEEPER_WALLET, 5))}</a>` : ""}</td></tr>
          <tr><td>whoever launched it</td><td class="r num">${SHARES.launcher / 100}%</td><td class="r hide-s"><a href="${explorer("account", coin.launcher)}" target="_blank" rel="noopener">${esc(short(coin.launcher, 5))}</a></td></tr>
        </tbody>
      </table>
    </section>

    <section aria-labelledby="bb">
      <div class="section-head"><h2 id="bb">Buybacks</h2></div>
      ${bbs ? `<ul class="files">${bbs}</ul>` : `<p class="empty">None yet. The first time one of these developers claims on pump.fun, the pot buys $${esc(coin.symbol)} back over an hour and burns it.</p>`}
    </section>
  </div>`;
  bindCopy(root);
}
