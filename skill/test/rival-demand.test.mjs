// skill/tools/rival-demand.mjs contract test: rival repos found in notes, asks ranked by votes with no people in them,
// lexical hints that need a real overlap, asks that recur at two rivals, and rivals that can't be read are skipped, not fatal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reposIn, hintFor, crossRival, askOf, askFromDiscussions } from "../tools/rival-demand.mjs";

const NOW = Date.parse("2026-09-30T00:00:00Z");
const item = (number, title, votes, extra = {}) => ({ number, title, comments: 1, reactions: { "+1": votes }, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", html_url: `https://github.com/x/y/issues/${number}`, user: { login: "someone" }, body: "private words", ...extra });

test("reposIn finds a rival's repo, not org pages, marketing links or the trailing punctuation", () => {
  const t = "Source: https://github.com/plausible/analytics. Sponsors: github.com/sponsors/x, org: github.com/orgs/foo, repo (github.com/umami-software/umami.git)";
  assert.deepEqual(reposIn(t).sort(), ["plausible/analytics", "umami-software/umami"]);
  assert.deepEqual(reposIn("github.com/nosy-hq/nosy and github.com/a/b", ["nosy-hq"]), ["a/b"]);
});

test("hintFor needs a real overlap with a matrix row", () => {
  const lines = [{ no: "2", feature: "Data export to CSV" }, { no: "3", feature: "Email reports" }, { no: "4", feature: "Dark mode dashboard" }];
  assert.equal(hintFor("Export data as CSV please", lines)?.no, "2");
  assert.equal(hintFor("Weekly email reports for clients", lines)?.no, "3");
  assert.equal(hintFor("Export the dashboard", lines), null, "a single stray word must not match a multi-word row");
  assert.equal(hintFor("Anything", []), null);
});

test("askOf ranks by votes, drops unvoted issues, keeps counts and links and no people or bodies", async () => {
  const getJson = async (p) => p.startsWith("repos/") ? { full_name: "acme/widget", stargazers_count: 10, archived: false }
    : { items: [item(1, "Small ask", 2), item(2, "Big ask", 40), item(3, "Nobody voted", 0), item(4, "Export data as CSV", 7)] };
  const r = await askOf("acme/widget", getJson, { lines: [{ no: "2", feature: "Data export to CSV" }], now: NOW });
  assert.ok(r.ok);
  assert.deepEqual(r.asks.map(a => a.number), [2, 4, 1]);
  assert.equal(r.asks[0].openDays, 272);
  assert.equal(r.asks[1].possibleArea.no, "2");
  const s = JSON.stringify(r);
  assert.ok(!s.includes("someone") && !s.includes("private words"));
});

test("a repo that can't be read is reported and skipped", async () => {
  const gone = async () => { throw new Error("Not Found"); };
  assert.deepEqual(await askOf("a/b", gone), { repo: "a/b", ok: false, why: "Not Found" });
  const closed = async () => ({ full_name: "a/b", has_issues: false });
  assert.match((await askOf("a/b", closed)).why, /issues are turned off/);
  const priv = async () => ({ private: true });
  assert.match((await askOf("a/b", priv)).why, /not a public repo/);
});

test("crossRival finds the same wish at two rivals and ignores two asks inside one repo", () => {
  const ask = (n, title, votes) => ({ number: n, title, votes });
  const groups = crossRival([
    { repo: "a/one", asks: [ask(1, "Add dark mode dashboard theme", 20), ask(2, "Add dark mode dashboard toggle", 5)] },
    { repo: "b/two", asks: [ask(9, "Dark mode dashboard theme support", 11), ask(8, "Unrelated billing thing", 3)] },
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].rivals.sort(), ["a/one", "b/two"]);
  assert.equal(groups[0].votes, 36);
  assert.deepEqual(crossRival([{ repo: "a/one", asks: [ask(1, "Add dark mode dashboard theme", 20), ask(2, "Add dark mode dashboard toggle", 5)] }]), []);
});

const disc = (number, title, upvoteCount, extra = {}) => ({ number, title, upvoteCount, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", url: `https://github.com/x/y/discussions/${number}`, closed: false, isAnswered: null, category: { name: "Ideas" }, comments: { totalCount: 3 }, ...extra });

test("askFromDiscussions keeps open requests, drops Q&A categories, closed threads, answered ones and unvoted ones", () => {
  const cats = [{ name: "Ideas", isAnswerable: false }, { name: "Support", isAnswerable: true }];
  const got = askFromDiscussions([
    disc(1, "Keep me", 30), disc(2, "A support question", 50, { category: { name: "Support" } }),
    disc(3, "Already decided", 60, { closed: true }), disc(4, "Answered", 20, { isAnswered: true }), disc(5, "No votes", 0),
  ], cats);
  assert.deepEqual(got.map(a => a.number), [1]);
  assert.equal(got[0].kind, "discussion"); assert.equal(got[0].votes, 30);
});

test("askOf merges issues and discussions by votes, and says so when discussions were capped or unreadable", async () => {
  const getJson = async (p) => p.startsWith("repos/") ? { full_name: "acme/widget", has_discussions: true }
    : { items: [item(1, "Issue with few votes", 3), item(2, "Issue with many votes", 25)] };
  const getDiscussions = async () => ({ nodes: [disc(9, "Discussion in the middle", 10)], categories: [], total: 1727, capped: true });
  const r = await askOf("acme/widget", getJson, { getDiscussions, now: NOW });
  assert.deepEqual(r.asks.map(a => [a.kind, a.number]), [["issue", 2], ["discussion", 9], ["issue", 1]]);
  assert.match(r.discussionsNote, /latest 1 of 1727/);
  const broken = await askOf("acme/widget", getJson, { getDiscussions: async () => { throw new Error("needs `gh auth login` or GH_TOKEN"); }, now: NOW });
  assert.ok(broken.ok); assert.equal(broken.asks.length, 2); assert.match(broken.discussionsNote, /not read: needs/);
  const off = await askOf("acme/widget", async (p) => p.startsWith("repos/") ? { full_name: "acme/widget" } : { items: [] }, { getDiscussions: async () => { throw new Error("must not be called"); }, now: NOW });
  assert.ok(off.ok && !off.discussionsNote);
});

// ---- Fixes found by the Chatwoot, Relaticle and Parchi case studies (30 Sep 2026) ----
import { isBugTitle, isAnnouncementTitle, sharedTopics } from "../tools/rival-demand.mjs";

test("plurals and endings no longer hide a match: pipelines vs pipeline, memories vs memory", () => {
  const lines = [{ no: "1", feature: "Sales pipeline board" }, { no: "2", feature: "Memory" }];
  assert.equal(hintFor("Support for multiple pipelines", lines)?.no, undefined, "one shared word is still not enough for a two-word row");
  assert.equal(hintFor("Pipelines board with stages", lines)?.no, "1");
  assert.equal(hintFor("Add memories to the agent", lines)?.no, "2");
});

test("a row that lists alternatives matches on one of them: WhatsApp in 'WhatsApp, Telegram, Line and SMS channels'", () => {
  const lines = [{ no: "7", feature: "WhatsApp, Telegram, Line and SMS channels" }];
  assert.equal(hintFor("WhatsApp integration", lines)?.no, "7");
  assert.equal(hintFor("Integration channels", lines), null, "'channels' alone is not one of the alternatives");
});

test("opposite wishes and one-line titles are not merged into one ask across rivals", () => {
  const ask = (n, title, votes) => ({ number: n, title, votes });
  assert.deepEqual(crossRival([
    { repo: "a/zammad", asks: [ask(325, "Optional disable support for HTML emails", 41)] },
    { repo: "b/lhc", asks: [ask(814, "HTML Emails", 1)] },
  ]), []);
  assert.deepEqual(crossRival([
    { repo: "a/rc", asks: [ask(1, "Nested Items are broken after 5.x.x", 21)] },
    { repo: "b/fs", asks: [ask(2, "Inline images in old conversations are broken after upgrade", 1)] },
  ]), []);
});

test("bug reports and announcement or thank-you threads are recognised, feature asks are not", () => {
  assert.ok(isBugTitle("[Bug] Nested Items are broken after 5.x.x"));
  assert.ok(isBugTitle("Crash when opening the settings page"));
  assert.ok(!isBugTitle("Export data as CSV"));
  for (const t of ["Support the Project", "Just some positive feedback to the team", "v1.5.1", "Release notes 2.3", "Happy holidays!", "Roadmap 2026", "Welcome to the community"]) assert.ok(isAnnouncementTitle(t), t);
  assert.ok(!isAnnouncementTitle("Support for OpenID Connect"));
  assert.ok(!isAnnouncementTitle("Roadmap view for tasks"), "a feature about roadmaps is an ask");
});

test("askOf leaves out bug-labelled issues and announcements, and says how many", async () => {
  const getJson = async (p) => p.startsWith("repos/") ? { full_name: "acme/widget" }
    : { items: [item(1, "Real ask", 5), item(2, "Some defect", 30, { labels: [{ name: "type: bug" }] }), item(3, "Thanks for the great tool", 20)] };
  const r = await askOf("acme/widget", getJson, { now: NOW });
  assert.deepEqual(r.asks.map(a => a.number), [1]);
  assert.deepEqual(r.skipped, { bugs: 1, announcements: 1, categories: 0 });
});

test("askFromDiscussions drops Announcements and Show-and-tell categories and announcement titles, and keeps the category name", () => {
  const cats = [{ name: "Ideas", isAnswerable: false }];
  const skipped = { bugs: 0, announcements: 0, categories: 0 };
  const got = askFromDiscussions([
    disc(1, "Keep me", 30), disc(2, "Big news", 50, { category: { name: "Announcements" } }),
    disc(3, "My setup", 40, { category: { name: "Show and tell" } }), disc(4, "v2.0 release", 20),
  ], cats, skipped);
  assert.deepEqual(got.map(a => a.number), [1]);
  assert.equal(got[0].category, "Ideas");
  assert.deepEqual(skipped, { bugs: 0, announcements: 1, categories: 2 });
});

test("sharedTopics lists a distinctive word asked at two rivals (MCP), without calling it the same ask", () => {
  const ask = (n, title, votes) => ({ number: n, title, votes });
  const topics = sharedTopics([
    { repo: "a/one", asks: [ask(123, "Add MCP support (client)", 3), ask(5, "Dark theme", 9)] },
    { repo: "b/two", asks: [ask(507, "Is MCP support on the roadmap?", 5)] },
    { repo: "c/three", asks: [ask(1049, "Why not use the MCP architecture", 4)] },
  ]);
  assert.equal(topics[0].word, "MCP");
  assert.deepEqual(topics[0].rivals.sort(), ["a/one", "b/two", "c/three"]);
  assert.equal(topics[0].votes, 12);
  assert.ok(!topics.some(t => /theme|dark/i.test(t.word)), "ordinary words are not topics");
});

test("two email asks that share only 'multiple' and 'email' stay apart; roadmap announcements and General questions are left out", () => {
  const ask = (n, title, votes) => ({ number: n, title, votes });
  assert.deepEqual(crossRival([
    { repo: "a/espo", asks: [ask(2387, "Multiple email signatures per multiple email accounts", 6)] },
    { repo: "b/krayin", asks: [ask(2554, "Support Multiple Email Mailboxes", 3)] },
  ]), []);
  assert.ok(isAnnouncementTitle("Nanobrowser Roadmap: Upcoming Features & Enhancements"));
  assert.ok(!isAnnouncementTitle("is MCP support on the roadmap?"));
  const cats = [{ name: "General", isAnswerable: false }];
  const skipped = { bugs: 0, announcements: 0, categories: 0 };
  const got = askFromDiscussions([disc(1, "is there support for playwright stealth?", 5, { category: { name: "General" } }), disc(2, "Separate browser windows for one profile", 5, { category: { name: "General" } })], cats, skipped);
  assert.deepEqual(got.map(a => a.number), [2]);
  assert.equal(skipped.categories, 1);
});
