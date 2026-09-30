// Preread for incoming PRs and issues: links, rules, CI, conflicts, staleness. A summary for the owner only;
// writes nothing to GitHub.
// Not a code review; the ordering puts product questions (links, rules) ahead of CI/conflicts.
// Usage: node preread.mjs <pm folder> [hours=48] [--legaltech] [--fintech] [--mobile] [--b2b-saas] [--diff [--fetch]]
// A package flag adds skill/packs/<package>.md's "Patterns" list to the product's own never rules.
// --diff: tries to confirm a rule-violation suspicion with `gh pr diff`; this usually fails on a 300+ file PR.
//   If --fetch is also given, it fetches the branch to `refs/nosy/pr-N` and finds the line with `git grep`
//   (internal request 24; don't use --fetch on the first product).
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { patternsOfLoad, refRegex, groupKeyOf } from "./refs.mjs";
import { decisionsOfRead } from "./read-decisions.mjs";
import { readSources } from "./sources-file.mjs";
const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "packs");
const argv = process.argv.slice(2);
const diffFlag = argv.includes("--diff"), fetchFlag = argv.includes("--fetch");
const packages = argv.filter(a => a.startsWith("--") && a !== "--diff" && a !== "--fetch").map(a => a.slice(2));
const [pm = "pm", hour = "48"] = argv.filter(a => !a.startsWith("--")), hours = +hour;
const packagePattern = p => { const f = path.join(PACKAGE_DIR, `${p}.md`); if (!fs.existsSync(f)) throw new Error(`no such package: ${p} (${PACKAGE_DIR})`);
  const sec = (fs.readFileSync(f, "utf8").split(/^### Patterns/m)[1] || "").split(/^## /m)[0];
  return [...sec.matchAll(/^- (.+?) :: (.+)$/gm)].map(m => ({ name: `${m[1]} (${p})`, pattern: m[2].trim() })); };
const K = readSources(pm);
const R = K.issue.repo, gh = a => JSON.parse(execFileSync("gh", a, { encoding: "utf8", maxBuffer: 64 << 20 }));
const since = Date.now() - hours * 3600e3, age = d => Math.round((Date.now() - Date.parse(d)) / 864e5);
const refRe = refRegex(patternsOfLoad(K));
const refs = t => [...new Set((t || "").match(refRe) || [])];
const rules = [...(K.preread?.never || []), ...packages.flatMap(packagePattern)].map(r => ({ ...r, re: new RegExp(r.pattern, "i") }));
// read-decisions.mjs: reads a single file, a directory, or a glob, all the same way; the
// pieces are JOINED to keep the old broad scan (every "K180" mention inside K.preread.decisions, not just headings).
const decisions = (() => { try { return decisionsOfRead({ ...K, preread: { ...K.preread, decisions: K.preread?.decisions || "docs/DECISIONS.md" } }).map(k => k.text).join(""); } catch { return ""; } })();
const knownK = new Set(decisions.match(/K\d{2,3}/g) || []);
// Confirms a suspected rule violation from the diff. Tries `gh pr diff` first; on failure
// (a big PR) and if --fetch was given, fetches the branch and finds the line with git grep; without --fetch it
// just leaves a note and doesn't fetch on its own.
const diffEvidenceOf = (n, rule) => {
  try {
    const diff = execFileSync("gh", ["pr", "diff", String(n), "-R", R], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
    const added = diff.split("\n").find(l => /^\+/.test(l) && !/^\+\+\+/.test(l) && rule.re.test(l));
    return added ? `line added in the diff: ${added.slice(1, 120).trim()}` : "diff read, the pattern doesn't show up in added lines (may be in the title/body)";
  } catch {
    if (!fetchFlag) return "couldn't get the diff (the PR may be too big); I can fetch the branch and look with --fetch";
    try {
      execFileSync("git", ["-C", K.repo, "fetch", "origin", `pull/${n}/head:refs/nosy/pr-${n}`], { stdio: ["ignore", "pipe", "pipe"] });
      // `git grep` with no pathspec searches the WHOLE tree at refs/nosy/pr-n, not just
      // the PR's own changes. On a real 300+-file PR that's tens of thousands of files; on a blob:none partial
      // clone (Nosy's own trial setup) each one lazily fetches its blob from origin on demand, one at a time,
      // which is impractically slow (confirmed: minutes, not seconds) and can also "confirm" a rule match that
      // lives in code the PR never touched. Scope the grep to the PR's own changed files instead, fetched from
      // GitHub's paginated Files API (works even though `gh pr diff` failed for being too big, and doesn't
      // depend on a local merge-base - unreliable on a shallow or partial clone).
      const fileList = execFileSync("gh", ["api", `repos/${R}/pulls/${n}/files`, "--paginate", "--jq", ".[].filename"], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
      const changedFiles = fileList.split("\n").map(f => f.trim()).filter(Boolean);
      if (!changedFiles.length) return "branch fetched, but the PR's changed-file list came back empty";
      // git grep exits 1 (not 0) when nothing matches - that's not a failure, it's the normal "no evidence"
      // outcome, so it's told apart from a real error (bad ref, bad pattern) instead of falling into the
      // generic catch below, which used to report "pattern not found" only for a message that was actually
      // unreachable (any real grep failure, including no-match, threw before reaching it).
      // rule.re is a JS RegExp (used above against the title/body/diff text), and this product's own example
      // never-rule already uses a JS/PCRE feature (`\b`). -E (POSIX extended regex) doesn't support `\b` on
      // this git build - it silently never matches, so a rule that correctly raised the suspicion (via
      // rule.re on the title/body) would always come back "not found" here even when the PR genuinely
      // contains it. -P (--perl-regexp) matches rule.re's own dialect much more closely; fall back to -E only
      // if this git wasn't built with PCRE support (fatal error, not "no match" - status 1 is still "no match").
      let grep;
      try {
        grep = execFileSync("git", ["-C", K.repo, "grep", "-n", "-i", "-P", rule.pattern, `refs/nosy/pr-${n}`, "--", ...changedFiles], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      } catch (eg) {
        if (eg.status === 1) return "branch fetched, pattern not found in the PR's own changed files";
        try {
          grep = execFileSync("git", ["-C", K.repo, "grep", "-n", "-i", "-E", rule.pattern, `refs/nosy/pr-${n}`, "--", ...changedFiles], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        } catch (eg2) {
          if (eg2.status === 1) return "branch fetched, pattern not found in the PR's own changed files";
          throw eg2;
        }
      }
      const first = grep.trim().split("\n").filter(Boolean)[0];
      return first ? `branch fetched, found: ${first.replace(/^refs\/nosy\/pr-\d+:/, "")}` : "branch fetched, pattern not found in the PR's own changed files";
    } catch (e2) { return `couldn't fetch the branch, or no pattern: ${String(e2.message).slice(0, 100)}`; }
  }
};

const prs = gh(["pr", "list", "-R", R, "--state", "open", "--limit", "50", "--json", "number,title,author,updatedAt,createdAt,body,files,isDraft,statusCheckRollup,mergeable"]);
const fileOwners = new Map();
for (const p of prs) for (const f of p.files || []) { if (!fileOwners.has(f.path)) fileOwners.set(f.path, []); fileOwners.get(f.path).push(p.number); }
const ci = p => { const r = p.statusCheckRollup || []; if (r.some(c => c.conclusion === "FAILURE")) return "red"; if (r.some(c => !c.conclusion && c.status !== "COMPLETED")) return "running"; return r.length ? "green" : "missing"; };

let o = `# Preread · last ${hours}h · ${new Date().toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}\n\nThis summary is for the owner only. Nothing was written to GitHub. Not a code review; the ordering puts product questions (links, rules) ahead of CI/conflicts.${rules.length ? ` Rules: ${rules.length} patterns (product ${(K.preread?.never || []).length}${packages.length ? `, packages: ${packages.join(", ")}` : ""}).` : ""}${diffFlag ? ` Rule violations are confirmed from the diff (--diff${fetchFlag ? " --fetch" : ""}).` : ""}\n\n## Open PRs (${prs.length})\n\n| PR | Who | Age | Link | Rule | CI | Conflict | Note |\n|---|---|---|---|---|---|---|---|\n`;
const verifications = [];
for (const p of prs.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))) {
  const text = p.title + "\n" + p.body, rs = refs(text);
  const unknownK = rs.filter(r => /^K/.test(r) && !knownK.has(groupKeyOf(r)));
  const overlap = new Map();
  for (const f of p.files || []) for (const n of fileOwners.get(f.path) || []) if (n !== p.number) overlap.set(n, (overlap.get(n) || 0) + 1);
  const broke = rules.filter(r => r.re.test(text) || (p.files || []).some(f => r.re.test(f.path)));
  if (diffFlag) for (const b of broke) verifications.push({ n: p.number, name: b.name, result: diffEvidenceOf(p.number, b) });
  // Product questions first (an unlinked PR, a reference missing from DECISIONS); draft/conflict/staleness are
  // just context.
  const notes = [];
  if (!rs.length) notes.push("not linked to any decision/item");
  if (unknownK.length) notes.push(`missing from DECISIONS: ${unknownK.join(", ")}`);
  if (p.isDraft) notes.push("draft");
  if (p.mergeable === "CONFLICTING") notes.push("conflicts with main");
  if (age(p.updatedAt) >= (K.preread?.stale_day || 5)) notes.push(`stale for ${age(p.updatedAt)} days`);
  const fresh = Date.parse(p.updatedAt) >= since ? "**" : "";
  o += `| ${fresh}#${p.number}${fresh} ${p.title.slice(0, 60).replace(/\|/g, "/")} | ${p.author.login} | ${age(p.createdAt)}d | ${rs.slice(0, 6).join(" ") || "—"} | ${broke.map(b => b.name).join(", ") || "—"} | ${ci(p)} | ${[...overlap].map(([n, c]) => `#${n} (${c} files)`).join(", ") || "—"} | ${notes.join("; ") || "—"} |\n`;
}
if (diffFlag && verifications.length) o += `\n## Rule violation check (--diff)\n\n${verifications.map(d => `- #${d.n} · ${d.name}: ${d.result}`).join("\n")}\n`;
const issues = gh(["issue", "list", "-R", R, "--state", "all", "--limit", "60", "--json", "number,title,author,state,updatedAt,createdAt,body,comments"]).filter(i => Date.parse(i.updatedAt) >= since);
o += `\n## Issues in motion (${issues.length})\n\n| Issue | Who | State | Ours | Link | Last comment |\n|---|---|---|---|---|---|\n`;
const ours = new RegExp(K.issue.our, "i");
for (const i of issues) {
  const last = (i.comments || []).slice(-1)[0];
  o += `| #${i.number} ${i.title.slice(0, 70).replace(/\|/g, "/")} | ${i.author.login} | ${i.state === "OPEN" ? "open" : "wasClosed"} | ${ours.test(i.title) ? "yes" : ""} | ${refs(i.title + " " + i.body).slice(0, 5).join(" ") || "—"} | ${last ? `${last.author.login} ${last.createdAt.slice(5, 16).replace("T", " ")}: ${last.body.replace(/\s+/g, " ").slice(0, 90).replace(/\|/g, "/")}` : "—"} |\n`;
}
const hot = [...fileOwners].filter(([, ns]) => ns.length > 1).sort((a, b) => b[1].length - a[1].length).slice(0, 10);
if (hot.length) o += `\n## Files touched by more than one PR\n\n${hot.map(([f, ns]) => `- \`${f}\`: ${ns.map(n => "#" + n).join(", ")}`).join("\n")}\n`;
process.stdout.write(o);
