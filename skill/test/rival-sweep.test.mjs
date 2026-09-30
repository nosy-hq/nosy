// rival-sweep.mjs: each rival's dated entries in a window, from the registry's pages. No network: a fake fetcher.
import { test } from "node:test";
import assert from "node:assert/strict";
import { datesIn, entriesIn, textOf, sweep, render } from "../tools/rival-sweep.mjs";

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
