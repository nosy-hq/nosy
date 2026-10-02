// Looks for stale information in hand-written page lines: has a PR the page calls "open"
// merged, has a decision item the page calls "in flight / no code / missing" landed on main.
// Usage: node find-stale.mjs <pm folder> <page.html> [--json <file>] [--day 14]
// Reads: pm/sources.json (repo, ref, issue.repo). Never modifies the page; lists findings by line number.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
import { patternsOfLoad, refRegex } from "./refs.mjs";
import { readSources } from "./sources-file.mjs";
const argv = process.argv.slice(2), opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const jsonOut = opt("--json"), day = +(opt("--day") || 14), [pm = "pm", page] = argv;
if (!page) { console.error("Usage: node find-stale.mjs <pm> <page.html> [--json <file>]"); process.exit(1); }
const K = readSources(pm);
const html = fs.readFileSync(page, "utf8");
// Blanks a span but keeps its newlines, so reported line numbers stay the file's own.
const blank = m => m.replace(/[^\n]/g, " ");
// What is not the page's own prose: code is not a claim about status. On a real page 5 of 7 findings
// were dead symbol definitions inside <script> and sentences that describe a merge. Skipped, by structure (no word lists):
// <script>/<style>/<pre>/<code> content, fenced code blocks (``` or ~~~, closed by the same fence or the end of the file),
// and inline code spans (a backtick run closed by a run of the same length on the same line).
function notProse(text) {
  const t = text.replace(/<(script|style|pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, blank);
  let fence = null;
  return t.split("\n").map(l => {
    const f = l.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) { const close = l.match(/^ {0,3}(`{3,}|~{3,})\s*$/); if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null; return blank(l); }
    if (f) { fence = f[1]; return blank(l); }
    return l.replace(/(`+)(?!`)[^\n]*?[^`\n]\1(?!`)/g, blank);
  }).join("\n");
}
// The auto section is the script's own output; don't scan it.
const clean = notProse(html.replace(/<!-- pm:auto -->[\s\S]*?<!-- \/pm:auto -->/, blank));
const lines = clean.split("\n").map((l, i) => ({ no: i + 1, t: l.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ") }));
const finding = [];

// Turkish-language support (internal request: a Turkish/English-mixed page): a user's own product page may describe
// PR/decision status in Turkish; skill/data/lang/tr/find-stale.json supplies that wording so the matching stays
// data, not code.
const langPath = new URL("../data/lang/tr/find-stale.json", import.meta.url);
const Lang = JSON.parse(fs.readFileSync(langPath, "utf8"));
const groupOf = words => words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['’]")).join("|");

// (1) PRs mentioned on the page in an "open / in review" context
// At each hit, the nearest status word is checked: "in #438" or "open PR" is open, "on main / merged" is closed.
const Open = new RegExp(`${groupOf(Lang.open)}|\\bPR\\b|CI (running|queued)|open PR|in review`, "gi");
const Closed = new RegExp(`${groupOf(Lang.closed)}|\\bmerged\\b|\\bshipped\\b|on main`, "gi");
const prs = new Map();
for (const s of lines) for (const m of s.t.matchAll(/#(\d{2,5})('(?:de|da|te|ta|e|a)\b)?/g)) {
  let open = !!m[2];
  if (!open) { const yakin = (re) => Math.min(...[...s.t.matchAll(re)].map(x => Math.abs(x.index - m.index)), Infinity);
    const a = yakin(Open), k = yakin(Closed); open = a < 70 && a < k; }
  if (!open) continue;
  if (!prs.has(m[1])) prs.set(m[1], []); prs.get(m[1]).push(s.no);
}
for (const [n, numbers] of prs) {
  let p; try { p = JSON.parse(execFileSync("gh", ["pr", "view", n, "-R", K.issue.repo, "--json", "state,mergedAt,closedAt,title"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); } catch { continue; } // an issue, or missing
  if (p.state === "OPEN") continue;
  const ne = p.state === "MERGED" ? `merged (${new Date(p.mergedAt).toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})` : "closed, not merged";
  finding.push({ type: "PR status", ref: `#${n}`, lines: [...new Set(numbers)], not: `#${n} ${ne}; the page says open. ${p.title.slice(0, 70)}` });
}

// (2) Are decision items the page calls "in flight / no code / missing / pending" actually on main
const InFlight = new RegExp(`${groupOf(Lang.inFlight)}|missing`, "i");
const log = execFileSync("git", ["-C", K.repo, "log", "--no-merges", `--since=${day}.days`, "--format=%h\t%ad\t%s", "--date=format:%d.%m %H:%M", K.ref], { encoding: "utf8", maxBuffer: 64 << 20 }).trim().split("\n").map(l => { const [h, d, s] = l.split("\t"); return { h, d, s: (s || "").replace(/\s+/g, " ") }; });
// A docs commit doesn't count as "done"; a code commit is a conventional feat/fix/refactor/perf, or any other "area:" prefix
// (a monorepo's "web:", "api:") that isn't docs/chore/test/ci. Was a hard-coded app prefix of the first product.
const code = c => /^(feat|fix|refactor|perf)\b/.test(c.s) || (/^[\w-]+(\([\w-]+\))?:/.test(c.s) && !/^(docs|chore|tests?|ci|style|build|log)\b/.test(c.s));
const refWide = r => { const m = r.match(/^(K\d+)\s*m\.(\d+)(?:[–-](\d+))?$/); return m ? Array.from({ length: (+(m[3] || m[2]) - +m[2]) + 1 }, (_, i) => `${m[1]} m.${+m[2] + i}`) : [r]; };
// Product-configurable patterns (refs.mjs): besides the first product's K/§, another product's references like WP-306 are also caught.
const refRe2 = refRegex(patternsOfLoad(K));
const seen = new Set();
for (const s of lines) {
  if (!InFlight.test(s.t)) continue;
  for (const m of s.t.matchAll(refRe2)) for (const ref of refWide(m[0].replace(/\s+/g, " "))) {
    // The generic patterns can now also produce bare, dot-less refs like K180, #438, OWNER 48, WP-306 (refs.mjs);
    // the "m." alternate-form attempt only kicks in for refs actually shaped like "K180 m.5".
    const match = log.filter(c => code(c) && (ref.startsWith("§") ? new RegExp(`${ref}(?![\\d])`).test(c.s) : new RegExp(`${ref.replace(" ", "\\s*")}(?![\\d])`).test(c.s) || (ref.includes(" m.") && new RegExp(`${ref.split(" ")[0]} m\\.[\\d,\\s–-]*\\b${ref.split(".")[1]}\\b`).test(c.s))));
    if (!match.length || seen.has(ref + s.no)) continue; seen.add(ref + s.no);
    finding.push({ type: "Said in flight, but on main", ref, lines: [s.no], not: `${match[0].h} ${match[0].d} ${match[0].s.slice(0, 90)}` });
  }
}
// Merge lines for the same ref
const one = new Map(); for (const b of finding) { const k = b.type + b.ref; if (one.has(k)) one.get(k).lines.push(...b.lines); else one.set(k, { ...b }); }
const list = [...one.values()].map(b => ({ ...b, lines: [...new Set(b.lines)].sort((a, c) => a - c) }));
let o = `# Stale-line scan · ${path.basename(page)} · ${K.ref}\n\nThe page was not modified. Line numbers are the HTML file's lines; the auto section, scripts, styles and code (blocks, spans, <code>/<pre>) weren't scanned.\n\n`;
o += list.length ? `| Type | Ref | Line | Evidence |\n|---|---|---|---|\n${list.map(b => `| ${b.type} | ${b.ref} | ${b.lines.slice(0, 12).join(", ")}${b.lines.length > 12 ? " …" : ""} | ${b.not.replace(/\|/g, "/")} |`).join("\n")}\n` : "No lines look stale.\n";
process.stdout.write(o);
if (jsonOut) fs.writeFileSync((fs.mkdirSync(path.dirname(jsonOut), { recursive: true }), jsonOut), JSON.stringify({ type: "stale", generated: new Date().toISOString(), page: path.basename(page), findings: list }, null, 1));
