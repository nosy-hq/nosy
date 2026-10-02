// lowhanging.mjs signal 5 ("Issues opened against us") and `team` in sources.json: an issue one of your own people opened is a
// work item, not a request from outside. collect-signals.mjs keeps it out of demand; lowhanging reads the same list the same way, through the one
// reader in sources-file.mjs (teamLogins / isTeamLogin: case-insensitive, optional leading @, a string or an array).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";
import { teamLogins, isTeamLogin } from "../tools/sources-file.mjs";

let K, gh, tmp;
const now = new Date().toISOString();
const issue = (number, login, extra = {}) => ({ number, title: `[cargo] ask ${number}`, author: login === null ? null : { login }, updatedAt: now, body: "1. a\n2. b", labels: [], ...extra });
before(async () => {
  K = await fakeProductSetup();
  gh = fakeGhSetup({ issueListOpen: [issue(901, "Selim-Dev"), issue(902, "customer1"), issue(903, "ayse"), issue(904, null), issue(905, "customer2", { body: null })] });
  tmp = temporary("nosy-low-team-");
});
after(() => { clean(K.root); clean(gh.dir); clean(tmp); });
const withTeam = team => {
  const pm = path.join(tmp, `pm-${Math.random().toString(36).slice(2)}`); fs.cpSync(K.pm, pm, { recursive: true });
  const kj = JSON.parse(fs.readFileSync(path.join(pm, "sources.json"), "utf8")); if (team !== undefined) kj.team = team; fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify(kj, null, 1));
  const out = path.join(tmp, "low.json"), r = run(path.join(Tool, "lowhanging.mjs"), [pm, "--json", out], { env: gh.env });
  assert.equal(r.code, 0, r.error);
  return { r, items: JSON.parse(fs.readFileSync(out, "utf8")).items.filter(i => i.type === "Issue opened against us").map(i => i.title) };
};

test("without `team`, every open issue is listed (and a missing author or body is not a crash)", () => {
  const { items } = withTeam(undefined);
  assert.deepEqual(items.map(t => t.match(/#(\d+)/)[1]).sort(), ["901", "902", "903", "904", "905"]);
});

test("team logins are left out, whatever their case and with or without an @; the omission is said once, with the numbers", () => {
  const { r, items } = withTeam(["selim-dev", "@AYSE"]);
  assert.deepEqual(items.map(t => t.match(/#(\d+)/)[1]).sort(), ["902", "904", "905"]);
  assert.match(r.output, /2 open issues opened by your own team \(sources\.json `team`\) are left out: they are work items, not a request from outside \(#901, #903\)\./);
});

test("one string is a team of one; non-strings and blanks in the list are ignored; no match says nothing", () => {
  assert.deepEqual(withTeam("Ayse").items.length, 4);
  assert.deepEqual(withTeam([7, null, "", "  ", "@", "customer2"]).items.map(t => t.match(/#(\d+)/)[1]).sort(), ["901", "902", "903", "904"]);
  const none = withTeam(["nobody-here"]); assert.equal(none.items.length, 5); assert.doesNotMatch(none.r.output, /your own team/);
});

test("the reader both tools share: case, a leading @, a string or a list, junk ignored; an empty login is nobody", () => {
  const T = teamLogins({ team: [" @Ali ", "VELI", 3, null, "@"] });
  assert.deepEqual([...T].sort(), ["ali", "veli"]);
  assert.equal(isTeamLogin(T, "ALI"), true); assert.equal(isTeamLogin(T, "@veli"), true); assert.equal(isTeamLogin(T, "ayse"), false);
  assert.equal(isTeamLogin(T, ""), false); assert.equal(isTeamLogin(T, undefined), false); assert.equal(isTeamLogin(T, null), false);
  assert.deepEqual([...teamLogins({ team: "Ali" })], ["ali"]);
  assert.equal(teamLogins({}).size, 0); assert.equal(teamLogins(null).size, 0); assert.equal(teamLogins({ team: null }).size, 0); assert.equal(teamLogins({ team: { a: 1 } }).size, 0);
});

test("collect-signals and lowhanging use that one reader: neither keeps a private copy of the rule", () => {
  for (const f of ["collect-signals.mjs", "lowhanging.mjs"]) {
    const src = fs.readFileSync(path.join(Tool, f), "utf8");
    assert.match(src, /teamLogins.*from "\.\/sources-file\.mjs"/, f);
    assert.doesNotMatch(src, /\.replace\(\/\^@\/, ""\)\.toLowerCase\(\)/, `${f} has its own copy of the login rule`);
  }
});
