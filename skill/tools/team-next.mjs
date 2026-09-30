// team-next: the team's own "what's next" notes as a psst signal. In blind test v7 (the first product,
// 18 Sep) plain Claude took all five picks from the team's working notes (docs/NEXT.md) and 4-5 of them shipped
// within 10 days; Nosy never read that file. The notes predict what ships better than any signal Nosy computes.
// Usage: node team-next.mjs <pm folder> [--json <file>] [--day 14]
// Structural only (the language audit: the notes can be in any language, one real product's are Turkish prose):
//   which file  sources.json `next.path` (string or list), else the two markdown files that score highest on
//               (commits in the last N days, at least 5) × (paragraphs citing a path that really exists in the repo, at least 5:
//               the first product's notes had 16-20, a spec page like Nosy's docs/CLI-CONTRACT.md 3).
//               Working notes cite the code; user docs, which also change often, cite names that aren't repo paths
//               (on Twenty the most-edited doc was a user-facing .mdx page). Decision log, request doc, READMEs,
//               changelogs and licences are left out. `found` says it was picked automatically: move-in confirms.
//   which items the paragraphs and list items of that file that cite the code (`path/file.ext`, file.ext:line, a
//               backticked commit hash) and were last edited within N days of the ref's own date (git blame), newest
//               first; struck-through or ticked ones (~~…~~, [x]) are done and skipped
// "Today" is the ref's commit date, never the machine clock, so a backtest on an old commit sees only its own past.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { patternsOfLoad, refRegex } from "./refs.mjs";
import { sourcesProblem } from "./hints.mjs";
import { readSourcesSafe } from "./sources-file.mjs";

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };
// Conventional file names for guides and specs (like README): read by people installing or agents executing, not the team's notes.
const SKIP_NAME = /(^|\/)(readme|changelog|changes|history|license|licence|contributing|code_of_conduct|security|install|setup|usage|getting[-_]started|faq|upgrading|migration|agents|claude|gemini|copilot-instructions)[^/]*\.mdx?$/i;
// Agent instruction folders (a skill's commands/ and agents/ specs, .claude/, .cursor/) are specs, not notes: on Nosy's own repo
// they won the "most edited" count.
const SKIP_DIR = /(^|\/)(node_modules|vendor|\.yarn|dist|build|\.github|\.claude|\.cursor|commands|agents|prompts|templates)\//;
const CITE = /`[^`\n]*[\w-]+\/[\w./-]+`|`[\w.-]+\.[a-z]{1,5}(:\d+)?`|\b[\w./-]+\.[a-z]{1,5}:\d+|`[0-9a-f]{7,12}`/;

// The team's working notes, found by structure (find-sources proposes them, teamNext falls back on them).
export function findNextDocs(repo, ref = "HEAD", { day = 14, own = [] } = {}) {
  const git = (...a) => { try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
  const refTime = +git("log", "-1", "--format=%ct", ref).trim() * 1000 || Date.now();
  const since = new Date(refTime - day * 864e5).toISOString(), mine = new Set(own.filter(Boolean)), counts = new Map();
  const ownDirs = own.filter(o => o && o.endsWith("/")); // Nosy's own pm/ folder: its output, not the team's notes
  for (const f of git("log", `--since=${since}`, "--name-only", "--format=", ref, "--", "*.md", "*.mdx").split("\n").map(x => x.trim()).filter(Boolean))
    if (!mine.has(f) && !ownDirs.some(d => f.startsWith(d)) && !SKIP_NAME.test(f) && !SKIP_DIR.test(f)) counts.set(f, (counts.get(f) || 0) + 1);
  // A docs site's pages open with frontmatter (---\ntitle: …); working notes don't.
  for (const f of [...counts.keys()]) if (/^---\s*\n[\s\S]*?\n---/.test(git("show", `${ref}:${f}`).slice(0, 2000))) counts.delete(f);
  const tracked = new Set(git("ls-tree", "-r", "--name-only", ref).split("\n").filter(Boolean)), trackedList = [...tracked];
  const real = p => { const q = p.replace(/^[`(./]+/, ""); return tracked.has(q) || trackedList.some(t => t.endsWith("/" + q)); };
  const realCites = f => git("show", `${ref}:${f}`).split(/\n\s*\n/).filter(para => (para.match(/[\w@~.-]*\/[\w@~./-]+\.[a-z]{1,5}/g) || []).some(real)).length;
  const scored = [...counts].filter(([, c]) => c >= 5).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f, c]) => [f, c, realCites(f)]).filter(x => x[2] >= 5).sort((a, b) => b[1] * b[2] - a[1] * a[2]);
  return { files: scored.slice(0, 2).map(x => x[0]), candidates: scored.map(([file, commits, cites]) => ({ file, commits, cites })),
    found: scored.length ? `auto (confirm with the owner): ${scored.slice(0, 2).map(([f, c, r]) => `${f} edited in ${c} commits, ${r} paragraphs cite the code`).join("; ")}` : "none" };
}

export function teamNext(pm, { day = 14 } = {}) {
  const K = readSourcesSafe(pm);
  if (!K) return null;
  const repo = K.repo || ".", ref = K.ref || "HEAD";
  const git = (...a) => { try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
  const refTime = +git("log", "-1", "--format=%ct", ref).trim() * 1000 || Date.now();
  const since = new Date(refTime - day * 864e5).toISOString();
  let files = [].concat(K.next?.path || []), found = "sources.json";
  if (!files.length) {
    const pmRel = path.relative(path.resolve(repo), path.resolve(pm));
    const F = findNextDocs(repo, ref, { day, own: [K.preread?.decisions, K.request?.path, pmRel && !pmRel.startsWith("..") ? pmRel.replace(/\/?$/, "/") : null] });
    if (!F.files.length) return { type: "teamNext", generated: new Date().toISOString(), ref, files: [], found: "none", items: [], note: `no working notes found (a markdown file edited in 5+ commits in the ${day} days before ${ref} that cites the code); set sources.json → next.path if the team keeps a next-up doc` };
    files = F.files; found = F.found;
  }

  const refRe = refRegex(patternsOfLoad(K));
  const items = [], datedBy = {};
  for (const file of files) {
    const text = git("show", `${ref}:${file}`); if (!text) continue;
    const lines = text.replace(/\n$/, "").split("\n"); // blame counts lines without the final newline
    // Last-edit time per line (git blame at the ref), to keep only what the team touched lately.
    const when = []; let cur = null;
    for (const l of git("blame", "--line-porcelain", ref, "--", file).split("\n")) {
      if (/^[0-9a-f]{40} /.test(l)) cur = { t: 0 };
      else if (l.startsWith("author-time ")) cur.t = +l.slice(12) * 1000;
      else if (l.startsWith("\t")) when.push(cur.t);
    }
    // Blame needs the file's whole history; a shallow or partial clone can't give it. Then every line gets the file's
    // own last-commit time (coarser, never silent: `dated` says which).
    let dated = "per line (git blame)";
    if (when.length !== lines.length) { const t = +git("log", "-1", "--format=%ct", ref, "--", file).trim() * 1000 || 0; when.length = 0; lines.forEach(() => when.push(t)); dated = "per file (blame unavailable in this clone)"; }
    datedBy[file] = dated;
    // `next.pattern` (a regex, first group the title): only lines of that shape are items, whatever their age; for a
    // backlog kept as a numbered list (Nosy's own pm/log.md: open "  57. …" lines, done ones struck through).
    if (K.next?.pattern) {
      let re; try { re = new RegExp(K.next.pattern); } catch { continue; }
      lines.forEach((l, i) => { const m = l.match(re); if (!m) return; const body = l.trim();
        refRe.lastIndex = 0;
        items.push({ file, line: i + 1, title: (m[2] || m[1] || body).replace(/[`*]/g, "").slice(0, 110).trim(), date: new Date(when[i] || 0).toISOString().slice(0, 10), time: when[i] || 0, cited: [], refs: [...new Set(body.match(refRe) || [])].slice(0, 4), text: body.slice(0, 600) }); });
      continue;
    }
    // Blocks: paragraphs and list items; headings and code fences separate them.
    let block = [], start = 0, fence = false;
    const flush = () => {
      if (!block.length) return;
      const body = block.join(" ").replace(/\s+/g, " ").trim(), at = start + 1, last = Math.max(...block.map((_, i) => when[start + i] || 0));
      block = [];
      if (!CITE.test(body) || /^\s*(~~|[-*]\s*\[x\]|\d+[.)]\s*~~)/i.test(body) || last < refTime - day * 864e5) return;
      const bold = body.match(/\*\*([^*]{4,160})\*\*/)?.[1];
      const title = (bold || body.replace(/^[-*\d.)\s]+/, "").split(/(?<=[.!?:])\s/)[0]).replace(/[`*]/g, "").slice(0, 110).trim();
      const cited = [...new Set((body.match(/[\w@~.-]*\/[\w@~./-]+\.[a-z]{1,5}(?::\d+)?|\b[\w.-]+\.(?:go|ts|tsx|js|mjs|py|rb|rs|java|kt|swift|sql|yaml|yml|json)(?::\d+)?/g) || []).map(p => p.replace(/^[`(]|[`),.;]$/g, "")))].slice(0, 6);
      refRe.lastIndex = 0;
      items.push({ file, line: at, title, date: new Date(last).toISOString().slice(0, 10), time: last, cited, refs: [...new Set(body.match(refRe) || [])].slice(0, 4), text: body.slice(0, 600) });
    };
    lines.forEach((l, i) => {
      if (/^\s*```/.test(l)) { flush(); fence = !fence; return; }
      if (fence) return;
      const listItem = /^\s*([-*+]|\d+[.)])\s/.test(l);
      const tableRow = /^\s*\|/.test(l); // tables are status grids, not next steps
      if (!l.trim() || /^#{1,6}\s/.test(l) || tableRow || (listItem && block.length)) flush();
      if (!l.trim() || /^#{1,6}\s/.test(l) || tableRow) return;
      if (!block.length) start = i;
      block.push(l);
    });
    flush();
  }
  items.sort((a, b) => b.time - a.time);
  return { type: "teamNext", generated: new Date().toISOString(), ref, files, found, dated: datedBy, items: items.slice(0, 12).map(({ time, ...x }) => x) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const jsonOut = take("--json"), dayArg = take("--day"), R = teamNext(argv[0] || "pm", { day: dayArg ? +dayArg : 14 });
  if (!R) { console.error(`Psst… ${sourcesProblem(argv[0] || "pm") || "no pm/sources.json: run `nosy setup .` first"}`); process.exit(1); }
  console.log(`# The team's own next list · ${R.files.join(", ") || "(none)"} (${R.found})\n`);
  for (const it of R.items) console.log(`- **${it.title}** · ${it.file}:${it.line} · ${it.date}${it.refs.length ? ` · ${it.refs.join(", ")}` : ""}`);
  if (R.note) console.log(R.note);
  if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(R, null, 1)); }
}
