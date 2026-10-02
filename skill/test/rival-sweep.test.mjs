// rival-sweep.mjs: each rival's dated entries in a window, from the registry's pages. No network: a fake fetcher.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { datesIn, entriesIn, textOf, sweep, render, appStoreOf, storeEntryOf } from "../tools/rival-sweep.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const RELEASES = `<html><head><script>var x = "Sep 1, 2026";</script></head><body>
<h2>Agentic Search for DMS</h2><p>Sep 23, 2026</p><p>Search SharePoint and Drive directly.</p><span>Integrations</span>
<h2>User-Level Memory</h2><p>Sep 9, 2026</p><p>RivalOne saves your preferences.</p><span>Assistant</span>
<h2>Old thing</h2><p>Aug 2, 2026</p><p>Outside the window.</p>
</body></html>`;
const NEWS_TR = `<ul><li>RivalTwo sohbet eklentisini duyurdu — 17 Eylül 2026</li><li>Münih ofisi açıldı 28.09.2026</li><li>Eski haber 2026-07-01</li></ul>`;

test("datesIn: English, Turkish, ISO and dotted dates; nothing from scripts", () => {
  const t = textOf(RELEASES + NEWS_TR);
  assert.deepEqual(datesIn(t).map(d => d.date), ["2026-09-23", "2026-09-09", "2026-08-02", "2026-09-17", "2026-09-28", "2026-07-01"]);
  assert.deepEqual(datesIn("16 September 2026 · Sept 3rd, 2026").map(d => d.date), ["2026-09-16", "2026-09-03"]);
});

test("entriesIn: the title before the date plus the text after it, the next title left out, only inside the window", () => {
  const E = entriesIn(textOf(RELEASES), "2026-08-30", "2026-09-29");
  assert.equal(E.length, 2);
  assert.equal(E[0].date, "2026-09-23");
  assert.match(E[0].text, /^Agentic Search for DMS · Search SharePoint and Drive directly\. Integrations$/);
  assert.match(E[1].text, /^User-Level Memory · RivalOne saves your preferences\./);
  assert.doesNotMatch(E[1].text, /Old thing/);
});

test("sweep + render: entries per page kind; unreadable pages, pages without dates and login pages are named, never silent", async () => {
  const pages = {
    "https://h.example/release-notes": { status: 200, text: textOf(RELEASES) + " filler".repeat(80) },
    "https://l.example/newsroom": { status: 200, text: textOf(NEWS_TR) + " filler".repeat(80) },
    "https://s.example/blog": { status: 200, text: "a blog without any dates ".repeat(20) },
    "https://x.example/gone": { status: 404, text: "not found" },
  };
  const S = await sweep({
    rone: { name: "RivalOne", releases: ["https://h.example/release-notes"] },
    rtwo: { name: "RivalTwo", news: ["https://l.example/newsroom"], login: ["release notes (help center)"] },
    spell: { name: "Spell", blog: ["https://s.example/blog", "https://x.example/gone"] },
  }, { from: "2026-08-30", to: "2026-09-29", fetcher: async u => pages[u] || { status: 0, error: "timeout" } });
  assert.deepEqual(S.map(R => R.pages.reduce((n, p) => n + p.entries.length, 0)), [2, 2, 0]);
  const md = render(S, { from: "2026-08-30", to: "2026-09-29" });
  assert.match(md, /## RivalOne: 2 dated entries in the window/);
  assert.match(md, /- releases: https:\/\/h\.example\/release-notes \(release notes → shipped if listed there; 3 dates on the page\)/);
  assert.match(md, /2026-09-17 · RivalTwo sohbet eklentisini duyurdu/);
  assert.match(md, /needs a login, not fetched: release notes \(help center\)/);
  assert.match(md, /s\.example\/blog — \*\*not read: no dates on the page: read it by hand\*\*/);
  assert.match(md, /x\.example\/gone — \*\*not read: HTTP 404\*\*/);
  assert.equal(S[2].pages.some(p => !p.ok), true);
});

test("dates without a year take the window's year (or the year before), and only when a window is given", async () => {
  assert.deepEqual(datesIn("Sep 23 Workflows. Aug 5 Lists. Dec 20 Older. Version 2.43, Sep 1.5x", { to: "2026-09-29" }).map(d => d.date), ["2026-09-23", "2026-08-05", "2025-12-20"]);
  assert.equal(datesIn("Sep 23 Workflows").length, 0);
  const E = entriesIn(textOf("<h3>Workflow triggers</h3><p>Sep 23</p><p>Schedule a workflow.</p><h3>Old</h3><p>Jul 1</p><p>x</p>"), "2026-08-30", "2026-09-29");
  assert.deepEqual(E.map(e => e.date), ["2026-09-23"]);
  const S = await sweep({ hub: { name: "Hub", browser: ["https://community.example/updates"] } }, { from: "2026-08-30", to: "2026-09-29", fetcher: async () => ({ status: 0 }) });
  assert.match(render(S, { from: "2026-08-30", to: "2026-09-29" }), /opens in a browser but blocks scripts, not fetched: https:\/\/community\.example\/updates/);
});

test("textOf: a closing tag with whitespace (</style\\n>) doesn't swallow the page; <time datetime> keeps its full date", () => {
  const html = `<style>:host{x}</style\n\t><h3>Workflow history</h3><time datetime="2026-09-23T13:37:22Z">Sep 23</time><p>Every run, down to the agent.</p><style>.a{}</style>`;
  const t = textOf(html);
  assert.match(t, /Workflow history/);
  assert.deepEqual(entriesIn(t, "2026-08-30", "2026-09-29").map(e => e.date), ["2026-09-23"]);
});

// --- App Store lookup ---------------------------------------------------------------------------------
// The bug to prevent: release notes of 1.3.3 attached to 1.3.4. The lookup answers only for the CURRENT version, so its notes carry that version's
// label and are never merged with what a registry page says about another one.
const W = { from: "2026-09-01", to: "2026-09-29" };
const LOOKUP = "https://itunes.apple.com/lookup?id=6446123456&country=tr";
const answer = o => ({ status: 200, text: JSON.stringify({ resultCount: 1, results: [o] }) });
const APP = { trackName: "Safahat", version: "1.3.4", currentVersionReleaseDate: "2026-09-28T09:15:00Z", releaseNotes: "Offline mode.\nBug fixes.", trackViewUrl: "https://apps.apple.com/tr/app/safahat/id6446123456" };
const asks = [];
const fetchWith = pages => async u => { asks.push(u); const r = pages[u]; if (r instanceof Error) throw r; return r || { status: 0, error: "timeout" }; };

test("appStoreOf: a number, id123, an apps.apple.com url or an itunes lookup url; the country from the field, the url or us", () => {
  assert.deepEqual(appStoreOf({ appStore: "6446123456", country: "TR" }), { id: "6446123456", country: "tr", url: LOOKUP });
  assert.equal(appStoreOf({ appStore: 6446123456 }).country, "us");
  assert.equal(appStoreOf({ appStore: "https://apps.apple.com/tr/app/safahat/id6446123456?l=en" }).url, LOOKUP);
  assert.equal(appStoreOf({ appStore: "id6446123456" }).id, "6446123456");
  assert.equal(appStoreOf({ appStore: "https://itunes.apple.com/lookup?id=6446123456&country=de" }).country, "de");
  assert.equal(appStoreOf({ appStore: "https://apps.apple.com/tr/app/safahat", country: "de" }), null, "no id, nothing to ask");
  assert.equal(appStoreOf({}), null); assert.equal(appStoreOf(undefined), null);
});

test("the store entry is the current version with its date and notes, grade primary, labelled v1.3.4, and kept apart from a registry page that mentions 1.3.3", async () => {
  asks.length = 0;
  const page = textOf("<h2>Version 1.3.3</h2><p>Sep 10, 2026</p><p>Fixed the login crash.</p><h2>Version 1.3.2</h2><p>Aug 20, 2026</p><p>Dark mode.</p>") + " filler".repeat(80);
  const S = await sweep({ safahat: { name: "Safahat", releases: ["https://apps.apple.com/tr/app/safahat/id6446123456"], stores: { appStore: "6446123456", country: "tr" } } },
    { ...W, fetcher: fetchWith({ "https://apps.apple.com/tr/app/safahat/id6446123456": { status: 200, text: page }, [LOOKUP]: answer(APP) }) });
  assert.deepEqual(asks, ["https://apps.apple.com/tr/app/safahat/id6446123456", LOOKUP]);
  const [reg, store] = S[0].pages;
  assert.equal(store.kind, "appStore"); assert.equal(store.ok, true);
  assert.deepEqual(store.entries, [{ date: "2026-09-28", version: "1.3.4", grade: "primary", source: "appStore", text: "v1.3.4 (App Store, current version): Offline mode. Bug fixes." }]);
  assert.equal(store.store.version, "1.3.4"); assert.equal(store.store.grade, "primary");
  assert.deepEqual(reg.entries.map(e => e.date), ["2026-09-10"], "the registry page's own entry is the 1.3.3 one");
  assert.match(reg.entries[0].text, /1\.3\.3/); assert.doesNotMatch(reg.entries[0].text, /Offline mode|1\.3\.4/, "1.3.4's notes are not on 1.3.3's entry");
  assert.doesNotMatch(store.entries[0].text, /login crash|1\.3\.3/, "1.3.3's notes are not on 1.3.4's entry");
  const md = render(S, W);
  assert.match(md, /## Safahat: 2 dated entries in the window/);
  assert.match(md, /- appStore \(tr\): https:\/\/itunes\.apple\.com\/lookup\?id=6446123456&country=tr \(App Store lookup, primary → shipped: the current version only\) · Safahat v1\.3\.4, released 2026-09-28/);
  assert.match(md, /2026-09-28 · v1\.3\.4 \(App Store, current version\): Offline mode\./);
});

test("a current version released before the window isn't a dated entry in it, but its version, date and notes still print together", async () => {
  const S = await sweep({ a: { name: "A", stores: { appStore: "6446123456", country: "tr" } } },
    { ...W, fetcher: fetchWith({ [LOOKUP]: answer({ ...APP, version: "2.0", currentVersionReleaseDate: "2026-06-01T00:00:00Z" }) }) });
  assert.deepEqual(S[0].pages[0].entries, []); assert.equal(S[0].pages[0].ok, true);
  const md = render(S, W);
  assert.match(md, /Safahat v2\.0, released 2026-06-01 \(outside the window\)/);
  assert.match(md, /- v2\.0 · Offline mode\./);
  assert.match(md, /## A: 0 dated entries/);
});

test("store lookup that fails or answers nothing: a quiet note in the unreadable list, never an exception, and the other pages still read", async () => {
  const fine = { "https://h.example/release-notes": { status: 200, text: textOf(RELEASES) + " filler".repeat(80) } };
  const cases = { "network failure": { status: 0, error: "fetch failed" }, "HTTP 500": { status: 500, text: "oops" }, "empty result": { status: 200, text: '{"resultCount":0,"results":[]}' },
    "not JSON": { status: 200, text: "<html>hello</html>" }, "no version": answer({ ...APP, version: "" }), "thrown": new Error("socket hang up") };
  for (const [name, reply] of Object.entries(cases)) {
    const S = await sweep({ a: { name: "A", releases: ["https://h.example/release-notes"], stores: { appStore: "6446123456", country: "tr" } } }, { from: "2026-08-30", to: "2026-09-29", fetcher: fetchWith({ ...fine, [LOOKUP]: reply }) });
    const store = S[0].pages[1];
    assert.equal(store.ok, false, name); assert.equal(store.quiet, true, name); assert.equal(store.entries.length, 0, name); assert.match(store.problem, /^store lookup failed/, name);
    assert.equal(S[0].pages[0].entries.length, 2, `${name}: the release notes are still read`);
    assert.match(render(S, { from: "2026-08-30", to: "2026-09-29" }), /- appStore \(tr\): .* — not read: store lookup failed/, name);
  }
  assert.match(storeEntryOf('{"results":[{"trackName":"X","releaseNotes":"n"}]}', W).problem, /names no version/, "notes with no version are never offered");
  const bad = await sweep({ a: { name: "A", stores: { appStore: "https://apps.apple.com/tr/app/safahat" } } }, { ...W, fetcher: fetchWith({}) });
  assert.match(bad[0].pages[0].problem, /store lookup failed \(no App Store id/);
});

test("after an HTTP 429 a site isn't asked again for the rest of the run: its other pages say 'rate limited, not read'; other sites carry on", async () => {
  asks.length = 0;
  const ok = { status: 200, text: textOf(RELEASES) + " filler".repeat(80) };
  const S = await sweep({
    one: { name: "One", releases: ["https://a.example/changelog"], news: ["https://www.a.example/news"], blog: ["https://a.example/blog"] },
    two: { name: "Two", releases: ["https://a.example/two-changelog"] },
    three: { name: "Three", releases: ["https://b.example/changelog"] },
  }, { from: "2026-08-30", to: "2026-09-29", fetcher: fetchWith({ "https://a.example/changelog": { status: 429, text: "slow down" }, "https://b.example/changelog": ok }) });
  assert.deepEqual(asks, ["https://a.example/changelog", "https://b.example/changelog"], "a.example (with or without www) is asked once, then left alone");
  assert.deepEqual(S[0].pages.map(p => p.problem), ["rate limited, not read", "rate limited, not read", "rate limited, not read"]);
  assert.equal(S[1].pages[0].problem, "rate limited, not read");
  assert.equal(S[2].pages[0].ok, true);
  assert.match(render(S, { from: "2026-08-30", to: "2026-09-29" }), /a\.example\/news — \*\*not read: rate limited, not read\*\*/);
  // The store's host is a site like any other.
  asks.length = 0;
  const T2 = await sweep({ a: { name: "A", stores: { appStore: "6446123456" } }, b: { name: "B", stores: { appStore: "6446999999" } } }, { ...W, fetcher: fetchWith({ "https://itunes.apple.com/lookup?id=6446123456&country=us": { status: 429, text: "" } }) });
  assert.deepEqual(asks, ["https://itunes.apple.com/lookup?id=6446123456&country=us"], "the second app isn't looked up once Apple said 429");
  assert.deepEqual(T2.map(R => R.pages[0].problem), ["rate limited, not read", "rate limited, not read"]);
});

test("the CLI: a store lookup that cannot run is a note in the output and exit 0, and the run still writes its JSON", () => {
  const root = temporary("nosy-sweep-store-"); const pm = path.join(root, "pm"); fs.mkdirSync(pm, { recursive: true });
  try {
    fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ rivals: { a: { name: "A", stores: { appStore: "not an id" } } } }));
    const r = run(path.join(Tool, "rival-sweep.mjs"), [pm, "--days", "30"]);
    assert.equal(r.code, 0, r.error); assert.match(r.output, /not read: store lookup failed \(no App Store id/);
    const j = JSON.parse(fs.readFileSync(path.join(pm, "state", "rival-sweep.json"), "utf8")); assert.equal(j.rivals[0].pages[0].kind, "appStore");
  } finally { clean(root); }
});

test("the App Store country is two letters or 'us': whatever else the registry says never reaches the lookup address", () => {
  for (const bad of ["tr&limit=200", "turkey", "t", "  ", "1x", "tr/../x"]) assert.equal(appStoreOf({ appStore: "id123456", country: bad }).url, "https://itunes.apple.com/lookup?id=123456&country=us", JSON.stringify(bad));
  assert.equal(appStoreOf({ appStore: "id123456", country: " TR " }).url, "https://itunes.apple.com/lookup?id=123456&country=tr");
  assert.equal(appStoreOf({ appStore: "https://apps.apple.com/de/app/x/id999888" }).country, "de");
  assert.equal(appStoreOf({ appStore: "id12" }), null, "an id has at least three digits");
});
