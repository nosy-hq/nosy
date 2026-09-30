// Builds a decision page (a single HTML file) from the pm/ folder. Look and feel from Nosy's brand kit
// (pm/name/brand-kit.html).
// Usage: node build-page.mjs <pm folder> <output.html>
// Reads: product.md, matrix.json (build-matrix's output: status, the announcement (importance/reason
//       parsed out), including "Position relative to Nosy"), rivals/*.md (site/price/delivery/pattern/weak),
//       summary.md, log.md, decisions.md, state/status.json and state/lowhanging.json (if present, the
//       auto section)
// Size: on a product with a long cycle log, the "Cycle log" section (the whole of
// log.md, rendered) and the matrix's per-cell evidence (embedded for tooltips) are by far the biggest
// blocks — on Nosy's own pm/ they were ~140 KB and ~190 KB of a ~535 KB page. The log section is capped to
// a recent byte budget (older entries stay in pm/log.md, just not inlined) and tooltip evidence is capped
// per cell; nothing else is trimmed since rival cards and the matrix itself are the page's actual content.
// First screen (glance.mjs): the page opens on pictures and numbers, not prose; the summary,
// cycle log and decisions are folded below it.
// A guardrail (thresholds.mjs pageMaxKB, default 300) prints a warning with the biggest blocks if the
// built page is still over it — it never blocks the write.
import fs from "node:fs"; import path from "node:path"; import { section as sectionValue } from "./auto-section.mjs"; import { thresholds } from "./thresholds.mjs";
import { glance, renderGlance, GLANCE_CSS } from "./glance.mjs"; import { next as nextPicks } from "./next.mjs";
import { readSources } from "./sources-file.mjs";
const pm = process.argv[2] || "pm", out = process.argv[3] || "page.html";
const rd = f => { try { return fs.readFileSync(path.join(pm, f), "utf8"); } catch { return ""; } };
const truncate = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
// Keeps the most recent "## " sections of a log up to a byte budget (at least the single latest one), so
// the page doesn't inline the product's entire history; older entries are only dropped from the page, the
// file itself (pm/log.md) is untouched.
function logTail(raw, budgetBytes) {
  const parts = raw.split(/^(?=## )/m);
  if (parts.length <= 1) return { text: raw, omitted: 0 };
  const head = parts[0].replace(/^#[^#].*\n?/, ""); // drop the top-level "# ..." title; the page section already has its own <h2>
  const sections = parts.slice(1);
  let kept = [], size = 0;
  for (let i = sections.length - 1; i >= 0; i--) { kept.unshift(sections[i]); size += Buffer.byteLength(sections[i]); if (size >= budgetBytes) break; }
  return { text: head + kept.join(""), omitted: sections.length - kept.length };
}
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = s => esc(s)
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
  .replace(/~~([^~]+)~~/g, "<s>$1</s>")
  .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
  .replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g, (m, p, u) => `${p}<a href="${u}">${u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48)}</a>`);
function md(src) { // a small markdown subset: headings, lists, numbered lists, paragraphs; no tables
  src = String(src || "").replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*$/gm, ""); // marker lines like <!-- nosy:build-waves --> aren't page text; one quoted in `code` stays
  const lines = src.split("\n"); let h = "", list = null;
  const close = () => { if (list) { h += `</${list}>`; list = null; } };
  for (const l of lines) {
    let m;
    if ((m = l.match(/^(#{2,4})\s+(.*)/))) { close(); h += `<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`; }
    else if ((m = l.match(/^\s*[-*]\s+(.*)/))) { if (list !== "ul") { close(); h += "<ul>"; list = "ul"; } h += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+\.\s+(.*)/))) { if (list !== "ol") { close(); h += "<ol>"; list = "ol"; } h += `<li>${inline(m[1])}</li>`; }
    else if (l.trim() === "" || l.startsWith("# ")) close();
    else { close(); h += `<p>${inline(l)}</p>`; }
  }
  close(); return h;
}
const section = (src, title) => { const m = src.match(new RegExp(`^## ${title}[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m")); return m ? m[1].trim() : ""; };
const field = (src, k) => (src.match(new RegExp(`\\*\\*${k}:\\*\\*\\s*(.+)$`, "m")) || [, ""])[1].trim();

const M = JSON.parse(rd("matrix.json") || "{}");
// No product.md yet (a scripted setup): the repo's own name, from package.json or the folder, never a bare "Product".
const repoName = (() => { try { const K = readSources(pm); const root = path.resolve(path.dirname(path.resolve(pm)), K.repo || "."); try { const n = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name; if (n) return n.replace(/^@[^/]+\//, ""); } catch {} return path.basename(root); } catch { return "Product"; } })();
const product = rd("product.md"), title = field(product, "Page name") || (product.match(/^#\s+(.+)$/m) || [, repoName])[1].replace(/\s*\(.*\)\s*$/, "");
// Only the build-matrix shape (object + file) becomes a rival card; an old line-shape name array, or no
// matrix at all for a new product, shouldn't drop the page.
const rivals = (M.products || []).filter(u => u && typeof u === "object" && u.file).map(u => { const src = rd(path.join("rivals", u.file)); return { ...u,
  site: field(src, "Site"), price: field(src, "Price"), delivery: field(src, "Delivery format"),
  pattern: section(src, "Patterns we will take"), weak: section(src, "Weaknesses / user complaints") }; });
const catOf = c => ((c || "").split(/[|,(]/)[0] || "Other").trim().toLowerCase();
const active = rivals.filter(r => (r.statusType || "active") === "active");
const closedOne = rivals.filter(r => (r.statusType || "active") !== "active");
const cats = [...new Set(active.map(r => catOf(r.category)))];
const auto = sectionValue(pm);
// The first screen: the decision, four numbers, where we stand, the roadmap lanes, what shipped.
const G = (() => { let picks = null; try { picks = nextPicks(pm).picks; } catch {} try { return glance(pm, { M, nextPicks: picks }); } catch (e) { console.error("glance:", e.message); return null; } })();
const stepCount = (M.steps || []).length;
// A roadmap with no task in any wave is a promise with nothing behind it: one line instead of six empty waves.
const wavesEmpty = (() => { try { const W = JSON.parse(fs.readFileSync(path.join(pm, "state", "waves.json"), "utf8")); return !(W.waves || []).some(w => w.tasks?.length) && !(W.owner_decision_of || []).length; } catch { return false; } })();
// Evidence is cited in full in matrix.json/rivals/*.md; the page only needs enough of it for a hover tooltip.
const EVIDENCE_TIP_MAX = 90; // Nosy's own page (44 rivals x 25 steps) hit 428 KB, then 311 KB, most of it tooltips
const bizOf = M.biz ? { ...M.biz, notes: Object.fromEntries(Object.entries(M.biz.notes || {}).map(([k, v]) => [k, truncate(v, EVIDENCE_TIP_MAX)])) } : M.biz;
const data = { steps: M.steps || [], biz: bizOf, products: rivals.map(r => ({ name: r.name, layer: catOf(r.category), status: r.statusType || "active", codes: Object.fromEntries(Object.entries(r.codes || {}).map(([k, v]) => [k, [v.k, truncate(v.evidence, EVIDENCE_TIP_MAX)]])) })) };
// Cap how much of log.md's tail gets inlined into the "Cycle log" section (see logTail above); the rest
// stays in the file. thresholds.mjs's logTailKB (default 40) sets the budget.
const logInfo = logTail(rd("log.md"), thresholds(pm).logTailKB * 1024);

// Rival card: a status badge (acquired/closed), a high-importance latest announcement is surfaced,
// shows "Position relative to Nosy".
// full cards for the 12 rivals that cover the most steps; the rest are one line each, their
// detail stays in pm/rivals/<file>.md (Nosy's own page had 156 KB of cards for 44 rivals).
const FULL_CARDS = 12;
// Category labels come from the rival files in lower case ("ai pm agent"); acronyms read as acronyms ("AI PM agent").
const ACRONYMS = new Set(["ai", "pm", "ci", "ux", "ui", "api", "mcp", "crm", "sdk", "cli", "prd", "okr"]);
const categoryLabel = c => { const w = String(c).split(/(\s+|\/|-)/).map(t => ACRONYMS.has(t.toLowerCase()) ? t.toUpperCase() : t); const s = w.join(""); return s[0].toUpperCase() + s.slice(1); };
const fullCards = new Set([...active].sort((a, b) => Object.values(b.codes || {}).filter(v => v?.k === "y").length - Object.values(a.codes || {}).filter(v => v?.k === "y").length).slice(0, FULL_CARDS).map(r => r.name));
const rivalCard = r => {
  const badge = r.statusType && r.statusType !== "active" ? `<span class="tag closed">${esc(r.status)}</span>` : "";
  // "announced": not usable yet; said plainly on the card so the highlight box
  // doesn't look like "shipped".
  const delivery = r.announcementDelivery === "announced" ? " · not shipped yet" : r.announcementDelivery === "output" ? " · shipped" : "";
  const announcement = !r.announcementText ? "" : r.announcementSeverity === "high"
    ? `<div class="announcement"><div class="lab">Latest announcement · important${delivery}</div><p>${inline(r.announcementText)}</p>${r.announcementReason ? `<p class="reason">${inline(r.announcementReason)}</p>` : ""}</div>`
    : `<div class="meta"><span>Latest${delivery}: ${inline(r.announcementText)}${r.announcementSeverity ? ` · importance: ${esc(r.announcementSeverity)}` : ""}</span></div>`;
  return `<article class="card"><h3>${esc(r.name)}</h3>${badge}
<div class="meta">${r.delivery ? `<span>${inline(r.delivery)}</span>` : ""}${r.price ? `<span>${inline(r.price).slice(0, 400)}</span>` : ""}</div>
${announcement}
${r.location ? `<div><div class="lab">Position relative to us</div>${md(r.location)}</div>` : ""}
${r.pattern ? `<div><div class="lab">What we'll take</div>${md(r.pattern)}</div>` : ""}${r.weak ? `<details><summary>Weaknesses</summary>${md(r.weak)}</details>` : ""}
<div class="meta"><span>File: pm/rivals/${esc(r.file)}</span></div></article>`;
};

const html = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
:root{
  --ground:#DDF1E7; --paper:#FBFAF6; --ink:#1C2541; --muted:#5B6478; --line:#C9E4D8; --soft:#E9F5EE;
  --mag:#D7263D; --mag-soft:#F7E1E6; --sea:#6E4FA3; --sea-soft:#E7E1F3;
  --ok:#1F7A52; --ok-soft:#DCEEE2; --part:#8A6412; --part-soft:#F4EAD2; --gap:#A83A2E;
  --hero-bg:#1C2541; --hero-ink:#F4F6FB; --hero-muted:#AEB8D6; --hero-chip:rgba(255,255,255,.09); --bar-c:#BFD9CB;
  --display:Impact,Haettenschweiler,"Arial Narrow Bold","Arial Narrow",sans-serif; --body:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;
  --ground:#10151F; --paper:#182238; --ink:#EDF1EC; --muted:#9FB0C8; --line:#2B3A4E; --soft:#1D2C42;
  --mag:#FF8FA0; --mag-soft:#3A1B25; --sea:#C9B8EE; --sea-soft:#2C2440;
  --ok:#6BCB98; --ok-soft:#163223; --part:#DDB25E; --part-soft:#372A12; --gap:#EE8A7E;
  --hero-bg:#24304F; --hero-ink:#F4F6FB; --hero-muted:#B4BFDC; --hero-chip:rgba(255,255,255,.09); --bar-c:#33455E;
}}
:root[data-theme="dark"]{color-scheme:dark;
  --ground:#10151F; --paper:#182238; --ink:#EDF1EC; --muted:#9FB0C8; --line:#2B3A4E; --soft:#1D2C42;
  --mag:#FF8FA0; --mag-soft:#3A1B25; --sea:#C9B8EE; --sea-soft:#2C2440;
  --ok:#6BCB98; --ok-soft:#163223; --part:#DDB25E; --part-soft:#372A12; --gap:#EE8A7E;
  --hero-bg:#24304F; --hero-ink:#F4F6FB; --hero-muted:#B4BFDC; --hero-chip:rgba(255,255,255,.09); --bar-c:#33455E;
}
*{box-sizing:border-box}
html{overflow-x:hidden}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.55 var(--body);padding-inline:16px;padding-block:0 72px;overflow-wrap:anywhere}
.wrap{max-width:1160px;margin:0 auto;display:grid;gap:8px}
a{color:var(--sea)} a:focus-visible,button:focus-visible{outline:2px solid var(--mag);outline-offset:2px}
h1,h2,h3{font-family:var(--display);font-weight:400;line-height:1.05;margin:0;text-wrap:balance;letter-spacing:.01em}
h1{font-size:clamp(32px,5.5vw,56px);text-transform:uppercase}
h2{font-size:clamp(22px,3vw,30px);text-transform:uppercase}
h3{font-size:19px} h4,h5{margin:0;font-size:15px}
p{margin:0;max-width:70ch}
.lab{font-family:var(--mono);font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
code{font-family:var(--mono);font-size:.84em;background:var(--soft);padding:1px 5px;border-radius:3px;word-break:break-word}
header{padding-block:44px 18px;display:grid;gap:14px;border-bottom:1px solid var(--line)}
.bearing{font-family:var(--mono);font-size:13px;color:var(--mag);display:flex;gap:18px;flex-wrap:wrap}
.h1row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.mark{flex:none}
.lede{font-size:18px;color:var(--muted);max-width:66ch}
nav{position:sticky;top:env(safe-area-inset-top,0px);z-index:4;background:var(--ground);padding-block:10px;border-bottom:1px solid var(--line);display:flex;gap:6px;flex-wrap:wrap}
nav a{font-family:var(--mono);font-size:12px;text-decoration:none;color:var(--ink);padding:5px 10px;border:1px solid var(--line);border-radius:3px}
nav a:hover{border-color:var(--mag);color:var(--mag)}
section{padding-block:34px 6px;display:grid;gap:16px;scroll-margin-top:56px}
.head{display:grid;gap:6px}.head p{color:var(--muted)}
.prose{display:grid;gap:10px;max-width:78ch}.prose ul,.prose ol{margin:0;padding-left:20px;display:grid;gap:6px}
.prose h3,.prose h4{margin-top:10px}
.scroll{overflow-x:auto;background:var(--paper);border:1px solid var(--line)}
table{border-collapse:collapse;width:100%;font-size:13.5px;font-variant-numeric:tabular-nums}
th,td{padding:7px 9px;border-bottom:1px solid var(--soft);text-align:left;vertical-align:top}
thead th{font-family:var(--mono);font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);background:var(--paper);white-space:nowrap}
.mx th.p{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;height:150px;text-align:left;padding:8px 4px}
.mx td.c{text-align:center;width:34px;padding:6px 2px}
.mx td.s,.mx th.s{position:sticky;left:0;background:var(--paper);min-width:210px;z-index:1}
.mx .me{background:var(--mag-soft)}
.mx tr.cat th{font-family:var(--mono);font-size:10px;color:var(--mag);text-transform:uppercase;letter-spacing:.06em;background:var(--paper);padding:6px 4px 0}
.d{display:inline-grid;place-items:center;width:22px;height:20px;border-radius:3px;font-family:var(--mono);font-size:11px;cursor:help}
.d-y{background:var(--ok-soft);color:var(--ok)}.d-p{background:var(--part-soft);color:var(--part)}.d-n{color:var(--gap)}.d-u{color:var(--muted)}.d-d{color:var(--part)}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:var(--muted)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:12px}.rival-rest{margin:10px 0 0;padding-left:18px;display:grid;gap:6px;font-size:14px}.rival-rest .meta{font-size:12px;opacity:.7}
.card{background:var(--paper);border:1px solid var(--line);padding:16px;display:grid;gap:8px;align-content:start}
.card h3{font-size:18px}
.card .meta{font-family:var(--mono);font-size:11.5px;color:var(--muted);display:grid;gap:2px}
.card ul{margin:0;padding-left:18px;display:grid;gap:4px;font-size:14px}
.card details summary{cursor:pointer;font-size:13px;color:var(--sea)}
.tag{font-family:var(--mono);font-size:11px;padding:2px 6px;border-radius:3px;background:var(--sea-soft);color:var(--sea);justify-self:start}
.announcement{border-left:3px solid var(--mag);background:var(--mag-soft);padding:8px 10px;border-radius:0 3px 3px 0;display:grid;gap:4px}
.announcement .lab{color:var(--mag)}
.announcement p{font-size:13.5px}
.announcement .reason{color:var(--muted);font-size:13px;font-style:italic}
.closed-group{margin-top:8px}
.closed-group>summary{cursor:pointer;font:600 12px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:10px 0}
.closed-group>summary:hover{color:var(--mag)}
.closed-group .cards{margin-top:12px}
.bar{height:8px;background:var(--soft);position:relative}.bar i{position:absolute;inset:0 auto 0 0;background:var(--sea)}
.bar i.me{background:var(--mag)}
.h2h td.n{font-family:var(--mono);white-space:nowrap}
footer{margin-top:36px;padding-top:14px;border-top:1px solid var(--line);font-size:13px;color:var(--muted);display:grid;gap:8px}
${GLANCE_CSS}
.fold>summary{cursor:pointer;list-style:none;display:grid;gap:6px}.fold>summary::-webkit-details-marker{display:none}.fold>summary .open{font-family:var(--mono);font-size:12px;color:var(--sea)}.fold[open]>summary .open{display:none}.fold>.prose{margin-top:14px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
<div class="wrap">
<header>
  <div class="bearing"><span>PSST · ${esc(title.toUpperCase())} · ${esc(M.update || "")}</span><span>${active.length} active rival${active.length === 1 ? "" : "s"}${closedOne.length ? ` · ${closedOne.length} moved/closed` : ""} · ${stepCount} steps</span></div>
  <div class="h1row"><svg class="mark" width="36" height="36" viewBox="0 0 120 120" role="img" aria-label="Nosy"><circle cx="60" cy="60" r="56" fill="#D7263D"/><circle cx="44" cy="54" r="12" fill="#fff"/><circle cx="76" cy="54" r="12" fill="#fff"/><circle cx="49" cy="56" r="5.5" fill="#1C2541"/><circle cx="81" cy="56" r="5.5" fill="#1C2541"/><rect x="18" y="74" width="84" height="7" rx="3" fill="#1C2541"/></svg><h1>${esc(title)}</h1></div>
  <p class="lede">${inline(field(product, "What"))}</p>
</header>
${G ? renderGlance(G, { esc }) : ""}
<nav aria-label="Sections">${rd("summary.md").trim() ? '<a href="#summary">Summary</a>' : ""}${stepCount ? '<a href="#coverage">Coverage</a><a href="#matrix">Matrix</a>' + (active.length ? '<a href="#head-to-head">Head to head</a>' : "") + '<a href="#rivals">Rivals</a>' : '<a href="#coverage">Rivals</a>'}${auto ? '<a href="#auto">Today</a>' : ""}${rd("waves.md") ? '<a href="#waves">Waves</a>' : ""}${logInfo.text.trim() ? '<a href="#log">Cycle log</a>' : ""}${rd("decisions.md").trim() ? '<a href="#decisions">Decisions</a>' : ""}</nav>
${rd("summary.md").trim() ? `<section id="summary"><details class="fold"><summary class="head"><div class="lab">Psst — the tea</div><h2>Summary</h2><span class="open">Read the summary (${rd("summary.md").split(/\s+/).length} words) ↓</span></summary><div class="prose">${md(rd("summary.md"))}</div></details></section>` : ""}
${stepCount ? `<section id="coverage"><div class="head"><div class="lab">Inside first · how much of the loop it covers</div><h2>Coverage</h2><p>For every product, the "exists" count out of ${stepCount} steps, "partial" counts half. "?" counts zero; a product with little info known shows up low.</p></div><div class="scroll"><table id="cov"></table></div></section>
<section id="matrix"><div class="head"><div class="lab">Over the fence · loop matrix</div><h2>${stepCount} steps x ${rivals.length + (M.biz ? 1 : 0)} products</h2><p>Hover a cell for its evidence. Sources are in the rival files.</p></div>
<div class="legend"><span><i class="d d-y">●</i> exists</span><span><i class="d d-p">◐</i> partial</span><span><i class="d d-n">—</i> missing</span><span><i class="d d-u">?</i> not found</span><span><i class="d d-d">◌</i> announced, not shipped</span></div>
<div class="scroll"><table class="mx" id="mx"></table></div></section>
${active.length ? `<section id="head-to-head"><div class="head"><div class="lab">Us vs. the neighbours · head to head</div><h2>Against us</h2><p>We have it, they don't; they have it, we're missing it. Computed from the matrix; an acquired or closed rival doesn't count.</p></div><div class="scroll"><table class="h2h" id="h2h"></table></div></section>` : ""}
${rivals.length ? `<section id="rivals"><div class="head"><div class="lab">The neighbours · rivals</div><h2>What to take, where they're weak</h2></div>
${cats.map(c => { const here = active.filter(r => catOf(r.category) === c), full = here.filter(r => fullCards.has(r.name)), rest = here.filter(r => !fullCards.has(r.name));
  return `<h3>${esc(categoryLabel(c))}</h3>${full.length ? `<div class="cards">${full.map(rivalCard).join("")}</div>` : ""}${rest.length ? `<ul class="rival-rest">${rest.map(r => `<li><b>${esc(r.name)}</b>${r.announcementText ? ` · ${inline(r.announcementText).slice(0, 140)}` : ""} <span class="meta">pm/rivals/${esc(r.file)}</span></li>`).join("")}</ul>` : ""}`; }).join("")}
${closedOne.length ? `<details class="closed-group"><summary>Moved or closed (${closedOne.length}) · not on the block anymore</summary><div class="cards">${closedOne.map(rivalCard).join("")}</div></details>` : ""}
</section>` : `<section id="rivals"><div class="head"><div class="lab">The neighbours · rivals</div><h2>No rivals researched yet</h2><p>The matrix has the product's own rows but no rival columns. Run <code>/nosy:neighbors</code>: it proposes rivals (or takes the ones you name), researches each from public sources and fills their columns; head to head and these cards follow.</p></div></section>`}` : `<section id="coverage"><div class="head"><div class="lab">Over the fence</div><h2>No feature matrix yet</h2><p>The matrix, coverage, head to head and rival cards appear once rivals are researched: run <code>/nosy:neighbors</code> (move-in's first tour does it). Until then this page shows the inside view only.</p></div></section>`}
${auto}
${rd("waves.md") && wavesEmpty ? `<section id="waves"><div class="head"><div class="lab">The scoop · waves</div><h2>No roadmap yet</h2><p>Nothing on psst's list to place in a wave. It fills once psst finds work (or the team's notes, a request doc or a matrix give it something): <code>/nosy:psst</code>, then <code>/nosy:scoop</code>.</p></div></section>` : rd("waves.md") ? `<section id="waves"><div class="head"><div class="lab">The scoop · waves</div><h2>What's next</h2><p>Nosy's own <code>scoop</code>: a wave-by-wave roadmap. The verdict belongs to the owner.</p></div><div class="prose">${md(rd("waves.md").replace(/^# .*\n/, ""))}</div></section>` : ""}
${logInfo.text.trim() ? `<section id="log"><details class="fold"><summary class="head"><div class="lab">Stakeout log · cycle log</div><h2>What each run found</h2><p>One entry per run: what was read, what changed, and where Nosy fell short (a "tool gap").${logInfo.omitted ? ` Showing the most recent entries only — ${logInfo.omitted} earlier one${logInfo.omitted === 1 ? "" : "s"} omitted from the page; the full history is in <code>pm/log.md</code>.` : ""}</p><span class="open">Open the log ↓</span></summary><div class="prose">${md(logInfo.text)}</div></details></section>` : ""}
${rd("decisions.md").trim() ? `<section id="decisions"><details class="fold"><summary class="head"><div class="lab">Final word · the owner's decisions</div><h2>Decisions</h2><span class="open">Open the decisions ↓</span></summary><div class="prose">${md(rd("decisions.md"))}</div></details></section>` : ""}
<footer><p>This page was built with <code>skill/tools/build-page.mjs</code> from the <code>pm/</code> folder. Rival info comes from public sources; unsourced claims are under "Unverified" in the rival files.</p><p>👀 Nosy was here.</p></footer>
</div>
<script>
const D=${JSON.stringify(data).replace(/</g, "\\u003c")};
const SYM={y:"●",p:"◐",n:"—",u:"?",d:"◌"},TIP={y:"exists",p:"partial",n:"missing",u:"not found",d:"announced, not shipped yet"};
const cols=(D.biz?[{name:D.biz.name,me:1,status:"active",codes:Object.fromEntries(Object.entries(D.biz.codes).map(([k,v])=>[k,[v,(D.biz.notes||{})[k]||""]]))}]:[]).concat(D.products);
const cell=(c,no)=>{const [k,ev]=(c.codes[no]||["u",""]);return '<td class="c'+(c.me?" me":"")+'"><span class="d d-'+k+'" title="'+(c.name+": "+TIP[k]+(ev?" · "+ev:"")).replace(/"/g,"&quot;")+'">'+SYM[k]+'</span></td>'};
const statusTag=c=>(c.status&&c.status!=="active")?' <span class="tag">'+c.status+'</span>':'';
let h='<thead><tr><th class="s">Step</th>'+cols.map(c=>'<th class="p'+(c.me?" me":"")+'">'+c.name.replace(/\\s*\\(.*$/,"").slice(0,34)+'</th>').join("")+'</tr><tr class="cat"><th class="s"></th>'+cols.map(c=>'<th class="'+(c.me?"me":"")+'">'+(c.me?"us":c.layer.slice(0,8))+'</th>').join("")+'</tr></thead><tbody>';
for(const a of D.steps) h+='<tr><td class="s">'+a.no+'. '+a.name+'</td>'+cols.map(c=>cell(c,a.no)).join("")+'</tr>';
document.getElementById("mx").innerHTML=h+'</tbody>';
const score=c=>D.steps.reduce((s,a)=>{const k=(c.codes[a.no]||["u"])[0];return s+(k==="y"?1:k==="p"?.5:0)},0);
const ranked=cols.map(c=>({c,s:score(c)})).sort((a,b)=>b.s-a.s);
document.getElementById("cov").innerHTML='<thead><tr><th>Product</th><th>Score</th><th style="width:45%">Coverage</th></tr></thead><tbody>'+ranked.map(({c,s})=>'<tr><td>'+(c.me?"<b>"+c.name+"</b>":c.name)+statusTag(c)+'</td><td>'+s.toFixed(1)+' / '+D.steps.length+'</td><td><div class="bar"><i class="'+(c.me?"me":"")+'" style="width:'+(100*s/D.steps.length)+'%"></i></div></td></tr>').join("")+'</tbody>';
if(D.biz){const me=cols[0];let t='<thead><tr><th>Rival</th><th>We have it, they don\\'t</th><th>They have it, we\\'re missing it</th><th>Our gaps</th></tr></thead><tbody>';
for(const c of D.products.filter(c=>!c.status||c.status==="active")){const lead=D.steps.filter(a=>(me.codes[a.no]||["u"])[0]==="y"&&(c.codes[a.no]||["u"])[0]==="n").length;
const gaps=D.steps.filter(a=>(c.codes[a.no]||["u"])[0]==="y"&&"pn".includes((me.codes[a.no]||["u"])[0]));
t+='<tr><td>'+c.name.replace(/\\s*\\(.*$/,"")+'</td><td class="n">'+lead+'</td><td class="n">'+gaps.length+'</td><td style="font-size:13px;color:var(--muted)">'+(gaps.map(a=>a.name).join(" · ")||"—")+'</td></tr>'}
document.getElementById("h2h").innerHTML=t+'</tbody>'}
</script>`;
fs.writeFileSync(out, html); console.log("written:", out, (html.length / 1024).toFixed(0) + " KB");
// Size guardrail: never blocks the write, just names the biggest blocks so a product
// that's grown large (long history, many rivals) knows where the bytes went.
const pageMaxKB = thresholds(pm).pageMaxKB, bytes = Buffer.byteLength(html);
if (bytes > pageMaxKB * 1024) {
  const blocks = [
    ["matrix script data (tooltips)", Buffer.byteLength(JSON.stringify(data))],
    ["rival cards", Buffer.byteLength(active.filter(r => fullCards.has(r.name)).map(rivalCard).join(""))],
    ["closed/moved rival cards", Buffer.byteLength(closedOne.map(rivalCard).join(""))],
    ["cycle log", Buffer.byteLength(md(logInfo.text))],
    ["decisions", Buffer.byteLength(md(rd("decisions.md")))],
    ["waves", Buffer.byteLength(rd("waves.md") ? md(rd("waves.md")) : "")],
  ].sort((a, b) => b[1] - a[1]);
  console.warn(`warning: ${out} is ${(bytes / 1024).toFixed(0)} KB, over the ${pageMaxKB} KB guardrail (thresholds.mjs pageMaxKB). Biggest blocks:\n${blocks.map(([name, b]) => `  ${(b / 1024).toFixed(0)} KB — ${name}`).join("\n")}`);
}
