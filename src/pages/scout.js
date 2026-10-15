// Scout: once a day, repos gaining stars fast that can be paid (a person owns them, or people with commits),
// not closed by their people and with no coin yet. Numbers from GitHub; the two sentences from a small model.
import { esc, px, avatar, int, ago } from "../ui.js";
import { scout } from "../api.js";

function bars(days) {
  const max = Math.max(1, ...days);
  return `<span class="spark" aria-hidden="true">${days.map((d) => `<i style="height:${Math.max(2, Math.round((d / max) * 26))}px"></i>`).join("")}</span>`;
}

export default async function scoutPage(root) {
  root.innerHTML = `
  <div class="page">
    <section>
      <p class="label dim">scout.md</p>
      <h1>Scout</h1>
      <p class="lede" style="margin-top:12px">Repos picking up stars fastest this week that a coin could actually pay: owned by a person, or written by people with real commits, and not closed by them. Refreshed once a day. A listing is a lead, not an endorsement and not a prediction.</p>
    </section>
    <section id="list"><p class="empty">Loading today's list…</p></section>
  </div>`;
  try {
    const { data } = await scout();
    const list = root.querySelector("#list");
    if (!data || !data.items?.length) {
      list.innerHTML = `<p class="empty">The scout's first list lands within the day.</p>`;
      return;
    }
    list.innerHTML = `
      <div class="section-head"><h2>${esc(new Date(`${data.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }))}</h2><span class="dim">${data.items.length} repos out of ${int(data.checked)} checked</span></div>
      <ul class="files">${data.items
        .map(
          (it) => `<li class="file-row scout-row">
            ${px("file", 3, "state")}
            <div class="file-row__title">
              <a href="https://github.com/${esc(it.fullName)}" target="_blank" rel="noopener">${esc(it.fullName)}</a>
              <span class="dim">${esc(it.description || "")}</span>
              ${it.note ? `<span style="margin-top:6px">${esc(it.note)}</span>` : ""}
            </div>
            <div class="people">${it.people.map((p) => `<span class="person">${avatar(p.avatar)}<a href="/@${esc(p.login)}">@${esc(p.login)}</a></span>`).join("")}</div>
            <div class="num" style="display:grid;gap:6px;justify-items:start">
              <span><b>+${int(it.week)}</b> stars this week</span>${bars(it.days || [])}
              <span class="dim">${int(it.stars)} total${it.language ? ` · ${esc(it.language)}` : ""}${it.license ? ` · ${esc(it.license)}` : ""}</span>
              <a class="btn btn--small" href="/launch?repo=${encodeURIComponent(it.fullName)}">Launch it</a>
            </div>
          </li>`
        )
        .join("")}</ul>
      ${data.model ? `<p class="dim" style="margin-top:14px;font-size:13px">The two sentences on each repo are written by ${esc(data.model)} from its README. The numbers come from GitHub. Made ${ago(data.date + "T06:00:00Z")}.</p>` : ""}`;
  } catch (e) {
    root.querySelector("#list").innerHTML = `<p class="empty">The list could not load: ${esc(e.message)}</p>`;
  }
}
