#!/usr/bin/env node
// Continuous rival monitoring, model-free (matrix step 3): fetches each rival's public pages (landing, changelog,
// release notes, pricing), keeps a text snapshot in pm/history/watch/, and says which rivals changed since the
// last run and what the new sentences are. `neighbors` then re-researches only the rivals that moved, instead of
// every rival every week. Rival patterns: Visualping's change alerts, Crayon/Klue's "surfaces changes to your
// inbox" (pm/rivals/visualping.md, crayon.md, klue.md).
// Usage: node watch-rivals.mjs <pm> [--json <file>] [--only <slug,...>] [--max-pages N] [--timeout <ms>]
// Pages: from sources.json `watch: { "<slug>": ["<url>", ...] }` if given, then the rival registry (`rivals`: site,
// releases, news, blog), otherwise picked from the rival file's
// "## Sources" (site root, changelog/release notes/what's new, pricing, GitHub releases/README), at most --max-pages
// (default 4) per rival. Public pages only, plain GET, no login, no paid scraper. Nothing is written outside pm/.
// Noise: a page is compared as a set of normalized sentences; numbers are masked (counters and dates move every
// day) except on pricing pages, scripts/styles/nav are dropped, so only added/removed prose (or a price) counts.
// A JavaScript-built page (empty HTML shell) falls back to the prose strings in its same-origin script bundles.
// No configurable `research` tool here (see sources.json/verify-setup.mjs): this script has
// only one fetch backend, plain `fetch()` against a public GET, by design (model-free, no login, no paid
// scraper, ever) - the `research` key is for the agent-driven research in `neighbors`/`nosy-neighbor`, which
// reads pages with judgment attached; this script never does.
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
import { readSources } from "./sources-file.mjs";

const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const jsonOut = opt("--json"), only = (opt("--only") || "").split(",").filter(Boolean);
const maxPages = +(opt("--max-pages") || 4), timeout = +(opt("--timeout") || 15000);
const [pm = "pm"] = argv;
const rivalDir = path.join(pm, "rivals"), historyDir = path.join(pm, "history", "watch");
if (!fs.existsSync(rivalDir)) { console.error(`Psst… no ${rivalDir}/ yet: run /nosy:neighbors first (it writes one file per rival).`); process.exit(1); }
let K = {}; try { K = readSources(pm); } catch {}
const today = new Date().toISOString();

// --- which pages to watch ---
const Priority = [/changelog|release-?notes|releases|what-?s-?new|updates/i, /pricing|plans/i, /github\.com\/[^/]+\/[^/]+\/?(#.*)?$/i];
function pagesOf(md, max = 4) {
  const src = (md.match(/^## Sources[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m) || [])[1] || "";
  const top = md.slice(0, 1500);
  // API and raw links are how an agent read a repo, not pages a person sees: map them to the repo page.
  const human = u => u.replace(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/?#]+).*$/, "https://github.com/$1/$2")
    .replace(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/.*$/, "https://github.com/$1/$2");
  const urls = [...new Set([...(src + "\n" + top).matchAll(/https?:\/\/[^\s)>\]"'`,]+/g)].map(m => human(m[0].replace(/[.;:]+$/, ""))))]
    .filter(u => !/^https?:\/\/api\.github\.com\b/.test(u));
  if (!urls.length) return [];
  const host = u => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return ""; } };
  // The rival's own host is the most common host among its sources (press and forums are single mentions).
  const count = new Map(); for (const u of urls) count.set(host(u), (count.get(host(u)) || 0) + 1);
  const own = [...count].sort((a, b) => b[1] - a[1])[0][0];
  const mine = urls.filter(u => host(u) === own);
  const picked = [];
  const add = u => { if (u && !picked.includes(u) && picked.length < max) picked.push(u); };
  if (own !== "github.com") { try { add(new URL(mine[0]).origin + "/"); } catch {} }
  for (const re of Priority) for (const u of mine) if (re.test(u)) add(u);
  if (own === "github.com") { const repo = (mine.map(u => u.match(/^https:\/\/github\.com\/[^/]+\/[^/#?]+/)).find(Boolean) || [])[0];
    if (repo) { add(repo); add(repo + "/releases"); } }
  return picked;
}

// The rival registry (sources.json `rivals`, shared with rival-sweep.mjs): the site, then release notes, news, blog.
function registryPages(R) {
  if (!R) return null;
  const urls = [...new Set([R.site, ...[].concat(R.releases || [], R.news || [], R.blog || [], R.pricing || [])].filter(Boolean))].slice(0, maxPages);
  return urls.length ? urls : null;
}

// --- page text → normalized sentences ---
function sentencesOf(html) {
  const text = String(html)
    .replace(/<(script|style|noscript|svg|template|nav|footer|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr|td|br|dt|dd|blockquote)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&rsquo;/g, "'");
  const out = new Set();
  for (const block of text.split(/\n+/)) for (const s of block.split(/(?<=[.!?])\s+/)) {
    const t = s.replace(/\s+/g, " ").trim();
    if (t.length < 25 || !/\p{L}{3,}.*\s.*\p{L}{3,}/u.test(t)) continue;
    out.add(t.slice(0, 300));
  }
  return [...out];
}
// A JavaScript-built page (Vite/React shell) has an empty HTML body, but its copy is compiled into its scripts. When the
// HTML has no readable text, read up to 3 same-origin scripts it names (<= 2 MB each) and take their prose-looking string
// literals as the page's sentences. Same rules as a hosted service's watcher would use (proseStrings/bundleSentences).
const MAX_BUNDLES = 3, MAX_BUNDLE = 2_000_000, MAX_SIG = 1500;
const LITERAL = /"((?:[^"\\\n]|\\.){25,300})"|'((?:[^'\\\n]|\\.){25,300})'|`((?:[^`\\]|\\.){25,300})`/g;
// Framework and runtime error messages are in every bundle; they move with a library upgrade, not with the product.
const LIBRARY = /\b(React|ReactDOM|useState|useEffect|useContext|useRef|props|prototype|constructor|undefined|Symbol|Minified|Invariant|TypeError|Uncaught|hydrat\w*|DOM|iterator|is not|must be|should be|Expected)\b/;
const LIBRARY_PARTS = /children|innerHTML|InnerHTML|minified|full message/;
// Lists of words that all start lowercase, with no stopword (DOM event names, attribute names), aren't copy.
const WORD_LIST = /^[A-Za-z ]+$/, STOPWORD = /\b(the|and|for|your|with|you|our|to|of|in|is|are|a)\b/;
function proseStrings(js) {
  const out = new Set();
  for (const m of js.matchAll(LITERAL)) {
    const t = (m[1] ?? m[2] ?? m[3] ?? "")
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\[nrt]/g, " ").replace(/\\(["'`])/g, "$1").replace(/\s+/g, " ").trim();
    const w = t.split(" ");
    if (w.length < 4 || /[{}=<>\\;]|=>|\bfunction\b|\bvar\b|\bconst\b/.test(t) || LIBRARY.test(t) || LIBRARY_PARTS.test(t) || (WORD_LIST.test(t) && w.every(x => /^[a-z]/.test(x)) && !STOPWORD.test(t))) continue;
    if (w.filter(x => /[-:[\]/]/.test(x)).length / w.length > 0.4) continue;
    if (!/^[\p{L}\p{N} ,.'’!?:()&%$/+–—-]+$/u.test(t)) continue;
    out.add(t.slice(0, 300));
  }
  return [...out];
}
async function bundleSentences(pageUrl, html) {
  const base = new URL(pageUrl);
  const srcs = [...String(html).matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].flatMap(m => {
    try { const u = new URL(m[1], base); return u.origin === base.origin && /\.m?js$/i.test(u.pathname) ? [u.href] : []; } catch { return []; }
  });
  const out = new Set();
  for (const src of [...new Set(srcs)].slice(0, MAX_BUNDLES)) {
    const f = await fetchText(src); // an unreadable script just adds nothing
    if (f.text) for (const t of proseStrings(f.text.slice(0, MAX_BUNDLE))) out.add(t);
  }
  return [...out].slice(0, MAX_SIG);
}
// Pricing pages keep their numbers: a price move is exactly what we want to see there.
const PricingUrl = /pricing|plans/i;
const normFor = url => PricingUrl.test(url) ? s => s.toLowerCase().replace(/\s+/g, " ") : s => s.toLowerCase().replace(/\d+([.,:]\d+)*/g, "#").replace(/\s+/g, " ");

async function fetchText(url) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": "Nosy watch-rivals (public pages only)", accept: "text/html,text/plain,*/*" } });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return { text: await r.text() };
  } catch (e) { return { error: e.name === "AbortError" ? `timeout ${timeout} ms` : String(e.message || e) }; }
  finally { clearTimeout(timer); }
}

// --- run ---
const rivals = fs.readdirSync(rivalDir).filter(f => f.endsWith(".md") && !f.startsWith("_"))
  .map(f => ({ slug: f.replace(/\.md$/, ""), md: fs.readFileSync(path.join(rivalDir, f), "utf8") }))
  .filter(r => !only.length || only.includes(r.slug))
  .map(r => ({ ...r, name: (r.md.match(/^# (.+)$/m) || [, r.slug])[1].trim(), pages: (K.watch?.[r.slug]) || registryPages(K.rivals?.[r.slug]) || pagesOf(r.md, maxPages) }));

fs.mkdirSync(historyDir, { recursive: true });
const queue = rivals.flatMap(r => r.pages.map(url => ({ r, url })));
const fetched = new Map();
await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
  while (queue.length) { const { url } = queue.shift(); fetched.set(url, await fetchText(url)); }
}));

const results = [];
for (const r of rivals) {
  const snapPath = path.join(historyDir, `${r.slug}.json`);
  let snap = {}; try { snap = JSON.parse(fs.readFileSync(snapPath, "utf8")); } catch {}
  const pages = [];
  for (const url of r.pages) {
    const f = fetched.get(url) || { error: "not fetched" };
    if (f.error) { pages.push({ url, status: "error", error: f.error }); continue; }
    let now = sentencesOf(f.text);
    if (!now.length) now = await bundleSentences(url, f.text);
    const prev = snap[url], norm = normFor(url);
    const hash = crypto.createHash("sha1").update(now.map(norm).sort().join("\n")).digest("hex").slice(0, 12);
    if (!now.length) { pages.push({ url, status: "error", error: "no readable text (rendered by JavaScript?)" }); continue; }
    if (!prev) { pages.push({ url, status: "baseline", sentences: now.length }); snap[url] = { fetched: today, hash, sentences: now }; continue; }
    if (prev.hash === hash) { pages.push({ url, status: "same", since: prev.fetched }); continue; }
    const before = new Set(prev.sentences.map(norm)), after = new Set(now.map(norm));
    const added = now.filter(s => !before.has(norm(s))), removed = prev.sentences.filter(s => !after.has(norm(s)));
    pages.push({ url, status: added.length || removed.length ? "changed" : "same", since: prev.fetched, added: added.slice(0, 8), added_count: added.length, removed_count: removed.length });
    snap[url] = { fetched: today, hash, sentences: now };
  }
  fs.writeFileSync(snapPath, JSON.stringify(snap, null, 1));
  const changed = pages.some(p => p.status === "changed");
  const state = changed ? "changed" : pages.every(p => p.status === "error") ? (pages.length ? "unreachable" : "no pages") : pages.some(p => p.status === "baseline") && !pages.some(p => p.status === "same") ? "baseline" : "same";
  results.push({ slug: r.slug, name: r.name, state, pages });
}

const by = s => results.filter(x => x.state === s);
let o = `# Rival watch · ${today.slice(0, 10)} · ${results.length} rivals, ${by("changed").length} changed, ${by("same").length} unchanged, ${by("baseline").length} first snapshot, ${by("unreachable").length + by("no pages").length} not read\n\n`;
o += `Public pages only, compared with the last snapshot in ${historyDir}/ (numbers masked outside pricing pages, so counters and dates don't count). Changed rivals are what \`neighbors\` should research this round; judgment (shipped vs announced, matrix cells) stays with the agent.\n\n`;
if (by("changed").length) {
  o += `## Changed\n\n`;
  for (const x of by("changed")) {
    o += `### ${x.name} (\`${x.slug}\`)\n`;
    for (const p of x.pages.filter(p => p.status === "changed")) {
      o += `- ${p.url} · +${p.added_count} / −${p.removed_count} sentences since ${String(p.since).slice(0, 10)}\n`;
      for (const s of p.added.slice(0, 4)) o += `  - "${s.replace(/"/g, "'")}"\n`;
    }
    o += `\n`;
  }
}
const list = (title, arr, fn) => { if (arr.length) o += `## ${title}\n\n${arr.map(fn).join("\n")}\n\n`; };
list("First snapshot (compared from the next run on)", by("baseline"), x => `- ${x.name}: ${x.pages.filter(p => p.status === "baseline").length} page(s)`);
list("Not read", [...by("unreachable"), ...by("no pages")], x => `- ${x.name}: ${x.pages.length ? x.pages.map(p => `${p.url} (${p.error})`).join(", ") : `no public URL in ## Sources; add sources.json watch.${x.slug}`}`);
if (by("same").length) o += `Unchanged: ${by("same").map(x => x.name).join(", ")}.\n`;
process.stdout.write(o);
// Exit 2 when no rival's pages could be read at all (offline, blocked): a watch that read nothing is not an all-clear, and `weekly` marked it ✓ (field-test hunt).
process.exitCode = results.length && results.some(x => x.state === "unreachable") && results.every(x => x.state === "unreachable" || x.state === "no pages") ? 2 : 0; // nothing at all could be read (offline, blocked): not an all-clear. One rival that is down is named in the output and is not the whole run; "no pages" is a setup gap the output already names
if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify({ type: "watch", generated: today, rivals: results }, null, 1)); }
