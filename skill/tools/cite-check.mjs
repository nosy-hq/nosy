// cite-check: before an answer goes out, does every reference in it hold up?
// An answer that cites `file:line`, quotes words from a file, names a commit, or says "#377 is an issue we
// couldn't find" is only as good as those references. The owner's 20-question test (29 Sep) caught answers
// quoting a sentence that isn't in the file (a translation in quotation marks), a handler file that doesn't
// exist, and a merged PR reported as "couldn't find the issue". This script checks each one mechanically, so
// the agent fixes or drops the line before the owner reads it. It reads; it never edits the answer.
//   file:line       the file exists in the repo (a bare name may match several; any one will do) and has that line
//   "quote" + cite  quoted words next to a citation are in that file near that line: word for word, any
//                   language, case and accents ignored; a translation or paraphrase in quotation marks fails
//   commit          a 7-40 character hex name is a commit in the repo, unless the sentence says it's missing
//   #N  (--gh)      the issue/PR exists in sources.json issue.repo; "issue" vs "PR", open vs closed/merged, and
//                   "couldn't find" are checked against what GitHub says
// Usage: node cite-check.mjs <pm> <answer.md | -> [--repo <path>] [--gh] [--gh-repo owner/name] [--json <file>]
// Exit: 0 every reference holds · 2 at least one doesn't · 1 couldn't read the answer or the repo.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { sourcesProblem } from "./hints.mjs";
import { readSources } from "./sources-file.mjs";

// Case, accents, and dotted/dotless i ignored; punctuation becomes a space. Works for any Latin-script
// language and leaves other scripts as they are.
export const fold = s => String(s).replace(/[İI]/g, "i").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const CITE_RE = /(?<![\w/:.-])((?:[\w@()[\]{}.-]+\/)*[\w@()[\]{}-][\w@()[\]{}.-]*\.[A-Za-z][A-Za-z0-9]{0,5}):(\d{1,6})(?:\s*[-–]\s*(\d{1,6}))?((?:\s*,\s*:?\d{1,6}(?:\s*[-–]\s*\d{1,6})?)*)/g;
const QUOTE_RE = /"([^"\n]{6,240})"|“([^”\n]{6,240})”|«([^»\n]{6,240})»|„([^“”\n]{6,240})[“”]|`([^`\n]{6,240})`/g;
const SHA_RE = /(?<![\w/#.-])([0-9a-f]{7,12}|[0-9a-f]{40})(?![\w/-]|\.\w)/g;
const REF_RE = /(?<![\w&/])#(\d{1,6})\b/g;
// Words that say "this is missing / couldn't be found" in the answer's own sentence (EN + TR; the answer is
// written in the owner's language). Checked in the clause around a reference, not the whole answer.
// Two strengths: "couldn't find" anywhere in the clause, but a bare "missing"/"yok" only right after the
// reference ("ea9556d9c isn't in the repo", "#377 yok"), not "#394 is queued but has no design yet".
// Matched against folded text, where "couldn't" reads "couldn t".
const NOT_FOUND_RE = /\b(not found|(couldn ?t|could not|can ?t|cannot) find|no such|(doesn ?t|does not) exist|(isn ?t|is not|not) in (the |this )?repo\w*|bulunamad\w*|bulamad\w*|mevcut degil|bilinmeyen)\b/;
const MISSING_NEXT_RE = /^\W{0,3}(\S+\s+){0,2}(yok|missing|absent|unknown)\b/;
const saysAbsent = (before, after) => NOT_FOUND_RE.test(before) || NOT_FOUND_RE.test(after) || MISSING_NEXT_RE.test(after);
const SAYS_ISSUE_RE = /\b(issue\w*|konu)\b/, SAYS_PR_RE = /\b(pr|pull request|cekme istegi)\b/;
const REPORTED_RE = /\b(diyor|dedi|gosteriyor|gozukuyor|gorunuyor|isaretli|yaziyor|yazili|tutuyor|sayiyor|says|said|shows|lists|listed|marks|marked|claims|still has|treats)\b/;
const SAYS_OPEN_RE = /\b(open|acik|still open|hala acik)\b/, SAYS_DONE_RE = /\b(closed|merged|kapandi|kapali|kapatildi|birlesti|birlestirildi)\b/;

// The words right around a match: back to the previous separator and forward to the next one (, ; . ( ) or
// a line break), at most 40 characters each way. "ea9556d9c isn't in the repo" says the commit is missing;
// "(8bbb8d3f5, ac168ccd8), no prompt code yet" doesn't.
function around(line, start, end) {
  const before = line.slice(Math.max(0, start - 40), start), after = line.slice(end, end + 40);
  const b = before.split(/[,;.()[\]]\s|[;()[\]]/).pop(), a = after.split(/[,;()[\]]|\.(\s|$)/)[0];
  return { before: b, after: a };
}

const isPathLike = s => /^[\w@./()[\]{}-]+\.[A-Za-z]{1,6}(:\d+([-–]\d+)?(,\s*\d+)*)?$/.test(s.trim()) || /^(git|gh|node|npm|npx|cd|ls|grep|curl)\s/.test(s.trim());

// A quote belongs to a citation only when the answer ties them together: `file:12 "words"` (the citation
// right before, nothing but a colon or a verb like "says" in between), or `"words" (… file:12 …)` (the
// citation inside the parenthesis that opens right after the quote). Anything looser is someone else's
// words: the site, the owner, a document named without a line.
function owner(q, cites, line) {
  for (const c of cites) {
    if (c.end <= q.start) {
      const gap = line.slice(c.end, q.start);
      if (gap.length <= 14 && !/[)(;,]|\.\s/.test(gap)) return { cite: c, shared: false };
    }
  }
  const rest = line.slice(q.end), open = rest.match(/^\s{0,2}\(/);
  if (open) {
    let depth = 0, close = -1;
    for (let i = open[0].length - 1; i < rest.length; i++) { if (rest[i] === "(") depth++; else if (rest[i] === ")" && --depth === 0) { close = i; break; } }
    const lo = q.end + open[0].length, hi = close < 0 ? line.length : q.end + close;
    const inside = cites.filter(c => c.start >= lo && c.end <= hi);
    // "(#378's comment; client-page.tsx:5-7)": the words may come from the other source, so a miss is a note.
    return inside.length ? { cite: inside[0], shared: inside.length > 1 || /#\d/.test(line.slice(lo, hi)) } : null;
  }
  return null;
}

// Everything in the answer that can be checked, with where it sits.
export function extract(text) {
  const cites = [], quotes = [], shas = [], refs = [];
  text.split("\n").forEach((line, li) => {
    // Links are not citations: blank the URLs out, keeping the line length so positions still line up.
    const bare = line.replace(/\bhttps?:\/\/\S+/g, m => " ".repeat(m.length));
    const lineCites = [];
    for (const m of bare.matchAll(CITE_RE)) {
      let file = m[1], start = m.index;
      // "(dto.go:150" : the parenthesis is the answer's, not part of the path ("(home)/page.tsx" keeps its own).
      while (/^[([{]/.test(file) && !/^\([^)/]*\)\//.test(file) && !/^\[[^\]/]*\]\//.test(file)) { file = file.slice(1); start++; }
      const extra = (m[4] || "").split(",").map(s => s.replace(/[:\s]/g, "")).filter(Boolean);
      const lines = [[+m[2], +(m[3] || m[2])], ...extra.map(e => { const [a, b] = e.split(/[-–]/).map(Number); return [a, b || a]; })];
      const c = { at: li + 1, file, lines, start, end: m.index + m[0].length }; cites.push(c); lineCites.push(c);
    }
    for (const m of line.matchAll(QUOTE_RE)) {
      const q = m[1] || m[2] || m[3] || m[4] || m[5], code = !!m[5];
      // Code spans are checked only when they're a phrase: one identifier or a path says nothing checkable.
      if (code && (isPathLike(q) || !/\s/.test(q.trim()) || /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s/.test(q.trim()))) continue;
      // Real quotes don't start or end with a space or a separator; that's two quotes' ends paired up.
      if (fold(q).length < 6 || /^[\s;,.:)]|\s$/.test(q)) continue;
      const quote = { at: li + 1, text: q, code, start: m.index, end: m.index + m[0].length };
      const o = owner(quote, lineCites, line);
      if (o) { quote.cite = o.cite; quote.shared = o.shared; }
      if (quote.cite) { (quote.cite.quotes ||= []).push(quote); quotes.push(quote); }
    }
    for (const m of bare.matchAll(SHA_RE)) {
      const s = m[1];
      if (!/[a-f]/.test(s) || !/\d/.test(s)) continue;
      // "not in cd04bad24", "cd04bad24'te yok": the commit is where something is missing, not what's missing.
      if (/^['’`]?(t|d)[ea]\b/.test(line.slice(m.index + s.length).replace(/^`/, "")) || /\b(in|at|from|on)\W{0,2}$/.test(line.slice(0, m.index))) { shas.push({ at: li + 1, sha: s, place: true }); continue; }
      const w = around(line, m.index, m.index + s.length);
      const thisCommit = /\b(this commit|that commit|bu commit|o commit)\b[^.;]{0,50}\b(yok|missing|not in)\b/.test(fold(line));
      shas.push({ at: li + 1, sha: s, saysAbsent: saysAbsent(fold(w.before), fold(w.after)) || thisCommit });
    }
    const lineRefs = [];
    for (const m of bare.matchAll(REF_RE)) {
      const w = around(line, m.index, m.index + m[0].length), b = fold(w.before), a = fold(w.after);
      lineRefs.push({ at: li + 1, n: +m[1], start: m.index, end: m.index + m[0].length, b, a });
    }
    // "#435, #441 and #393 are open": the words after the last one in a list speak for the whole list.
    for (let i = lineRefs.length - 2; i >= 0; i--) {
      const gap = line.slice(lineRefs[i].end, lineRefs[i + 1].start);
      if (/^\s*(,|ve|and|&|\/)\s*$/.test(gap)) lineRefs[i].a = lineRefs[i + 1].a;
    }
    for (const r of lineRefs) {
      const both = `${r.b} ${r.a}`;
      refs.push({ at: r.at, n: r.n, saysIssue: SAYS_ISSUE_RE.test(both), saysPR: SAYS_PR_RE.test(both), saysAbsent: saysAbsent(r.b, r.a),
        // "the matrix still lists #438 as open": someone else's words, not the answer's claim about #438.
        saysOpen: SAYS_OPEN_RE.test(r.a) && !SAYS_DONE_RE.test(r.a) && !REPORTED_RE.test(both), saysDone: SAYS_DONE_RE.test(r.a) && !SAYS_OPEN_RE.test(r.a) && !REPORTED_RE.test(both) });
    }
  });
  return { cites, quotes, shas, refs };
}

// The repo's tracked files, looked up by full path and by name.
export function repoIndex(repo) {
  const files = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 << 20 }).split("\0").filter(Boolean);
  const byName = new Map();
  for (const f of files) { const b = f.slice(f.lastIndexOf("/") + 1); (byName.get(b) || byName.set(b, []).get(b)).push(f); }
  return { repo, files: new Set(files), byName };
}

function candidatesOf(idx, p) {
  const clean = p.replace(/^\.\//, "").replace(/^\/+/, "");
  if (idx.files.has(clean)) return { found: [clean] };
  const base = clean.slice(clean.lastIndexOf("/") + 1), same = idx.byName.get(base) || [];
  const found = same.filter(f => f.endsWith("/" + clean));
  if (found.length) return { found };
  return { found: [], sameName: same, hasDir: clean.includes("/") };
}

const linesCache = new Map();
function linesOf(repo, f) {
  const k = repo + "\0" + f;
  if (!linesCache.has(k)) { let t = null; try { t = fs.readFileSync(path.resolve(repo, f), "utf8"); } catch {} linesCache.set(k, t === null ? null : t.split("\n")); }
  return linesCache.get(k);
}

// Is the quote in the file near the cited lines (6 lines either side), elsewhere in the file, or nowhere?
// Word for word, but forgiving about what an answer naturally trims: case, accents, punctuation, a suffix
// ("gerektiriyor" for "gerektiriyorlar"), and a placeholder letter, and a short aside dropped from the middle ("Ekipler: şimdi yok"
// for "Ekipler (sahip, 13 Eyl: "şimdi yok")"). The words must still come in the same order, close together;
// a translation or a paraphrase doesn't pass. "…" or "..." inside a quote is allowed anywhere.
export function quoteWhere(fileLines, from, to, quote) {
  // A lone capital letter is a placeholder ("N rules · M off"), not a word to find.
  const words = fold(quote.replace(/…|\.\.\./g, " ").replace(/(^|[^\p{L}])\p{Lu}(?=$|[^\p{L}])/gu, "$1 ")).split(" ").filter(Boolean);
  if (!words.length) return "near";
  const budget = fold(quote).length * 2 + 40;
  const has = text => {
    const t = " " + fold(text) + " ";
    for (let s = t.indexOf(" " + words[0]); s >= 0; s = t.indexOf(" " + words[0], s + 1)) {
      let i = s + 1, ok = true;
      for (const w of words) { const j = t.indexOf(" " + w, i - 1); if (j < 0 || j - s > budget) { ok = false; break; } i = j + 1 + w.length; }
      if (ok) return true;
    }
    return false;
  };
  const lo = Math.max(0, from - 7), hi = Math.min(fileLines.length, to + 6);
  if (has(fileLines.slice(lo, hi).join(" "))) return "near";
  if (has(fileLines.join(" "))) return "elsewhere";
  return "nowhere";
}

// Absolute paths in sources.json (any depth) that exist, as folders to search, plus the pm/ folder.
export function outsideRootsOf(K, pm) {
  const roots = new Set(pm ? [path.resolve(pm)] : []);
  const visit = v => { if (typeof v === "string") { if (path.isAbsolute(v) && fs.existsSync(v)) { const st = fs.statSync(v); roots.add(st.isDirectory() ? v : path.dirname(v)); } } else if (v && typeof v === "object") Object.values(v).forEach(visit); };
  visit(K); if (K?.repo) roots.delete(path.resolve(K.repo));
  return [...roots];
}

// Files outside the repo that the product's own setup points to (sources.json's matrix, rivals folder, the pm/
// folder itself): an answer citing `matris.json:604` from the owner's rival matrix is citing a real file, and
// flagging it made an agent drop the line numbers. A few levels deep, capped, no node_modules/.git.
export function outsideIndex(roots = []) {
  const files = [], seen = new Set();
  const walk = (dir, depth) => {
    if (files.length > 20000 || depth > 3) return;
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1); else if (e.isFile() && !seen.has(p)) { seen.add(p); files.push(p); }
    }
  };
  for (const r of roots) { try { const st = fs.statSync(r); if (st.isDirectory()) walk(r, 0); else if (st.isFile() && !seen.has(r)) { seen.add(r); files.push(r); } } catch {} }
  return files;
}
function outsideCandidates(outside, file) {
  if (!outside?.length) return [];
  if (path.isAbsolute(file)) return outside.includes(file) || fs.existsSync(file) ? [file] : [];
  const clean = file.replace(/^\.\//, "");
  return outside.filter(f => f === clean || f.endsWith("/" + clean));
}

function checkCites(idx, cites, outside = []) {
  const problems = [], notes = [];
  for (const c of cites) {
    const k = candidatesOf(idx, c.file), loc = `${c.file}:${c.lines.map(([a, b]) => a === b ? a : `${a}-${b}`).join(",")}`;
    if (!k.found.length) { const o = outsideCandidates(outside, c.file); if (o.length) k.found = o; }
    if (!k.found.length) {
      if (k.sameName?.length) problems.push({ kind: "path", at: c.at, ref: loc, why: `no ${c.file} in the repo; files with that name: ${k.sameName.slice(0, 3).join(", ")}${k.sameName.length > 3 ? ", …" : ""}` });
      else if (k.hasDir) notes.push({ kind: "outside", at: c.at, ref: loc, why: "not in this repo: say which repo or folder it's from" });
      else problems.push({ kind: "file", at: c.at, ref: loc, why: `no file named ${c.file} anywhere in the repo` });
      continue;
    }
    const fitting = k.found.filter(f => { const L = linesOf(idx.repo, f); return L && c.lines.every(([, b]) => b <= L.length); });
    if (!fitting.length) {
      const L = linesOf(idx.repo, k.found[0]);
      problems.push({ kind: "line", at: c.at, ref: loc, why: `${k.found[0]} has ${L ? L.length - (L[L.length - 1] === "" ? 1 : 0) : "?"} lines` });
      continue;
    }
    for (const q of c.quotes || []) {
      const verdicts = fitting.map(f => quoteWhere(linesOf(idx.repo, f), c.lines[0][0], c.lines[c.lines.length - 1][1], q.text));
      const shown = `${loc} ${q.code ? "`" : "\""}${q.text.length > 70 ? q.text.slice(0, 67) + "…" : q.text}${q.code ? "`" : "\""}`;
      if (verdicts.includes("near")) continue;
      if (verdicts.includes("elsewhere") && !q.shared) problems.push({ kind: "quote-line", at: c.at, ref: shown, why: `the words are in ${fitting[verdicts.indexOf("elsewhere")]}, but not near that line: fix the line number` });
      else if (q.shared) notes.push({ kind: "quote-shared", at: c.at, ref: shown, why: "not in the file; if it's from the other source in that parenthesis, fine, otherwise quote the file word for word" });
      else problems.push({ kind: "quote", at: c.at, ref: shown, why: `these words aren't in ${fitting.length === 1 ? fitting[0] : `any of the ${fitting.length} files named ${c.file}`}: quote the file word for word, or drop the quotation marks and say it's a paraphrase` });
    }
  }
  return { problems, notes };
}

function checkShas(repo, shas) {
  const problems = [], uniq = [...new Map(shas.map(s => [s.sha, s])).values()];
  if (!uniq.length) return { problems, checked: 0 };
  let out = "";
  try { out = execFileSync("git", ["-C", repo, "cat-file", "--batch-check"], { input: uniq.map(s => `${s.sha}^{commit}`).join("\n") + "\n", encoding: "utf8" }); } catch { return { problems, checked: 0 }; }
  const res = out.trim().split("\n");
  uniq.forEach((s, i) => {
    const missing = / missing$/.test(res[i] || "") || !res[i];
    const all = shas.filter(x => x.sha === s.sha);
    if (missing && !all.some(x => x.saysAbsent)) problems.push({ kind: "commit", at: s.at, ref: s.sha, why: "no such commit in the repo" });
    if (!missing) for (const x of all) if (x.saysAbsent && !x.place) problems.push({ kind: "commit", at: x.at, ref: s.sha, why: "the answer says it's missing, but the commit is in the repo" });
  });
  return { problems, checked: uniq.length };
}

// GitHub's view of #N: { kind: "pr"|"issue", state, merged } or null when it doesn't exist; throws when gh can't run.
export function ghLookup(ghRepo) {
  const cache = new Map();
  return n => {
    if (cache.has(n)) return cache.get(n);
    let v;
    try {
      const j = JSON.parse(execFileSync("gh", ["api", `repos/${ghRepo}/issues/${n}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
      v = { kind: j.pull_request ? "pr" : "issue", state: j.state, merged: !!j.pull_request?.merged_at, date: (j.pull_request?.merged_at || j.closed_at || j.created_at || "").slice(0, 10), title: j.title };
    } catch (e) {
      if (/HTTP 404|Not Found/.test(String(e.stderr || e.message))) v = null;
      else throw new Error(String(e.stderr || e.message).trim().split("\n")[0]);
    }
    cache.set(n, v); return v;
  };
}

export function checkRefs(refs, lookup, ghRepo) {
  const problems = [], seen = new Set();
  for (const r of refs) {
    const key = `${r.n}:${r.at}`; if (seen.has(key)) continue; seen.add(key);
    const v = lookup(r.n), name = v ? (v.kind === "pr" ? `a pull request, ${v.merged ? `merged ${v.date}` : v.state === "open" ? "open" : `closed unmerged ${v.date}`}` : `an issue, ${v.state === "open" ? "open" : `closed ${v.date}`}`) : "";
    const say = why => problems.push({ kind: "ref", at: r.at, ref: `#${r.n}`, why });
    if (!v) { if (!r.saysAbsent) say(`there's no #${r.n} in ${ghRepo}`); continue; }
    if (r.saysAbsent) { say(`it exists: ${name} ("${v.title}")`); continue; }
    if (r.saysIssue && !r.saysPR && v.kind === "pr") { say(`it's ${name}, not an issue`); continue; }
    if (r.saysPR && !r.saysIssue && v.kind === "issue") { say(`it's ${name}, not a pull request`); continue; }
    if (r.saysOpen && v.state !== "open") say(`the answer says open; it's ${name}`);
    else if (r.saysDone && v.state === "open") say(`the answer says closed/merged; it's ${name}`);
  }
  return { problems, checked: new Set(refs.map(r => r.n)).size };
}

export function check(text, { repo, lookup = null, ghRepo = "", outside = [] } = {}) {
  const X = extract(text), idx = repoIndex(repo);
  const C = checkCites(idx, X.cites, outside), S = checkShas(repo, X.shas);
  let R = { problems: [], checked: 0 }, refNote = null;
  if (lookup) { try { R = checkRefs(X.refs, lookup, ghRepo); } catch (e) { refNote = `#refs not checked: gh failed (${e.message})`; } }
  else if (X.refs.length) refNote = `${new Set(X.refs.map(r => r.n)).size} #refs not checked (add --gh)`;
  const problems = [...C.problems, ...S.problems, ...R.problems].sort((a, b) => a.at - b.at);
  return { problems, notes: C.notes, refNote, counts: { cites: X.cites.length, quotes: X.cites.reduce((n, c) => n + (c.quotes?.length || 0), 0), commits: S.checked, refs: R.checked } };
}

export function render(R, { name = "the answer" } = {}) {
  const { cites, quotes, commits, refs } = R.counts, total = cites + quotes + commits + refs;
  const tally = `Checked ${cites} file:line · ${quotes} quote${quotes === 1 ? "" : "s"} · ${commits} commit${commits === 1 ? "" : "s"} · ${refs} #ref${refs === 1 ? "" : "s"}.`;
  const lines = [];
  if (R.problems.length) {
    lines.push(`Psst… ${R.problems.length} reference${R.problems.length === 1 ? "" : "s"} in ${name} ${R.problems.length === 1 ? "doesn't" : "don't"} hold up:`);
    for (const p of R.problems) lines.push(`- line ${p.at}: ${p.ref}: ${p.why}`);
    lines.push("", "Fix each one or drop it before the answer goes out.");
  } else lines.push(total ? `Every reference in ${name} holds up.` : `No file:line, quote, commit, or #ref in ${name} to check.`);
  for (const n of R.notes) lines.push(`- note, line ${n.at}: ${n.ref}: ${n.why}`);
  if (R.refNote) lines.push(`- note: ${R.refNote}`);
  lines.push(tally);
  return lines.join("\n");
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const flag = k => { const i = argv.indexOf(k); if (i >= 0) argv.splice(i, 1); return i >= 0; };
  const jsonOut = take("--json"), repoArg = take("--repo"), ghRepoArg = take("--gh-repo"), gh = flag("--gh") || !!ghRepoArg;
  const [pm = "pm", file] = argv;
  let K = {}; try { K = readSources(pm); } catch { if (!repoArg) { console.error(`Psst… ${sourcesProblem(pm) || `Couldn't read ${path.join(pm, "sources.json")}`} (or pass --repo <folder> to check against a repo without pm/).`); process.exit(1); } }
  const repo = repoArg || K.repo || ".", ghRepo = ghRepoArg || K.issue?.repo || "";
  if (!file) { console.error("Usage: node cite-check.mjs <pm> <answer.md | -> [--repo <path>] [--gh]"); process.exit(1); }
  let text; try { text = fs.readFileSync(file === "-" ? 0 : file, "utf8"); } catch { console.error(`Couldn't read ${file}.`); process.exit(1); }
  if (gh && !ghRepo) { console.error("--gh needs sources.json `issue.repo` or `--gh-repo owner/name`: add one, or drop --gh to check only files, quotes and commits."); process.exit(1); }
  let R; try { R = check(text, { repo, lookup: gh ? ghLookup(ghRepo) : null, ghRepo, outside: outsideIndex(outsideRootsOf(K, repoArg && !Object.keys(K).length ? null : pm)) }); } catch (e) { console.error(`Couldn't read the repo at ${repo}: ${String(e.stderr || e.message).trim().split("\n")[0]}`); process.exit(1); }
  if (jsonOut) { fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify({ type: "cite-check", generated: new Date().toISOString(), file, ...R }, null, 1)); }
  console.log(render(R, { name: file === "-" ? "the answer" : path.basename(file) }));
  process.exitCode = R.problems.length ? 2 : 0;
}
