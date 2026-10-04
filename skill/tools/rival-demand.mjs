// Rival demand: what the users of your rivals ask for and the rival has not shipped. Reads each open-source rival's public
// issue tracker and GitHub Discussions and lists the open ones with the most votes (counts, titles, links; never bodies,
// never people). Many projects (Plausible, for one) collect feature requests in Discussions, so both are read.
// "Users of rival X ask for Y (38 votes, open 214 days) and X has not shipped it" is something a feedback board can't say,
// because a board only sees your own customers. Public data only, no model. A lexical hint links an ask to your matrix
// row and to asks at other rivals; it is a hint for the agent to check, not a verdict.
// Usage: node rival-demand.mjs <pm folder> [--repos owner/repo,owner/repo] [--top N] [--json <file>]
// Repos come from --repos, then sources.json `rivalRepos` (["owner/repo", ...]), then GitHub links found in pm/rivals/*.md.
// Reads: pm/matrix.json (optional, for the hints). Writes: --json file (pm/state/rival-demand.json by convention).
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
import { matrixRead } from "./read-matrix.mjs";
import { readSources } from "./sources-file.mjs";
import { sourcesProblem } from "./hints.mjs";

const MAX_REPOS = 15;
const NOT_REPO = new Set(["orgs", "sponsors", "features", "apps", "marketplace", "topics", "about", "pricing", "login", "settings", "collections"]);
const STOP = new Set("with from that this have when your they them what will would could should into about more than also make able allow support option feature request add please need want using use like just some when where which their there been being does doesnt dont cant able the and for you not can are but all any has its our out get let too via how why who new way way one two per off after before still broken issue error fix bug work working".split(" "));

// GitHub links in the rival notes: the rival's own repo, not the org page or a marketing link.
export function reposIn(text, skip = []) {
  const out = new Set();
  for (const m of text.matchAll(/github\.com\/([A-Za-z0-9][\w-]{0,38})\/([\w.-]{1,100})/g)) {
    const owner = m[1], repo = m[2].replace(/\.git$/, "").replace(/[.,;:)]+$/, "");
    if (NOT_REPO.has(owner.toLowerCase()) || !repo || skip.includes(owner.toLowerCase())) continue;
    out.add(`${owner}/${repo}`);
  }
  return [...out];
}

// Plural and verb endings are cut so "pipelines" meets "pipeline" and "memories" meets "memory". Words of 3 letters stay as they are.
export const stem = w => w.length > 5 && w.endsWith("ing") ? w.slice(0, -3) : w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y`
  : w.length > 4 && w.endsWith("sses") ? w.slice(0, -2) : w.length > 4 && w.endsWith("ed") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
const tokens = s => new Set((String(s).toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []).filter(w => !STOP.has(w)).map(stem)); // 3+ letters, so csv, api, sso, pdf count
const shared = (a, b) => [...a].filter(w => b.has(w));

// Which matrix row an ask might belong to. Needs a real overlap, so a stray word doesn't count. A row that lists alternatives
// ("WhatsApp, Telegram, Line and SMS channels") is read as separate short features, so naming one of them is enough.
export function hintFor(title, lines) {
  const t = tokens(title); let best = null;
  for (const l of lines) {
    const alts = String(l.feature).split(/,|\band\b|\bor\b|\//i).map(tokens).filter(a => a.size);
    const whole = tokens(l.feature); if (!whole.size) continue;
    for (const f of alts.length > 1 ? alts : [whole]) {
      const s = shared(f, t);
      const ok = s.length >= 2 || (f.size === 1 && s.length === 1);
      if (ok && (!best || s.length / f.size > best.share)) best = { no: l.no ?? null, feature: l.feature, words: s, share: s.length / f.size };
    }
  }
  return best ? { no: best.no, feature: best.feature, words: best.words } : null;
}

// Not feature asks: bug reports, and announcement, release-notes and thank-you threads (a 👍 on those is applause).
export const isBugTitle = title => /^\W*(?:\[?(?:bug|defect|regression)\]?[\s:-]|fix:|error:)/i.test(title) || /\b(?:broken|crash(?:es|ed|ing)?|regression)\b/i.test(title);
export const isAnnouncementTitle = title => /^\W*(?:v?\d+\.\d+(?:\.\d+)?\b|release notes?\b|releases?\b|changelog\b|(?:[\w.-]+\s+){0,2}roadmap\b(?!\s+(?:view|board|for)\b)|announc|welcome\b|thank|happy\b|merry\b|season'?s|holiday|support the project|just some positive feedback|positive feedback|newsletter\b|what'?s new\b|patch notes)/i.test(title)
  || /\b(?:thank you|thanks for|release notes?)\b/i.test(title);
// In a "General" category, a title that is a question ("Chat problem?", "How do I…", "Is there…") is support, not a request.
export const isQuestionTitle = title => /\?\s*$/.test(title) || /^\W*(?:how|why|what|where|when|which|who|is there|is it|are there|can i|can you|could you|does|do you|did|help)\b/i.test(title);
const NOT_ASK_CATEGORY = /^(?:announcements?|show and tell|show & tell|polls?|releases?|news|introductions?|q&a|help|support|questions?)$/i;
const BUG_LABEL = /\b(?:bug|defect|regression|crash|security|question|support)\b/i;
// Words that opposite wishes hang on ("disable HTML emails" vs "HTML emails"): a group is not formed across them.
const NEGATION = new Set("disable disabled remove drop hide optional stop without no not never turn off".split(" "));

// Asks that look alike at two or more rivals: the same wish in different products' trackers. Needs three shared words, or
// two when both titles have three or more words and three quarters of the shorter one is shared. Titles that lean opposite ways
// (one has "disable", "remove", "optional"… and the other doesn't) are never grouped. It is still a hint made of words.
const leansNegative = title => [...String(title).toLowerCase().match(/[a-z]+/g) || []].some(w => NEGATION.has(w));
export function crossRival(repos) {
  const nodes = repos.flatMap(r => (r.asks || []).map(a => ({ repo: r.repo, a, t: tokens(a.title), neg: leansNegative(a.title) })));
  const parent = nodes.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    if (nodes[i].repo === nodes[j].repo || nodes[i].neg !== nodes[j].neg) continue;
    const s = shared(nodes[i].t, nodes[j].t), small = Math.min(nodes[i].t.size, nodes[j].t.size);
    if (s.length >= 3 || (s.length >= 2 && small >= 3 && s.length / small >= 0.75)) parent[find(i)] = find(j);
  }
  const groups = new Map();
  nodes.forEach((n, i) => { const k = find(i); (groups.get(k) || groups.set(k, []).get(k)).push(n); });
  return [...groups.values()].filter(g => new Set(g.map(n => n.repo)).size >= 2)
    .map(g => ({ rivals: [...new Set(g.map(n => n.repo))], votes: g.reduce((s, n) => s + n.a.votes, 0), asks: g.map(n => ({ repo: n.repo, number: n.a.number, title: n.a.title, votes: n.a.votes })) }))
    .sort((a, b) => b.votes - a.votes);
}

// An acronym asked at two or more rivals ("MCP", "SSO", "LDAP", "CSV"): a topic to go and look at, not "the same ask".
// Only words written in capitals in the title count, so common words ("browser", "email", "send") don't fill the list.
const NOT_TOPIC = new Set("AI UI UX OK NEW PR RFC FAQ TODO HD ID OS".split(" "));
export function sharedTopics(repos) {
  const byWord = new Map();
  for (const r of repos) for (const a of r.asks || []) for (const w of new Set(String(a.title).match(/\b[A-Z]{2,6}\b/g) || [])) {
    if (NOT_TOPIC.has(w)) continue;
    if (!byWord.has(w)) byWord.set(w, []); byWord.get(w).push({ repo: r.repo, number: a.number, title: a.title, votes: a.votes });
  }
  return [...byWord].filter(([, asks]) => new Set(asks.map(x => x.repo)).size >= 2)
    .map(([word, asks]) => ({ word, rivals: [...new Set(asks.map(x => x.repo))], votes: asks.reduce((s, x) => s + x.votes, 0), asks }))
    .sort((a, b) => b.rivals.length - a.rivals.length || b.votes - a.votes).slice(0, 8);
}

// Discussions come back unsorted by votes, so they are paged (newest activity first, up to MAX_PAGES x 100) and sorted here.
// Q&A categories are support questions, not requests; closed threads are decided or done.
const MAX_PAGES = 20;
export function askFromDiscussions(nodes, categories = [], skipped = null) {
  const qa = new Set(categories.filter(c => c.isAnswerable).map(c => c.name));
  const count = (k) => { if (skipped) skipped[k]++; return false; };
  return nodes.filter(d => !d.closed && !qa.has(d.category?.name) && !d.isAnswered && d.upvoteCount > 0)
    .filter(d => !NOT_ASK_CATEGORY.test(d.category?.name || "") || count("categories"))
    .filter(d => !isAnnouncementTitle(d.title) || count("announcements"))
    .filter(d => !(/^general$/i.test(d.category?.name || "") && isQuestionTitle(d.title)) || count("categories"))
    .map(d => ({ kind: "discussion", number: d.number, title: String(d.title).slice(0, 140), votes: d.upvoteCount, comments: d.comments?.totalCount ?? 0, category: d.category?.name ?? null, created_at: d.createdAt, updated_at: d.updatedAt, html_url: d.url }));
}

const daysSince = (iso, now) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 864e5)) : null);

// One rival's tracker → { repo, ok, stars, asks } or { repo, ok:false, why }. `getJson(url-path, query)` is injected so tests need no network.
export async function askOf(repo, getJson, { top = 8, lines = [], now = Date.now(), getDiscussions = null } = {}) {
  let meta;
  try { meta = await getJson(`repos/${repo}`); } catch (e) { return { repo, ok: false, why: e.message }; }
  if (meta.private) return { repo, ok: false, why: "not a public repo" };
  if (meta.has_issues === false) return { repo, ok: false, why: "issues are turned off on this repo" };
  let res;
  try { res = await getJson("search/issues", { q: `repo:${meta.full_name || repo} is:issue is:open`, sort: "reactions-+1", order: "desc", per_page: "30" }); } catch (e) { return { repo, ok: false, why: e.message }; }
  const skipped = { bugs: 0, announcements: 0, categories: 0 };
  const issues = (res.items || [])
    .filter(i => !((i.labels || []).some(l => BUG_LABEL.test(l.name || "")) || isBugTitle(i.title)) || (skipped.bugs++, false))
    .filter(i => !isAnnouncementTitle(i.title) || (skipped.announcements++, false))
    .map(i => ({ kind: "issue", number: i.number, title: i.title, votes: i.reactions?.["+1"] ?? 0, comments: i.comments ?? 0, created_at: i.created_at, updated_at: i.updated_at, html_url: i.html_url }));
  let discussions = [], discussionsNote = null;
  if (meta.has_discussions && getDiscussions) {
    try { const d = await getDiscussions(repo); discussions = askFromDiscussions(d.nodes, d.categories, skipped); if (d.capped) discussionsNote = `read the latest ${d.nodes.length} of ${d.total} discussions`; }
    catch (e) { discussionsNote = `discussions not read: ${e.message}`; }
  }
  const asks = [...issues, ...discussions]
    .map(i => ({ kind: i.kind, number: i.number, title: String(i.title).slice(0, 140), votes: i.votes, comments: i.comments, category: i.category ?? null, openDays: daysSince(i.created_at, now), quietDays: daysSince(i.updated_at, now), url: i.html_url }))
    .filter(a => a.votes > 0).sort((a, b) => b.votes - a.votes).slice(0, top)
    .map(a => ({ ...a, possibleArea: hintFor(a.title, lines) }));
  return { repo: meta.full_name || repo, ok: true, stars: meta.stargazers_count ?? null, archived: !!meta.archived, ...(discussionsNote ? { discussionsNote } : {}), skipped, asks };
}

// gh when it is installed and signed in (5,000 calls an hour); otherwise plain fetch, with GH_TOKEN / GITHUB_TOKEN if set.
export function makeGetJson() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  let useGh = true;
  return async (p, query) => {
    if (useGh) {
      try {
        const args = ["api", "-X", "GET", p, ...Object.entries(query || {}).flatMap(([k, v]) => ["-f", `${k}=${v}`])];
        return JSON.parse(execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 << 20 }));
      } catch (e) {
        if (e.code === "ENOENT" || /auth|login|GH_TOKEN/i.test(String(e.stderr))) useGh = false;
        else throw new Error(String(e.stderr || e.message).trim().split("\n")[0] || "gh failed");
      }
    }
    const url = new URL(`https://api.github.com/${p}`); for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { accept: "application/vnd.github+json", "user-agent": "nosy", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    if (res.status === 404) throw new Error("repo not found, or not public");
    if (res.status === 403 || res.status === 429) throw new Error("GitHub is rate-limiting (sign in with `gh auth login` or set GH_TOKEN)");
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    return res.json();
  };
}

const DISCUSSIONS = `query($o:String!,$n:String!,$after:String){repository(owner:$o,name:$n){discussionCategories(first:25){nodes{name isAnswerable}}
  discussions(first:100, after:$after, orderBy:{field:UPDATED_AT,direction:DESC}){totalCount pageInfo{hasNextPage endCursor}
  nodes{number title upvoteCount createdAt updatedAt url closed isAnswered category{name} comments{totalCount}}}}}`;

// Pages through a repo's discussions with gh (or a token). Returns { nodes, categories, total, capped }.
export function makeGetDiscussions(maxPages = MAX_PAGES) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  let useGh = true;
  const page = async (o, n, after) => {
    if (useGh) {
      try {
        const args = ["api", "graphql", "-f", `query=${DISCUSSIONS}`, "-f", `o=${o}`, "-f", `n=${n}`, ...(after ? ["-f", `after=${after}`] : [])];
        return JSON.parse(execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 }));
      } catch (e) {
        if (e.code === "ENOENT" || /auth|login|GH_TOKEN/i.test(String(e.stderr))) useGh = false;
        else throw new Error(String(e.stderr || e.message).trim().split("\n")[0] || "gh failed");
      }
    }
    if (!token) throw new Error("needs `gh auth login` or GH_TOKEN");
    const res = await fetch("https://api.github.com/graphql", { method: "POST", headers: { authorization: `Bearer ${token}`, "user-agent": "nosy", "content-type": "application/json" }, body: JSON.stringify({ query: DISCUSSIONS, variables: { o, n, after } }) });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    return res.json();
  };
  return async (repo) => {
    const [o, n] = repo.split("/"); const nodes = []; let categories = [], total = 0, after = null, next = true, pages = 0;
    while (next && pages < maxPages) {
      const j = await page(o, n, after); const r = j.data?.repository; if (!r) throw new Error(j.errors?.[0]?.message || "no data");
      categories = r.discussionCategories.nodes; total = r.discussions.totalCount; nodes.push(...r.discussions.nodes);
      next = r.discussions.pageInfo.hasNextPage; after = r.discussions.pageInfo.endCursor; pages++;
    }
    return { nodes, categories, total, capped: next };
  };
}

// What `nosy publish` sends: only the rivals' public tracker data, cut down to what the Demand tab shows.
export function forCloud(j) {
  const keep = a => ({ kind: a.kind, number: a.number, title: a.title, votes: a.votes, comments: a.comments, openDays: a.openDays, url: a.url,
    possibleArea: a.possibleArea ? { no: a.possibleArea.no, feature: a.possibleArea.feature } : null });
  return { generated: j.generated,
    repos: (j.repos || []).filter(r => r.ok).map(r => ({ repo: r.repo, stars: r.stars ?? null, archived: !!r.archived, ...(r.discussionsNote ? { discussionsNote: r.discussionsNote } : {}), asks: (r.asks || []).map(keep) })),
    alsoAtSeveralRivals: (j.alsoAtSeveralRivals || []).map(g => ({ rivals: g.rivals, votes: g.votes, asks: g.asks })) };
}

export function linesOf(pm) {
  const f = path.join(pm, "matrix.json");
  if (!fs.existsSync(f)) return [];
  try { return (matrixRead(f)?.lines || []).map(l => ({ no: l.no, feature: l.feature })); } catch { return []; }
}

export function reposFor(pm, argRepos) {
  if (argRepos?.length) return { repos: argRepos, from: "--repos" };
  const K = readSources(pm) || {};
  if (Array.isArray(K.rivalRepos) && K.rivalRepos.length) return { repos: K.rivalRepos, from: "sources.json rivalRepos" };
  const dir = path.join(pm, "rivals"); const found = new Set();
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith(".md") && !f.startsWith("_")) for (const r of reposIn(fs.readFileSync(path.join(dir, f), "utf8"))) found.add(r);
  return { repos: [...found], from: "GitHub links in pm/rivals/*.md" };
}

async function main() {
  const argv = process.argv.slice(2);
  const take = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const jsonOut = take("--json"), top = Number(take("--top")) || 8, repoArg = take("--repos");
  const pm = argv[0] || "pm";
  let found; try { found = reposFor(pm, repoArg ? repoArg.split(",").map(s => s.trim()).filter(Boolean) : null); }
  catch (e) { console.error(`Psst… ${sourcesProblem(pm) || `couldn't read ${path.join(pm, "sources.json")} (${String(e.message).split("\n")[0]}).`} Or pass --repos owner/repo,... to skip it.`); process.exit(1); }
  const { repos, from } = found;
  if (!repos.length) { console.log("No rival repos to read. Pass --repos owner/repo,... or add sources.json `rivalRepos`."); process.exit(0); }
  if (repos.length > MAX_REPOS) console.log(`Reading the first ${MAX_REPOS} of ${repos.length} repos.`);
  const getJson = makeGetJson(), getDiscussions = makeGetDiscussions(), lines = linesOf(pm), out = [];
  for (const r of repos.slice(0, MAX_REPOS)) out.push(await askOf(r, getJson, { top, lines, getDiscussions }));
  const result = { generated: new Date().toISOString(), source: from, repos: out, alsoAtSeveralRivals: crossRival(out), sharedTopics: sharedTopics(out),
    note: "Public vote counts (👍 on open issues, upvotes on open Discussions) and titles. Bug reports, announcements, release notes and thank-you threads are left out and counted in `skipped`. Possible matches, alsoAtSeveralRivals and sharedTopics are matched by words: open each ask before saying a rival lacks a feature or that rivals share an ask. An open ask is not proof the feature is missing: read the rival's own files and docs." };
  if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2)); }
  for (const r of out) {
    if (!r.ok) { console.log(`\n${r.repo}: skipped (${r.why})`); continue; }
    const sk = r.skipped ? Object.entries({ "bug reports": r.skipped.bugs, "announcements or thank-yous": r.skipped.announcements + r.skipped.categories }).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ") : "";
    console.log(`\n${r.repo}${r.archived ? " (archived)" : ""}: ${r.asks.length ? "most-voted open asks" : "no open ask has a vote"}${r.discussionsNote ? `  [${r.discussionsNote}]` : ""}${sk ? `  (left out: ${sk})` : ""}`);
    for (const a of r.asks) console.log(`  ${String(a.votes).padStart(3)} 👍  ${a.kind === "discussion" ? `discussion${a.category ? ` [${a.category}]` : ""} ` : ""}#${a.number} ${a.title}  (open ${a.openDays}d)${a.possibleArea ? `  ~ your row: ${a.possibleArea.feature}` : ""}`);
  }
  if (result.alsoAtSeveralRivals.length) {
    console.log("\nLook alike at several rivals (matched by words, so check they are the same ask before quoting):");
    for (const g of result.alsoAtSeveralRivals.slice(0, 5)) console.log(`  ${g.votes} 👍 across ${g.rivals.join(", ")}: ${g.asks[0].title}`);
  }
  if (result.sharedTopics.length) {
    console.log("\nAcronyms that come up at several rivals (a topic to look at, not one ask):");
    for (const g of result.sharedTopics.slice(0, 5)) console.log(`  ${g.word} at ${g.rivals.join(", ")} (${g.votes} 👍 in all)`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("rival-demand.mjs")) main().catch(e => { console.error(e.message); process.exit(1); });
