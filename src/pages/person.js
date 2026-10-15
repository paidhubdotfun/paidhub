// paidhub.io/@login: one person's GitHub fee account on pump.fun, read live, and how to take what waits.
import { esc, sol, ago, px, avatar, explorer, coinState } from "../ui.js";
import { person } from "../api.js";

export default async function personPage(root, login) {
  root.innerHTML = `<div class="page"><section><p class="label dim">@${esc(login)}.md</p><h1>@${esc(login)}</h1><p class="empty">Reading pump.fun's account for this GitHub login…</p></section></div>`;
  let r;
  try {
    r = await person(login);
  } catch (e) {
    root.innerHTML = `<div class="page"><section><p class="label dim">@${esc(login)}.md</p><h1>@${esc(login)}</h1><p class="empty">Could not read this account: ${esc(e.message)}</p></section></div>`;
    return;
  }
  if (!r.found) {
    root.innerHTML = `<div class="page"><section class="panel" style="max-width:680px"><p class="label dim">@${esc(login)}.md</p><h1>@${esc(login)}</h1><p class="lede" style="margin:12px 0 18px">${esc(r.reason === "no GitHub account by that name" ? "There is no GitHub account by that name." : r.reason === "an organisation: pump cannot pay it, only its people" ? "This is a GitHub organisation. pump.fun can only pay people, so fees sent to an organisation's id stay stuck. A coin on one of its repos pays the people with the most commits instead." : r.reason)}</p><a class="btn" href="/unclaimed">Back to the board</a></section></div>`;
    return;
  }
  const { user, account, word, padCoins, anywhere } = r;
  const waiting = account.waiting || 0;
  const status = !account.exists
    ? "No coin on pump.fun has sent fees to this account yet."
    : waiting > 0
      ? account.claimed > 0
        ? `Claimed before (last ${ago(account.lastClaimed)}). More has arrived since.`
        : "Never claimed. Everything that arrived is still there."
      : account.claimed > 0
        ? `All claimed (last ${ago(account.lastClaimed)}).`
        : "Opened, nothing waiting yet.";
  root.innerHTML = `
  <div class="page">
    <section class="panel" style="display:grid;gap:18px">
      <p class="label dim">@${esc(user.login)}.md</p>
      <div class="row" style="gap:20px;align-items:center">
        ${avatar(user.avatar, "avatar--big")}
        <div style="display:grid;gap:4px">
          <h1>@${esc(user.login)}</h1>
          ${user.name && user.name !== user.login ? `<span class="dim">${esc(user.name)}</span>` : ""}
          <span>${word.yes ? `<span class="tag">is in</span>` : word.never ? `<span class="tag">said never: no new coins</span>` : ""}</span>
        </div>
      </div>
      <div class="totals">
        <div><span class="label dim">waiting on pump.fun</span><b>${sol(waiting)}</b></div>
        <div><span class="label dim">claimed so far</span><b>${sol(account.claimed)}</b></div>
        <div><span class="label dim">coins on pump.fun paying it</span><b id="anywhere">${anywhere == null ? "counting…" : anywhere}</b></div>
      </div>
      <p>${esc(status)}</p>
      <p class="dim" style="font-size:13px">pump.fun's account for GitHub id ${esc(user.id)}: <a href="${explorer("account", account.address)}" target="_blank" rel="noopener">${esc(account.address)}</a></p>
    </section>

    <section class="panel" aria-labelledby="take">
      <h2 id="take">If you are @${esc(user.login)}: how to take it</h2>
      <ol style="margin:14px 0 0;padding-left:22px;display:grid;gap:8px">
        <li>Open <a href="https://pump.fun" target="_blank" rel="noopener">pump.fun</a> and find Creator Rewards.</li>
        <li>Sign in with GitHub as @${esc(user.login)} and link a Solana wallet.</li>
        <li>Claim. pump.fun sends everything that waits to your wallet. paidhub never holds it and cannot move it.</li>
      </ol>
      <p class="dim" style="margin-top:14px">Do not want coins on your repos? <a href="/developers">Say never</a>: no new coin can be launched that pays you. Happy to be paid? <a href="/developers">Say you are in</a>, and every coin that pays you shows it.</p>
    </section>

    <section aria-labelledby="pad">
      <div class="section-head"><h2 id="pad">paidhub coins that pay @${esc(user.login)}</h2></div>
      ${
        padCoins.length
          ? `<ul class="files">${padCoins
              .map((c) => {
                const st = coinState(c);
                const me = c.people.find((p) => String(p.id) === String(user.id)) || {};
                return `<li class="file-row" style="grid-template-columns:44px minmax(0,1fr) auto">${px(st.icon, 2, "state", st.text)}<div class="file-row__title"><a href="/${esc(c.repo.fullName)}">$${esc(c.symbol)} · ${esc(c.name)}</a><span class="dim">github.com/${esc(c.repo.fullName)}</span></div><span class="num">${sol(me.sent || 0)} sent</span></li>`;
              })
              .join("")}</ul>`
          : `<p class="empty" id="pad-none">None yet.${anywhere ? ` The ${anywhere} coin${anywhere === 1 ? "" : "s"} paying this account came from elsewhere on pump.fun.` : ""}</p>`
      }
    </section>
  </div>`;
  if (anywhere == null && account.exists) {
    person(login, true)
      .then((x) => {
        const el = root.querySelector("#anywhere");
        if (el) el.textContent = x.anywhere == null ? "unavailable" : String(x.anywhere);
        const none = root.querySelector("#pad-none");
        if (none && x.anywhere) none.textContent = `None yet. The ${x.anywhere} coin${x.anywhere === 1 ? "" : "s"} paying this account came from elsewhere on pump.fun.`;
      })
      .catch(() => {
        const el = root.querySelector("#anywhere");
        if (el) el.textContent = "unavailable";
      });
  } else if (!account.exists) {
    const el = root.querySelector("#anywhere");
    if (el) el.textContent = "0";
  }
}
