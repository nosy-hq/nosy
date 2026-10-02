// local-work: is this psst item already written on a branch that isn't in the integration branch,
// or sitting uncommitted in a working tree? On the first run on a real product 3 of 5 draft items were already done on the owner's own
// local, unpushed branches; nothing joined an item to them. `facts` already lists every unmerged branch with the files merging
// it would change (pm/state/facts/branches.json: squash merges and re-done commits are already left out), so this only matches
// an item's evidence files and refs to that list, and says how far the work got: local only, pushed without a PR, in a PR.
// Structural, no word lists (the language audit): the match is a file path in common, or a reference (K12, §3, #385) in
// the branch's commit subjects. A big branch that merely touches the same file is "weak": said, but not a verdict.
// Everything here is the owner's machine only (branch names, authors and subjects stay in pm/state/receipts.json, which is never
// published; docs/DATA.md).
import { execFileSync } from "node:child_process";
import fs from "node:fs"; import path from "node:path";
import { fileURLToPath } from "node:url";
import { noLazyFetchArgs } from "./facts.mjs";

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")); } catch { return null; } };
const shortName = b => String(b).replace(/^(origin|upstream)\//, "");
const BIG = 40; // a branch touching more files than this is a weak match on a single shared file

// pm/state/facts/branches.json (and github.json for PRs), or null when `facts build` hasn't run.
export function loadLocalWork(pm) {
  const B = readJson(path.join(pm, "state", "facts", "branches.json"));
  if (!B || !Array.isArray(B.branches)) return null;
  const G = readJson(path.join(pm, "state", "facts", "github.json"));
  const prs = new Map();
  for (const x of G?.items || []) if (x.kind === "pr" && x.branch && !prs.has(x.branch)) prs.set(x.branch, { n: x.n, state: x.draft && x.state === "open" ? "draft" : x.merged ? "merged" : x.state });
  return { generated: B.generated, base: B.base, scope: B.scope || null, branches: B.branches, prs, ghRead: !!G };
}

// Names of the branches that exist on a remote, whatever the remote is called ("origin/feat/x" and "fork/feat/x" → "feat/x"; a branch name may
// itself contain slashes or any letters). Reads refs only. A repo with no remote has none pushed, and a repo with no commits has no refs: both give an
// empty set, never an error.
export function pushedNames(repo) {
  const git = (...a) => { try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 }); } catch { return ""; } };
  const remotes = git("remote").split("\n").map(r => r.trim()).filter(Boolean).sort((a, b) => b.length - a.length); // longest first: "a" and "a/b" both remotes
  const out = new Set();
  for (const l of git("for-each-ref", "--format=%(refname)", "refs/remotes").split("\n")) {
    const full = l.trim().replace(/^refs\/remotes\//, ""); if (!full || /\/HEAD$/.test(full)) continue;
    const r = remotes.find(x => full.startsWith(`${x}/`));
    out.add(r ? full.slice(r.length + 1) : shortName(full));
  }
  return out;
}

// Shared files and docs say little: on the first run on a real product a handoff doc every branch edits and a mapper five branches touched made
// five "strong" matches each, and the one branch that really did the item (7 files, 1 commit) was one line among them. So:
//   - a documentation file (.md .mdx .txt .rst) in common is never strong on its own (it describes work, it isn't the work);
//   - a file that 4 or more *focused* branches (BIG files or fewer) touch is a shared file: weak for each of them;
//   - strong first, the most focused branch (fewest files) first; at most 3 strong and 3 weak are listed, `more` counts the rest.
const DOC = /\.(md|mdx|txt|rst)$/i, HOT = 4;
export function matchBranchesDetailed(L, { paths = [], refs = [], refRe = null, pushed = new Set() } = {}) {
  if (!L) return { list: [], more: 0 };
  const want = new Set(paths), wantRefs = new Set(refs);
  const byName = new Map();
  for (const b of L.branches) {
    const name = b.branch ?? shortName(b.name), prev = byName.get(name); // `branch`: facts.mjs strips the remote, whatever it is called
    if (!prev || (b.date || "") > (prev.date || "") || (b.date === prev.date && (b.ahead || 0) > (prev.ahead || 0))) byName.set(name, { ...b, short: name });
  }
  const live = [...byName.values()].filter(b => !b.notLocal && b.filesDiffer);
  // How many focused branches touch each wanted file (a big branch touches everything and says nothing).
  const touched = new Map();
  for (const b of live) if (b.filesDiffer <= BIG) for (const f of b.paths || (b.files || []).map(x => x.file)) if (want.has(f)) touched.set(f, (touched.get(f) || 0) + 1);
  const out = [];
  for (const b of live) {
    const have = b.paths || (b.files || []).map(f => f.file);
    const hit = have.filter(f => want.has(f));
    let said = [];
    if (refRe && wantRefs.size) { for (const s of b.subjects || []) { refRe.lastIndex = 0; for (const r of s.match(refRe) || []) if (wantRefs.has(r)) said.push(r); } said = [...new Set(said)]; }
    if (!hit.length && !said.length) continue;
    const pr = L.prs.get(b.short) || null;
    const isPushed = pushed.has(b.short) || !!b.remote || /^(origin|upstream)\//.test(b.name) || L.branches.some(x => (x.branch ?? shortName(x.name)) === b.short && (x.remote || x.name !== b.short));
    const where = pr ? `${pr.state === "draft" ? "draft " : ""}PR #${pr.n}${pr.state === "closed" ? " (closed, not merged)" : pr.state === "merged" ? " (merged, but this content still differs)" : ""}` : isPushed ? "pushed, no PR" : "local only, not pushed";
    const code = hit.filter(f => !DOC.test(f)), distinct = code.filter(f => (touched.get(f) || 0) < HOT);
    const focused = b.filesDiffer <= BIG;
    const strong = said.length > 0 || (focused && distinct.length > 0) || distinct.length >= 2 && distinct.length === code.length;
    const why = strong ? null : !code.length ? "documentation file only" : !focused ? "a big branch" : "a file many branches touch";
    out.push({ branch: b.short, author: b.author || "", date: b.date || "", ahead: b.ahead, filesDiffer: b.filesDiffer, hit: hit.slice(0, 6), hitCount: hit.length, refs: said,
      strength: strong ? "strong" : "weak", weakBecause: why, state: pr ? `pr-${pr.state}` : isPushed ? "pushed" : "local", where, pr: pr?.n || null });
  }
  const strong = out.filter(x => x.strength === "strong").sort((a, b) => a.filesDiffer - b.filesDiffer || (b.date || "").localeCompare(a.date || ""));
  const weak = out.filter(x => x.strength === "weak").sort((a, b) => a.filesDiffer - b.filesDiffer || (b.date || "").localeCompare(a.date || ""));
  const list = [...strong.slice(0, 3), ...weak.slice(0, 3)];
  return { list, more: out.length - list.length };
}
export const matchBranches = (L, o) => matchBranchesDetailed(L, o).list;

// Uncommitted edits in the checkout or any other worktree that touch the given files. Reads `git status` only: NUL-separated (-z), so a name with
// spaces, quotes or non-ASCII letters is read as it is, not as git's quoted "caf\303\251"; `--no-renames`, so a partial clone is never asked for
// file contents to pair a rename; no lazy fetch. A worktree whose folder is gone (an unplugged drive, a deleted folder) is skipped, not an error.
// The scan is the slow part (one `git status` per worktree: seconds on a big repo), the filter is not: psst checks up to 30 items, so it scans once
// (workingTreeScan) and filters per item (editsIn). workingTreeEdits does both for a caller with one question.
export function workingTreeScan(repo) {
  const noFetch = noLazyFetchArgs(repo), env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1" };
  const git = (dir, ...a) => { try { return execFileSync("git", [...noFetch, "-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20, env }); } catch { return ""; } };
  const trees = []; let cur = null;
  for (const l of git(repo, "worktree", "list", "--porcelain").split("\n")) {
    if (l.startsWith("worktree ")) { cur = { dir: l.slice(9), branch: null }; trees.push(cur); }
    else if (l.startsWith("branch ") && cur) cur.branch = l.slice(7).replace(/^refs\/heads\//, "");
  }
  if (!trees.length) trees.push({ dir: repo, branch: null });
  const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const top = real(git(repo, "rev-parse", "--show-toplevel").trim() || repo);
  return trees.filter(t => fs.existsSync(t.dir)).map(t => ({
    where: real(t.dir) === top ? "the checkout" : `worktree ${path.basename(t.dir)}`, branch: t.branch,
    files: new Set(git(t.dir, "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=normal").split("\0").filter(e => e.length >= 4).map(e => e.slice(3))) }));
}
export function editsIn(scan, paths) {
  const want = new Set(paths); if (!want.size) return [];
  const out = [];
  for (const t of scan) { const hit = [...t.files].filter(f => want.has(f)); if (hit.length) out.push({ where: t.where, branch: t.branch, hit: hit.slice(0, 6) }); }
  return out;
}
export function workingTreeEdits(repo, paths) { return new Set(paths).size ? editsIn(workingTreeScan(repo), paths) : []; }

// The receipt block, in words the agent should repeat to the owner.
export function formatLocal(L, edits = [], more = 0) {
  let o = "";
  const strong = L.filter(x => x.strength === "strong"), weak = L.filter(x => x.strength === "weak");
  for (const x of strong) o += `\n**🔧 Already written locally:** branch \`${x.branch}\`${x.author ? ` by ${x.author}` : ""} (${x.ahead} commit${x.ahead === 1 ? "" : "s"} ahead, last ${x.date}) differs from the integration branch in ${x.hit.length ? `${x.hitCount} of this item's file${x.hitCount === 1 ? "" : "s"} (${x.hit.map(f => `\`${f}\``).join(", ")})` : "no listed file"}${x.refs.length ? `${x.hit.length ? " and" : ","} its commits name ${x.refs.join(", ")}` : ""} · ${x.where}. This isn't new work: say what's left (finish it, open a PR), or quote why it is not the same work.\n`;
  for (const x of weak) o += `\n**Weak match (${x.weakBecause || "shared file"}):** \`${x.branch}\`${x.author ? ` (${x.author})` : ""} changes ${x.filesDiffer} files including ${x.hit.map(f => `\`${f}\``).join(", ")} · ${x.where}. Check whether that is this work before listing the item.\n`;
  if (more > 0 && (strong.length || weak.length)) o += `\n_${more} more branch${more === 1 ? "" : "es"} also touch these files (\`nosy facts\` lists them all)._\n`;
  for (const e of edits) o += `\n**✏️ Uncommitted edits** in ${e.where}${e.branch ? ` (\`${e.branch}\`)` : ""} touch ${e.hit.map(f => `\`${f}\``).join(", ")}: someone is on it right now.\n`;
  return o;
}

// Library, not a CLI: a misdirected `node local-work.mjs ...` would otherwise print nothing and exit 0.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const self = "local-work.mjs";
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const callers = fs.readdirSync(dir).filter(f => f.endsWith(".mjs") && f !== self)
    .filter(f => { try { return new RegExp(`["']\\./${self}["']`).test(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return false; } }).sort();
  console.error(`${self} is a library used by ${callers.join(", ") || "no other tool"}; did you mean \`nosy psst\` (it writes pm/state/receipts.md)?`);
  process.exit(1);
}
