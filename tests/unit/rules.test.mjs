import test from "node:test";
import assert from "node:assert/strict";
import { SHARES, devShares, checkLaunch, parseRepo } from "../../shared/rules.js";

test("the four shares make exactly 100%", () => {
  assert.equal(SHARES.devs + SHARES.pot + SHARES.keeper + SHARES.launcher, 10_000);
});

test("the developers' half splits evenly and always sums to 5000", () => {
  assert.deepEqual(devShares(1), [5000]);
  assert.deepEqual(devShares(2), [2500, 2500]);
  assert.deepEqual(devShares(3), [1668, 1666, 1666]);
  for (const n of [1, 2, 3]) assert.equal(devShares(n).reduce((s, v) => s + v, 0), 5000);
  assert.throws(() => devShares(0));
  assert.throws(() => devShares(4));
});

test("repo links in every shape a person pastes", () => {
  assert.deepEqual(parseRepo("https://github.com/morluto/rea"), { owner: "morluto", name: "rea" });
  assert.deepEqual(parseRepo("github.com/openclaw/openclaw/tree/main/src"), { owner: "openclaw", name: "openclaw" });
  assert.deepEqual(parseRepo("tw93/Kami.git"), { owner: "tw93", name: "Kami" });
  assert.deepEqual(parseRepo("http://www.github.com/a-b/c.d_e?tab=readme"), { owner: "a-b", name: "c.d_e" });
  assert.equal(parseRepo("gitlab.com/a/b"), null);
  assert.equal(parseRepo("justaword"), null);
  assert.equal(parseRepo(""), null);
});

test("the launch form", () => {
  const repo = { name: "rea" };
  const ok = checkLaunch({ name: "REA coin", symbol: "$rea", twitter: "@rea_x", website: "rea.dev" }, repo);
  assert.equal(ok.symbol, "rea");
  assert.equal(ok.twitter, "https://x.com/rea_x");
  assert.equal(ok.website, "https://rea.dev/");
  assert.throws(() => checkLaunch({ name: "Rocket", symbol: "RKT" }, repo), /contain the repo's name/);
  assert.throws(() => checkLaunch({ name: "rea", symbol: "TOO-LONG-TICKER" }, repo), /ticker/);
  assert.throws(() => checkLaunch({ name: "", symbol: "R" }, repo), /name/);
  assert.throws(() => checkLaunch({ name: "rea", symbol: "R", twitter: "not a handle!" }, repo), /X field/);
  assert.throws(() => checkLaunch({ name: "rea", symbol: "R", website: "javascript:alert(1)" }, repo), /link/);
  // a repo name longer than a coin name can hold is not required in it
  assert.ok(checkLaunch({ name: "short", symbol: "S" }, { name: "a-very-long-repository-name-that-cannot-fit" }));
});
