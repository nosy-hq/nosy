// never-check: does a change about to ship add something the product's owner put on the never list?
// Reads the ADDED lines of a diff and matches them against sources.json `preread.never` (the owner's own regex
// patterns: pattern-only, so a product in any language works). The same rules `overheard --diff` checks on open
// PRs, but at the moment the work is made: before a commit (staged changes) or before a PR (the branch against
// the integration branch). It reports; it never blocks. The Claude Code hook (hooks/never-check.mjs) runs it.
// Usage: node never-check.mjs <pm> [--staged | --worktree | --last-commit | --base <ref>] [--all-files] [--json <file>]
//   --staged (default)  what `git commit` would record          --worktree  staged + unstaged (for `git commit -a`)
//   --last-commit       the commit just made (HEAD against its parent; the hook runs after `git commit`)
//   --base <ref>        the branch since it left <ref> (default: the integration branch from sources.json)
//   --all-files         also check docs (*.md, *.txt) and pm/: skipped by default, since a decision log that
//                       says "we won't do X" matches "X" without breaking the rule.
// Exit: 0 nothing matched · 2 a never rule matched · 1 couldn't read sources.json or the diff.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { advice, sourcesProblem } from "./hints.mjs";
import { readSources } from "./sources-file.mjs";

// The rules that can be used, and the ones that can't, with why. A rule with a broken regex, or written as a plain word instead of {name, pattern}, was dropped without a
// word, and the check then said "No never rules": a rule the owner wrote was silently not enforced (field-test hunt). A plain string is read as a literal word; an unusable
// rule is reported.
export function rulesAndProblems(K) {
  const raw = K?.preread?.never, list = Array.isArray(raw) ? raw : raw == null ? [] : [raw], rules = [], invalid = [];
  list.forEach((r, i) => {
    const obj = typeof r === "string" ? { name: r, pattern: r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") } : r;
    const name = String(obj?.name || obj?.pattern || `rule ${i + 1}`);
    if (!obj || typeof obj !== "object" || typeof obj.pattern !== "string" || !obj.pattern) { invalid.push({ name, why: "no `pattern` (a rule is { \"name\": \"…\", \"pattern\": \"<regex>\" })" }); return; }
    try { rules.push({ name: obj.name || obj.pattern, pattern: obj.pattern, re: new RegExp(obj.pattern, "i") }); } catch (e) { invalid.push({ name, why: `the pattern isn't a valid regular expression (${String(e.message).replace(/^Invalid regular expression: /, "")})` }); }
  });
  return { rules, invalid };
}
export const rulesOf = K => rulesAndProblems(K).rules;

// Unified diff (-U0) → added lines with their file and new line number.
export function addedLines(diff) {
  const out = []; let file = null, n = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) { file = line === "+++ /dev/null" ? null : line.replace(/^\+\+\+ (b\/)?/, ""); continue; }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/); if (h) { n = +h[1]; continue; }
    if (!file || line.startsWith("---")) continue;
    if (line.startsWith("+")) out.push({ file, line: n++, text: line.slice(1) });
    else if (!line.startsWith("-") && !line.startsWith("\\")) n++;
  }
  return out;
}

const isDocOrPm = f => /\.(md|mdx|txt|rst|adoc)$/i.test(f) || /^pm\//.test(f);

// An added line that NEGATES a rule is not adding it: a comment ("// we deliberately do not use Stripe here") or a test that asserts the dependency is absent (`not.toContain`,
// `without`, `no longer`). A comment that merely mentions the thing, and every code or config line, count as before.
const negatedAround = (text, re) => { const m = re.exec(text); if (!m) return false; const before = text.slice(Math.max(0, m.index - 40), m.index); return /\b(?:not|never|no longer|without|n't|isn't|absent|forbid\w*|reject\w*)\W+(?:\w+\W+){0,3}$/i.test(before) || /\.\s*not\.\s*to/i.test(before) || /\bnot\.toContain\b|\bnot\.to\w+/.test(text.slice(0, m.index + m[0].length + 20)); };
export function check(K, diff, { allFiles = false } = {}) {
  const { rules, invalid } = rulesAndProblems(K), hits = [];
  for (const a of addedLines(diff)) {
    if (!allFiles && isDocOrPm(a.file)) continue;
    for (const r of rules) if (r.re.test(a.text) && !negatedAround(a.text, new RegExp(r.re.source, "i"))) hits.push({ rule: r.name, file: a.file, line: a.line, text: a.text.trim().slice(0, 160) });
  }
  return { rules: rules.length, hits, invalid };
}

export function diffOf(repo, { mode = "staged", base = null } = {}) {
  const git = a => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "pipe"] });
  if (mode === "last-commit") return git(["show", "--format=", "-U0", "--no-color", "--no-ext-diff", "HEAD"]);
  if (mode === "worktree") return git(["diff", "HEAD", "-U0", "--no-color", "--no-ext-diff"]);
  if (mode === "base") { const mb = git(["merge-base", base, "HEAD"]).trim(); return git(["diff", `${mb}..HEAD`, "-U0", "--no-color", "--no-ext-diff"]); }
  return git(["diff", "--cached", "-U0", "--no-color", "--no-ext-diff"]);
}

export function render(R, { what = "the staged changes" } = {}) {
  if (!R.rules) return "";
  if (!R.hits.length) return "";
  const byRule = new Map(); for (const h of R.hits) (byRule.get(h.rule) || byRule.set(h.rule, []).get(h.rule)).push(h);
  // "the commit … adds", "the changes … add": one commit is singular, a set of changes plural.
  const lines = [`Psst… ${what} ${/^the commit\b/.test(what) ? "adds" : "add"} something on this product's never list:`];
  for (const [rule, hs] of byRule) { lines.push(`- **${rule}**`); for (const h of hs.slice(0, 3)) lines.push(`  - ${h.file}:${h.line}  ${h.text}`); if (hs.length > 3) lines.push(`  - … ${hs.length - 3} more`); }
  lines.push("", "The owner decided against this (sources.json preread.never). Check with them before this ships; if the rule is out of date, the owner changes it, not the change.");
  return lines.join("\n");
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const flag = k => { const i = argv.indexOf(k); if (i >= 0) argv.splice(i, 1); return i >= 0; };
  const jsonOut = take("--json"), base = take("--base"), worktree = flag("--worktree"), lastCommit = flag("--last-commit"), allFiles = flag("--all-files"); flag("--staged");
  const pm = argv[0] || "pm";
  let K; try { K = readSources(pm); } catch { console.error(`Psst… ${sourcesProblem(pm) || `Couldn't read ${path.join(pm, "sources.json")}.`}`); process.exit(1); }
  const repo = K.repo || ".", mode = base !== null ? "base" : lastCommit ? "last-commit" : worktree ? "worktree" : "staged";
  const ref = base || K.integrationBranch || K.ref || "main";
  let diff; try { diff = diffOf(repo, { mode, base: ref }); } catch (e) { console.error(`Couldn't read the diff: ${String(e.stderr || e.message).trim().split("\n")[0]}\n${advice(`${e.stderr || ""}\n${e.message}`) || "Run it inside the product's git repo, after at least one commit (`--last-commit` needs one; the default reads staged changes)."}`); process.exit(1); }
  const R = check(K, diff, { allFiles });
  if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify({ type: "never-check", generated: new Date().toISOString(), mode, base: mode === "base" ? ref : null, ...R }, null, 1)); }
  const what = mode === "base" ? `the branch's changes since ${ref}` : mode === "last-commit" ? "the last commit's changes" : mode === "worktree" ? "the changes" : "the staged changes";
  if (R.invalid.length) console.error(`Psst… ${R.invalid.length} never rule${R.invalid.length === 1 ? " is" : "s are"} not being enforced: ${R.invalid.map(x => `"${x.name}": ${x.why}`).join("; ")}. Fix it in sources.json (preread.never).`);
  console.log(!R.rules ? (R.invalid.length ? "No usable never rule: nothing was checked." : "No never rules in sources.json (preread.never): nothing to check.") : R.hits.length ? render(R, { what }) : `No never rule matched in ${what} (${R.rules} rule${R.rules === 1 ? "" : "s"}).`);
  process.exitCode = R.hits.length ? 2 : R.invalid.length ? 1 : 0;
}
