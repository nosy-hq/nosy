// rival-signals.mjs: "did this rival grow?" from public counters with a history. No network: every read goes through an injected fetch / gh.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LABEL, parseInclude, makeContext, readSignals, jobPostingsIn, previousOf, saveHistory, readHistory, buildState, render, runSignals,
  signalsIn, initProposal, renderInit, addNote, readNotes, renderNotes, notesFile, historyFile, USER_AGENT } from "../tools/rival-signals.mjs";
import { demandInputs } from "../tools/demand.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";
// The fixtures are UTC instants and "the same day" means the same calendar day: pin the owner's zone, so the suite gives one answer in every zone it is run under.
process.env.NOSY_TZ = "UTC";

const NOW = new Date("2026-10-03T09:00:00Z");
const res = (status, body, headers = {}) => ({ status, headers: { get: k => headers[k.toLowerCase()] ?? null }, text: async () => typeof body === "string" ? body : JSON.stringify(body) });
const ok = (body, link = "") => ({ status: 200, headers: { link }, text: typeof body === "string" ? body : JSON.stringify(body) });
const daysAgo = n => new Date(NOW.getTime() - n * 864e5).toISOString();
// gh answers by path; every path asked is kept, so "one request per address" can be checked.
const fakeGh = routes => { const asked = []; const gh = async p => { asked.push(p); const hit = Object.entries(routes).find(([k]) => p.startsWith(k)); return hit ? (typeof hit[1] === "function" ? hit[1](p) : hit[1]) : { status: 404, headers: { link: "" }, text: "" }; }; gh.asked = asked; return gh; };
const noFetch = async url => { throw new Error(`the suite must not reach the network: ${url}`); };
const read = (rivals, deps = {}) => readSignals(rivals, { now: NOW, fetchImpl: noFetch, gh: fakeGh({}), ...deps });
const byKey = R => Object.fromEntries(R.signals.map(s => [s.key, s.value]));

test("parseInclude reads the status, the Link header and the body of `gh api -i`", () => {
  const out = "HTTP/2.0 200 OK\r\nContent-Type: application/json\r\nLink: <https://api.github.com/repositories/1/commits?per_page=1&page=2>; rel=\"next\", <https://api.github.com/repositories/1/commits?per_page=1&page=57>; rel=\"last\"\r\n\r\n[{\"sha\":\"a\"}]";
  const r = parseInclude(out);
  assert.equal(r.status, 200); assert.match(r.headers.link, /page=57>; rel="last"/); assert.equal(r.text, "[{\"sha\":\"a\"}]");
  assert.equal(parseInclude("HTTP/2.0 404 Not Found\n\n{\"message\":\"Not Found\"}").status, 404);
  assert.equal(parseInclude("not http"), null);
});

test("GitHub through gh: stars, forks, releases in the last 30 days (drafts and old ones left out), commits from the Link header; each address once", async () => {
  const gh = fakeGh({
    "repos/acme/widgets/releases": ok([{ published_at: daysAgo(3) }, { published_at: daysAgo(20) }, { published_at: daysAgo(10), draft: true }, { published_at: daysAgo(45) }]),
    "repos/acme/widgets/commits": ok([{ sha: "a" }], '<https://api.github.com/x?since=s&per_page=1&page=2>; rel="next", <https://api.github.com/x?since=s&per_page=1&page=57>; rel="last"'),
    "repos/acme/widgets": ok({ stargazers_count: 1234, forks_count: 80, open_issues_count: 9 }),
  });
  const R = await read({ acme: { name: "Acme", signals: { github: "acme/widgets" } }, twin: { name: "Twin", signals: { github: "https://github.com/acme/widgets" } } }, { gh });
  assert.deepEqual(byKey(R.rivals[0]), { githubStars: 1234, githubForks: 80, githubReleases30d: 2, githubCommits30d: 57 });
  assert.equal(R.rivals[0].signals[0].source, "https://github.com/acme/widgets");
  assert.equal(R.rivals[0].signals[0].label, "GitHub stars");
  assert.deepEqual(R.rivals[1].signals.map(s => s.value), [1234, 80, 2, 57], "a repo two rivals share is asked once");
  assert.equal(gh.asked.length, 3);
  assert.match(gh.asked[2], /commits\?since=2026-09-03T09%3A00%3A00\.000Z&per_page=1$/, "the cheapest correct call: one commit, the count from the last page");
  assert.deepEqual(R.rivals[0].unread, []);
});

test("commits: a single page counts its items, an empty repository (409) is 0, not unread", async () => {
  const gh = fakeGh({ "repos/a/one/commits": ok([{ sha: "x" }]), "repos/a/one": ok({ stargazers_count: 1, forks_count: 0 }), "repos/a/one/releases": ok([]), });
  const R1 = await read({ one: { signals: { github: "a/one" } } }, { gh });
  assert.equal(byKey(R1.rivals[0]).githubCommits30d, 1);
  const gh2 = fakeGh({ "repos/a/empty/commits": { status: 409, headers: { link: "" }, text: "{\"message\":\"Git Repository is empty.\"}" }, "repos/a/empty/releases": ok([]), "repos/a/empty": ok({ stargazers_count: 0, forks_count: 0 }) });
  const R2 = await read({ empty: { signals: { github: "a/empty" } } }, { gh: gh2 });
  assert.equal(byKey(R2.rivals[0]).githubCommits30d, 0);
});

test("gh not installed: the plain API through fetch, with the identifying User-Agent and no token", async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => { seen.push({ url, headers: opts.headers }); return /\/releases/.test(url) ? res(200, []) : /\/commits/.test(url) ? res(200, [{}], { link: '<u?page=9>; rel="last"' }) : res(200, { stargazers_count: 5, forks_count: 1 }); };
  const gh = async () => ({ unavailable: "gh isn't installed" });
  const R = await read({ a: { signals: { github: "o/r" } } }, { gh, fetchImpl });
  assert.deepEqual(byKey(R.rivals[0]), { githubStars: 5, githubForks: 1, githubReleases30d: 0, githubCommits30d: 9 });
  assert.equal(R.viaGh, false);
  assert.ok(seen.every(x => x.url.startsWith("https://api.github.com/repos/o/r") && x.headers["user-agent"] === USER_AGENT && !x.headers.authorization));
  assert.equal(USER_AGENT, "nosy-rival-signals (+https://github.com/nosy-hq/nosy)");
});

test("a 403 or 429 stops that host for the run: named \"rate limited, not read\", never retried; other sources still read", async () => {
  const gh = fakeGh({ "repos/a/one": { status: 403, headers: { link: "" }, text: "{\"message\":\"API rate limit exceeded\"}" } });
  let npmCalls = 0;
  const fetchImpl = async url => { npmCalls++; return res(200, { downloads: 9000 }); };
  const R = await read({ one: { signals: { github: "a/one", npm: "one-pkg" } }, two: { signals: { github: "b/two" } } }, { gh, fetchImpl });
  assert.equal(gh.asked.length, 1, "after the first 403, GitHub is not asked again, for this rival or the next");
  assert.deepEqual(R.rivals[0].unread.map(u => [u.key, u.why]), [["githubStars", "rate limited, not read"], ["githubForks", "rate limited, not read"], ["githubReleases30d", "rate limited, not read"], ["githubCommits30d", "rate limited, not read"]]);
  assert.deepEqual(R.rivals[1].unread.map(u => u.why), Array(4).fill("rate limited, not read"));
  assert.equal(byKey(R.rivals[0]).npmWeeklyDownloads, 9000);
  assert.deepEqual(R.limited, ["api.github.com"]);
  let hits = 0;
  const R2 = await read({ a: { signals: { npm: "p1" } }, b: { signals: { npm: "p2" } } }, { fetchImpl: async () => { hits++; return res(429, "slow down"); } });
  assert.equal(hits, 1); assert.equal(R2.rivals[1].unread[0].why, "rate limited, not read");
});

test("a repo that isn't there, a timeout and a bad answer are each named", async () => {
  const gh = fakeGh({});
  const R = await read({ a: { signals: { github: "no/such" } }, b: { signals: { github: "not a repo" } } }, { gh });
  assert.equal(R.rivals[0].unread[0].why, "not found (HTTP 404)"); assert.equal(R.rivals[0].signals.length, 0);
  assert.equal(R.rivals[1].unread[0].why, "not an owner/repo");
  const hang = (url, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const T = await read({ a: { signals: { npm: "slow" } } }, { fetchImpl: hang, timeout: 20 });
  assert.match(T.rivals[0].unread[0].why, /^timed out after /);
  const J = await read({ a: { signals: { npm: "odd" } } }, { fetchImpl: async () => res(200, "<html>") });
  assert.equal(J.rivals[0].unread[0].why, "the answer has no download count");
});

test("npm weekly downloads, scoped names included; a name that isn't one is refused before any request", async () => {
  const urls = [];
  const fetchImpl = async url => { urls.push(url); return res(200, { downloads: 52000, package: "x" }); };
  const R = await read({ a: { signals: { npm: "@acme/widgets" } }, b: { signals: { npm: "../etc/passwd" } } }, { fetchImpl });
  assert.deepEqual(urls, ["https://api.npmjs.org/downloads/point/last-week/@acme/widgets"]);
  assert.equal(R.rivals[0].signals[0].value, 52000); assert.equal(R.rivals[0].signals[0].source, "https://www.npmjs.com/package/@acme/widgets");
  assert.equal(R.rivals[1].unread[0].why, "not an npm package name");
});

test("App Store: rating and rating count of the CURRENT version, through rival-sweep's id helper; a missing one is named", async () => {
  const urls = [];
  const lookup = { results: [{ trackName: "Acme", version: "3.2", averageUserRating: 4.9, userRatingCount: 99999, averageUserRatingForCurrentVersion: 4.70588, userRatingCountForCurrentVersion: 312, trackViewUrl: "https://apps.apple.com/tr/app/acme/id6446?uo=4" }] };
  const fetchImpl = async url => { urls.push(url); return res(200, /id=7777/.test(url) ? { results: [{ version: "1.0", averageUserRating: 4.5, userRatingCount: 9 }] } : lookup); };
  const R = await read({ a: { signals: { appStore: "https://apps.apple.com/tr/app/acme/id6446" } }, b: { signals: { appStore: "7777" } }, c: { signals: { appStore: "soon" } } }, { fetchImpl });
  assert.deepEqual(urls, ["https://itunes.apple.com/lookup?id=6446&country=tr", "https://itunes.apple.com/lookup?id=7777&country=us"]);
  assert.deepEqual(byKey(R.rivals[0]), { appStoreRating: 4.71, appStoreRatings: 312 });
  assert.equal(R.rivals[0].signals[0].source, "https://apps.apple.com/tr/app/acme/id6446");
  assert.deepEqual(R.rivals[1].signals, [], "the all-time numbers are not offered in place of the current version's");
  assert.deepEqual(R.rivals[1].unread.map(u => u.why), ["no rating for the current version yet", "no rating count for the current version yet"]);
  assert.match(R.rivals[2].unread[0].why, /no App Store id/);
});

test("open roles from the public job-board APIs (Greenhouse, Lever, Ashby); the human board page is the source", async () => {
  const urls = [];
  const fetchImpl = async url => { urls.push(url); return res(200, /greenhouse/.test(url) ? { jobs: [{}, {}, {}], meta: { total: 41 } } : /lever/.test(url) ? [{}, {}, {}, {}] : { jobs: [{ isListed: true }, { isListed: false }, {}] }); };
  const R = await read({ g: { signals: { careers: { greenhouse: "acme" } } }, l: { signals: { careers: { lever: "acme" } } }, s: { signals: { careers: { ashby: "acme" } } } }, { fetchImpl });
  assert.deepEqual(urls, ["https://boards-api.greenhouse.io/v1/boards/acme/jobs", "https://api.lever.co/v0/postings/acme?mode=json", "https://api.ashbyhq.com/posting-api/job-board/acme"]);
  assert.deepEqual(R.rivals.map(r => r.signals[0].value), [41, 4, 2]);
  assert.deepEqual(R.rivals.map(r => r.signals[0].source), ["https://boards.greenhouse.io/acme", "https://jobs.lever.co/acme", "https://jobs.ashbyhq.com/acme"]);
  const empty = await read({ g: { signals: { careers: { lever: "quiet" } } } }, { fetchImpl: async () => res(200, []) });
  assert.equal(empty.rivals[0].signals[0].value, 0, "a board with no postings is a real 0");
  const bad = await read({ a: { signals: { careers: { greenhouse: "a/b" } } }, b: { signals: { careers: { lever: "x", ashby: "y" } } }, c: { signals: { careers: {} } } }, { fetchImpl: noFetch });
  assert.deepEqual(bad.rivals.map(r => r.unread[0].why.split(" ").slice(0, 3).join(" ")), ["not a greenhouse", "careers names more", "careers names no"]);
});

test("careers page: JSON-LD JobPosting objects counted by structure (graph, arrays, no duplicates); no structured data says so; words are never counted; LinkedIn is never read", async () => {
  const ld = o => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  const jobs = `<html>${ld({ "@context": "https://schema.org", "@graph": [{ "@type": "Organization", name: "Acme" }, { "@type": "JobPosting", title: "Engineer" }] })}${ld([{ "@type": ["JobPosting"], title: "Designer" }, { "@type": ["JobPosting"], title: "Designer" }])}<script type="application/ld+json">{broken</script></html>`;
  assert.deepEqual(jobPostingsIn(jobs), { count: 2, blocks: 2 });
  const pages = { "https://acme.example/careers": jobs, "https://words.example/careers": "<h1>We're hiring! 12 open roles, apply now</h1>", "https://org.example/careers": ld({ "@type": "Organization" }) };
  const fetchImpl = async url => res(200, pages[url]);
  const R = await read({ a: { signals: { careers: { page: "https://acme.example/careers" } } }, w: { signals: { careers: { page: "https://words.example/careers" } } }, o: { signals: { careers: { page: "https://org.example/careers" } } },
    l: { signals: { careers: { page: "https://www.linkedin.com/company/acme/jobs" } } }, f: { signals: { careers: { page: "file:///etc/passwd" } } } }, { fetchImpl });
  assert.equal(R.rivals[0].signals[0].value, 2); assert.equal(R.rivals[0].signals[0].source, "https://acme.example/careers");
  assert.match(R.rivals[1].unread[0].why, /^can't count from this page/); assert.match(R.rivals[2].unread[0].why, /^can't count from this page/);
  assert.equal(R.rivals[3].unread[0].why, "LinkedIn is never read by Nosy");
  assert.match(R.rivals[4].unread[0].why, /isn't an http/);
});

test("a rival with no `signals` is left out; a wrong `signals` is a warning, not a crash", async () => {
  const R = await read({ plain: { name: "Plain" }, odd: { signals: [] }, typo: { signals: { githb: "a/b" } } });
  assert.deepEqual(R.rivals.map(r => r.slug), ["typo"]);
  assert.equal(R.warnings.length, 2);
  assert.match(R.warnings.join("\n"), /must be an object/); assert.match(R.warnings.join("\n"), /unknown signals source `githb`/);
});

test("history: `previous` is the oldest line within 28 days, with its date; nothing yet means null; a line older than 28 days is not used", () => {
  const H = [
    { at: "2026-08-20T08:00:00Z", rivals: { acme: { githubStars: 900 } } },   // 44 days: too old
    { at: "2026-09-08T08:00:00Z", rivals: { acme: { githubStars: 1000 } } }, // 25 days: the oldest in range
    { at: "2026-09-25T08:00:00Z", rivals: { acme: { githubStars: 1100, openRoles: 4 } } },
    { at: "2026-10-03T07:00:00Z", rivals: { acme: { githubStars: 1200 } } },  // today's own line: this run replaces it
  ];
  assert.deepEqual(previousOf(H, "2026-10-03", "acme", "githubStars"), { previous: 1000, since: "2026-09-08" });
  assert.deepEqual(previousOf(H, "2026-10-03", "acme", "openRoles"), { previous: 4, since: "2026-09-25" }, "per signal: a source added later starts from its own first line");
  assert.deepEqual(previousOf(H, "2026-10-03", "acme", "githubForks"), { previous: null, since: null });
  assert.deepEqual(previousOf([], "2026-10-03", "acme", "githubStars"), { previous: null, since: null });
  assert.deepEqual(previousOf(H, "2026-10-03", "other", "githubStars"), { previous: null, since: null });
});

test("saveHistory: one line a run, the same day replaced, every other line (even a damaged one) kept", () => {
  const pm = temporary("nosy-sig-hist-");
  try {
    const R = v => [{ slug: "acme", signals: [{ key: "githubStars", value: v }], unread: [] }, { slug: "dark", signals: [], unread: [{ key: "openRoles", why: "x" }] }];
    saveHistory(pm, R(1), new Date("2026-09-05T08:00:00Z"));
    fs.appendFileSync(historyFile(pm), "{half a line\n");
    saveHistory(pm, R(2), new Date("2026-10-03T08:00:00Z"));
    saveHistory(pm, R(3), new Date("2026-10-03T18:00:00Z"));
    const lines = fs.readFileSync(historyFile(pm), "utf8").trim().split("\n");
    assert.equal(lines.length, 3);
    assert.deepEqual(JSON.parse(lines[0]), { at: "2026-09-05T08:00:00.000Z", rivals: { acme: { githubStars: 1 } } });
    assert.equal(lines[1], "{half a line");
    assert.deepEqual(JSON.parse(lines[2]), { at: "2026-10-03T18:00:00.000Z", rivals: { acme: { githubStars: 3 } } }, "a rival with nothing read has no entry");
    assert.equal(readHistory(pm).length, 2);
  } finally { clean(pm); }
});

function product(rivals, extra = {}) {
  const pm = temporary("nosy-sig-pm-");
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: false, rivals, ...extra }));
  return pm;
}

test("run: the first reading says so; the state file has exactly the agreed shape; a later run shows the change and what changed most", async () => {
  const pm = product({ acme: { name: "Acme", signals: { github: "acme/widgets", careers: { greenhouse: "acme" } } }, plain: { name: "Plain" } });
  try {
    let stars = 1100, roles = 10;
    const gh = () => fakeGh({ "repos/acme/widgets/releases": ok([]), "repos/acme/widgets/commits": ok([{}]), "repos/acme/widgets": async () => ok({ stargazers_count: stars, forks_count: 50 }) });
    const fetchImpl = async () => res(200, { jobs: [], meta: { total: roles } });
    const first = await runSignals(pm, { now: new Date("2026-09-05T08:00:00Z"), gh: gh(), fetchImpl });
    assert.equal(first.code, 0);
    assert.match(first.text, /GitHub stars 1,100 \(first reading\)/);
    assert.match(first.text, /First readings saved/);
    assert.match(first.text, /No signals configured for: plain/);
    const state = JSON.parse(fs.readFileSync(path.join(pm, "state", "rival-signals.json"), "utf8"));
    assert.deepEqual(Object.keys(state), ["type", "generated", "rivals"]);
    assert.equal(state.type, "rivalSignals"); assert.equal(state.generated, "2026-09-05T08:00:00.000Z");
    assert.deepEqual(state.rivals.map(r => r.slug), ["acme"], "only rivals with signals");
    assert.deepEqual(Object.keys(state.rivals[0]), ["slug", "name", "signals", "unread"]);
    assert.deepEqual(state.rivals[0].signals[0], { key: "githubStars", label: "GitHub stars", value: 1100, previous: null, since: null, source: "https://github.com/acme/widgets" });
    assert.deepEqual(Object.keys(state.rivals[0].signals[0]), ["key", "label", "value", "previous", "since", "source"]);

    stars = 1234; roles = 14;
    const second = await runSignals(pm, { now: new Date("2026-10-03T08:00:00Z"), gh: gh(), fetchImpl });
    assert.match(second.text, /GitHub stars 1,234 \(\+134 since 2026-09-05\)/);
    assert.match(second.text, /GitHub forks 50 \(no change since 2026-09-05\)/);
    assert.match(second.text, /Open roles 14 \(\+4 since 2026-09-05\)/);
    assert.match(second.text, /Changed most: Acme, Open roles \+4 since 2026-09-05\./);
    const lines = fs.readFileSync(historyFile(pm), "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[1]).rivals.acme, { githubStars: 1234, githubForks: 50, githubReleases30d: 0, githubCommits30d: 1, openRoles: 14 });
    const again = await runSignals(pm, { now: new Date("2026-10-03T20:00:00Z"), gh: gh(), fetchImpl });
    assert.match(again.text, /\+134 since 2026-09-05/, "a second run the same day compares with the same day as before");
    assert.equal(fs.readFileSync(historyFile(pm), "utf8").trim().split("\n").length, 2);
  } finally { clean(pm); }
});

test("run: an unread source is named in the table and the state, the exit code is 2, and the rest is still saved", async () => {
  const pm = product({ acme: { name: "Acme", signals: { npm: "acme", careers: { lever: "acme" } } } });
  try {
    const fetchImpl = async url => /npmjs/.test(url) ? res(200, { downloads: 5000 }) : res(429, "slow down");
    const r = await runSignals(pm, { now: NOW, fetchImpl, gh: fakeGh({}) });
    assert.equal(r.code, 2);
    assert.match(r.text, /npm downloads \(last week\) 5,000 \(first reading\)/);
    assert.match(r.text, /not read: Open roles — rate limited, not read/);
    assert.match(r.text, /Rate limited, so not asked again this run: api\.lever\.co/);
    const s = JSON.parse(fs.readFileSync(path.join(pm, "state", "rival-signals.json"), "utf8"));
    assert.deepEqual(s.rivals[0].unread, [{ key: "openRoles", why: "rate limited, not read" }]);
  } finally { clean(pm); }
});

test("run: --json writes the state elsewhere; offline reads nothing; nothing configured, or no sources.json, is a clear refusal", async () => {
  const pm = product({ acme: { name: "Acme", signals: { npm: "acme" } }, other: { name: "Other" } });
  const out = path.join(pm, "elsewhere.json");
  try {
    const r = await runSignals(pm, { now: NOW, json: out, fetchImpl: async () => res(200, { downloads: 1 }), gh: fakeGh({}) });
    assert.equal(r.code, 0); assert.ok(fs.existsSync(out)); assert.ok(!fs.existsSync(path.join(pm, "state", "rival-signals.json")));
    const off = await runSignals(pm, { offline: true, fetchImpl: noFetch });
    assert.equal(off.code, 0); assert.match(off.text, /NOSY_OFFLINE/);
    const none = product({ acme: { name: "Acme" } });
    try { const n = await runSignals(none, { fetchImpl: noFetch }); assert.equal(n.code, 1); assert.match(n.text, /rival-signals init/); } finally { clean(none); }
    const bare = temporary("nosy-sig-bare-");
    try { assert.equal((await runSignals(bare, { fetchImpl: noFetch })).code, 1); } finally { clean(bare); }
  } finally { clean(pm); }
});

test("render: the biggest move relative to its size is named, a rating is shown to two places", () => {
  const sig = (key, value, previous, since = "2026-09-05") => ({ key, label: LABEL[key], value, previous, since, source: "https://x.example" });
  const state = { type: "rivalSignals", generated: NOW.toISOString(), rivals: [
    { slug: "a", name: "A", signals: [sig("githubStars", 5100, 5000), sig("appStoreRating", 4.5, 4.7)], unread: [] },
    { slug: "b", name: "B", signals: [sig("githubStars", 400, 300)], unread: [] }] };
  const text = render(state);
  assert.match(text, /GitHub stars 5,100 \(\+100 since 2026-09-05\)/);
  assert.match(text, /App Store rating 4\.5 \(-0\.2 since 2026-09-05\)/);
  assert.match(text, /Changed most: B, GitHub stars \+100 since 2026-09-05\./);
  assert.match(render({ ...state, rivals: [{ slug: "a", name: "A", signals: [sig("githubStars", 5, 5)], unread: [] }] }), /Nothing moved since the earlier readings\./);
});

test("signalsIn reads addresses, not prose: repos, npm, App Store, the three job boards; words about them find nothing", () => {
  const S = signalsIn([
    "- https://github.com/acme/widgets/releases (changelog)", "- https://github.com/acme/widgets/issues/4", "- https://github.com/orgs/acme", "- https://github.com/sponsors/ada",
    "- https://api.github.com/repos/other/thing/releases", "- https://www.npmjs.com/package/@acme/widgets", "- https://registry.npmjs.org/acme-cli",
    "- https://apps.apple.com/tr/app/acme/id6446?l=en", "- https://boards.greenhouse.io/acme", "- https://boards.greenhouse.io/embed/job_board?for=acmeembed", "- https://jobs.lever.co/acme-lever/abc",
    "- https://jobs.ashbyhq.com/acme-ashby", "- https://job-boards.greenhouse.io/acme/jobs/55",
  ].join("\n"));
  assert.deepEqual(S.github, ["acme/widgets", "other/thing"], "the most linked first; org and sponsor pages are not repos");
  assert.deepEqual(S.npm, ["@acme/widgets", "acme-cli"]);
  assert.deepEqual(S.apps.map(a => [a.id, a.country]), [["6446", "tr"]]);
  assert.deepEqual(S.careers, [{ greenhouse: "acme" }, { greenhouse: "acmeembed" }, { lever: "acme-lever" }, { ashby: "acme-ashby" }]);
  const quiet = signalsIn("They use Greenhouse and Lever, and the app is on the App Store and npm. github.com/ is where code lives. We love GitHub.");
  assert.deepEqual([quiet.github, quiet.npm, quiet.apps, quiet.careers], [[], [], [], []]);
});

test("init proposes a block per rival from its file and registry, prints it, and writes nothing", () => {
  const pm = product({ acme: { name: "Acme", site: "https://acme.example", releases: ["https://github.com/acme/widgets/releases"], stores: { appStore: "id999111", country: "de" } }, done: { name: "Done", signals: { npm: "done" } }, ghost: { name: "Ghost" } });
  fs.mkdirSync(path.join(pm, "rivals"));
  fs.writeFileSync(path.join(pm, "rivals", "acme.md"), "# Acme\n\n## Sources\n- https://www.npmjs.com/package/acme-sdk\n- https://jobs.lever.co/acme\n");
  fs.writeFileSync(path.join(pm, "rivals", "multi.md"), "# Multi\n\n## Sources\n- https://github.com/multi/core\n- https://github.com/multi/core/issues\n- https://github.com/multi/docs\n");
  fs.writeFileSync(path.join(pm, "rivals", "done.md"), "# Done\n- https://github.com/done/x\n");
  fs.writeFileSync(path.join(pm, "rivals", "empty.md"), "# Empty\n\nNo links, just words about Greenhouse and npm.\n");
  fs.writeFileSync(path.join(pm, "rivals", "_TEMPLATE.md"), "# t\n- https://github.com/template/x\n");
  const before = fs.readdirSync(pm, { recursive: true }).sort(), src = fs.readFileSync(path.join(pm, "sources.json"), "utf8");
  try {
    const P = initProposal(pm, JSON.parse(src));
    assert.deepEqual(P.block, {
      acme: { signals: { github: "acme/widgets", npm: "acme-sdk", appStore: "999111", country: "de", careers: { lever: "acme" } } },
      multi: { signals: { github: "multi/core" } },
    });
    assert.ok(P.notes.some(n => /^done: already has `signals`/.test(n)));
    assert.ok(P.notes.some(n => /^multi: also links multi\/docs/.test(n)));
    assert.ok(P.notes.some(n => /^empty: nothing found/.test(n)));
    assert.ok(!P.notes.some(n => /template/.test(n)) && !JSON.stringify(P.block).includes("template/x"));
    const text = renderInit(P);
    assert.match(text, /nothing was written/); assert.match(text, /"github": "acme\/widgets"/);
    assert.deepEqual(fs.readdirSync(pm, { recursive: true }).sort(), before); assert.equal(fs.readFileSync(path.join(pm, "sources.json"), "utf8"), src);
  } finally { clean(pm); }
});

test("note: refused without an http(s) source, a real past date, a known rival, or a short text; saved with today's date by default; LinkedIn kept as a pasted link", () => {
  const pm = product({ acme: { name: "Acme" } });
  const note = (o, now = NOW) => addNote(pm, { slug: "acme", text: "Raised a seed round", source: "https://news.example/acme-seed", ...o }, { now });
  try {
    for (const bad of [{ source: undefined }, { source: null }, { source: "" }, { source: "ftp://x.example/a" }, { source: "javascript:alert(1)" }, { source: "acme.example/post" }]) {
      const r = note(bad); assert.equal(r.code, 1, JSON.stringify(bad)); assert.match(r.text, /needs a source/);
    }
    assert.equal(note({ date: "2026-13-40" }).code, 1); assert.equal(note({ date: "03/10/2026" }).code, 1);
    assert.match(note({ date: "2026-10-04" }).text, /in the future/);
    assert.match(note({ slug: "nobody" }).text, /No rival called "nobody"\. Known: acme/);
    assert.equal(note({ text: "  " }).code, 1); assert.match(note({ text: "x".repeat(601) }).text, /600 characters/);
    assert.ok(!fs.existsSync(notesFile(pm)), "nothing was saved by any refusal");
    const okRes = note({}); assert.equal(okRes.code, 0); assert.match(okRes.text, /never fetched and never published/);
    assert.deepEqual(JSON.parse(fs.readFileSync(notesFile(pm), "utf8")), { at: "2026-10-03", slug: "acme", text: "Raised a seed round", source: "https://news.example/acme-seed", added: NOW.toISOString() });
    assert.match(note({}).text, /Already saved/); assert.equal(readNotes(pm).length, 1);
    const li = note({ text: "Founder post about hiring", source: "https://www.linkedin.com/posts/ada_hiring-123", date: "2026-09-28" });
    assert.equal(li.code, 0); assert.match(li.text, /Nosy never opens it/);
    assert.equal(fs.readFileSync(notesFile(pm), "utf8").trim().split("\n").length, 2, "one JSON line each");
  } finally { clean(pm); }
});

test("notes: newest first, one rival's only on request", () => {
  const pm = product({ acme: { name: "Acme" }, beta: { name: "Beta" } });
  try {
    addNote(pm, { slug: "acme", text: "older", source: "https://a.example/1", date: "2026-09-01" }, { now: NOW });
    addNote(pm, { slug: "beta", text: "other rival", source: "https://a.example/2", date: "2026-09-20" }, { now: NOW });
    addNote(pm, { slug: "acme", text: "newer", source: "https://a.example/3", date: "2026-09-25" }, { now: NOW });
    assert.deepEqual(renderNotes(readNotes(pm)).split("\n").map(l => l.slice(0, 10)), ["2026-09-25", "2026-09-20", "2026-09-01"]);
    assert.equal(renderNotes(readNotes(pm), "acme").split("\n").length, 2);
    assert.match(renderNotes(readNotes(pm), "nobody"), /No notes for nobody/);
  } finally { clean(pm); }
});

test("the notes file is the owner's, not customer demand: collect-signals and demandInputs skip it", () => {
  const pm = product({ acme: { name: "Acme" } });
  try {
    addNote(pm, { slug: "acme", text: "Founder says the export feature is coming next quarter", source: "https://news.example/x" }, { now: NOW });
    assert.deepEqual(demandInputs(pm, { }), [], "a pm/signal/ holding only rival notes has no demand input");
    const out = path.join(pm, "signals.json");
    run(path.join(Tool, "collect-signals.mjs"), [pm, path.join(pm, "signal"), "--json", out]);
    const text = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
    assert.doesNotMatch(text, /export feature is coming/);
    assert.ok(!text || JSON.parse(text).total === 0);
  } finally { clean(pm); }
});

test("the command line: note / notes / init / run through nosy.mjs, with nothing sent anywhere", () => {
  const pm = product({ acme: { name: "Acme" } });
  const nosy = path.join(Tool, "nosy.mjs"), go = (...a) => run(nosy, [...a, "--pm", pm], { env: { ...process.env, NOSY_OFFLINE: "1" } });
  try {
    const refused = go("rival-signals", "note", "acme", "no source here");
    assert.equal(refused.code, 1); assert.match(refused.error, /needs a source/);
    const saved = go("rival-signals", "note", "acme", "Hired a head of sales", "--source", "https://acme.example/blog/hire", "--date", "2026-09-30");
    assert.equal(saved.code, 0, saved.error); assert.match(saved.output, /Saved to/);
    assert.match(go("rival-signals", "notes").output, /^2026-09-30 · acme · Hired a head of sales \(https:\/\/acme\.example\/blog\/hire\)/);
    assert.equal(JSON.parse(go("rival-signals", "notes", "acme", "--json").output)[0].slug, "acme");
    assert.match(go("rival-signals", "init").output, /nothing was written/);
    assert.equal(go("rival-signals", "run").code, 1, "no signals configured: refused before any request");
    assert.equal(go("rival-signals", "bogus").code, 1);
    assert.match(go("help").output, /nosy rival-signals/);
    const direct = run(path.join(Tool, "rival-signals.mjs"), ["notes", pm, "acme"]);
    assert.match(direct.output, /Hired a head of sales/);
  } finally { clean(pm); }
});
