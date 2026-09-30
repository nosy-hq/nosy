// Detects a repo's "integration branch": some projects merge day-to-day work into a branch that
// isn't the default one (e.g. Hoppscotch merges to `next`, Plane to `preview`) and only promote to
// the default branch on release. Picking the default branch there under-counts recent delivery.
// Heuristic: the branch with the most merged PRs in a recent window wins over the default branch
//. An explicit `integrationBranch` in sources.json always wins over detection.
// Offline / no `gh` / gh failure / no merged PRs in the window: falls back to the default branch,
// never throws.
// Used by: collect-status.mjs, shipped-record.mjs.
import { execFileSync } from "node:child_process";
import fs from "node:fs"; import path from "node:path";
import { fileURLToPath } from "node:url";

// opts: { ghRepo: "owner/name" (K.issue.repo), defaultBranch: fallback branch name (no "origin/" prefix),
//         days: window size (default 90), explicit: K.integrationBranch if set }
// Returns { branch, reason }. `branch` never has an "origin/" prefix.
export function integrationBranchOf({ ghRepo, defaultBranch, days = 90, explicit } = {}) {
  if (explicit) return { branch: explicit, reason: "sources.json's integrationBranch setting" };
  const fallback = { branch: defaultBranch, reason: defaultBranch ? "default branch" : "no default branch given" };
  if (!ghRepo || !defaultBranch) return fallback;
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  let prs;
  try {
    prs = JSON.parse(execFileSync("gh", ["pr", "list", "-R", ghRepo, "--state", "merged",
      "--search", `merged:>=${since}`, "--limit", "300", "--json", "baseRefName,mergedAt"],
      { encoding: "utf8", maxBuffer: 64 << 20 }));
  } catch { return { ...fallback, reason: `${fallback.reason} (gh unavailable or failed)` }; }
  const counts = new Map();
  for (const p of prs || []) {
    if (!p.mergedAt || Date.parse(p.mergedAt) < Date.parse(since)) continue;
    counts.set(p.baseRefName, (counts.get(p.baseRefName) || 0) + 1);
  }
  if (!counts.size) return { ...fallback, reason: `${fallback.reason} (no merged PRs in the last ${days}d)` };
  let best = null;
  for (const [branch, n] of counts) if (!best || n > best.n) best = { branch, n };
  const defaultN = counts.get(defaultBranch) || 0;
  if (best.branch === defaultBranch || best.n <= defaultN) return fallback;
  return { branch: best.branch, reason: `most merged PRs in the last ${days}d (${best.n} on ${best.branch} vs ${defaultN} on ${defaultBranch})` };
}

// a partial clone (`git clone --filter=blob:none ...`) or a shallow clone (`--depth`) lets
// `git log`/`ls-tree` run instantly, but any pass that reads a DIFF or a FILE'S CONTENT (`git show`, `git log
// --numstat/-p`, `git grep` across history, `cat-file --batch`) fetches the missing objects from the remote one
// at a time on a partial clone — on a repo the size of Twenty that's minutes of silence, easy to mistake for a
// hang. Detected with two near-instant git calls (`git config`/`git rev-parse`, neither reads a blob); never
// throws, never fetches anything itself — just says why the next part may be slow. Exported (not only called
// from here) so any tool that does that kind of read can print the same notice before it starts — measure-size.mjs
// and inventory.mjs call it directly; shipped-record.mjs's comment-only check reads diffs the same way and
// should call it too (it's owned by another branch, not changed here).
export function partialCloneNoticeOf(repo) {
  const git1 = (...a) => { try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };
  const filter = git1("config", "--get", "remote.origin.partialclonefilter");
  const shallow = git1("rev-parse", "--is-shallow-repository") === "true";
  if (!filter && !shallow) return null;
  if (filter) return `partial clone (${filter})${shallow ? ", shallow too" : ""}: reading diffs fetches blobs, expect minutes; \`git fetch --refetch\` or a full clone makes this fast.`;
  return "shallow clone: reading diffs may be slow and history beyond the clone's depth is missing; `git fetch --unshallow` or a full clone makes this fast and complete.";
}

// Library, not a CLI: a misdirected `node integration-branch.mjs ...` would otherwise
// print nothing and exit 0. Callers are found at runtime by scanning skill/tools/*.mjs for an import of this file.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const self = "integration-branch.mjs";
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const callers = fs.readdirSync(dir).filter(f => f.endsWith(".mjs") && f !== self)
    .filter(f => { try { return new RegExp(`["']\\./${self}["']`).test(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return false; } }).sort();
  console.error(`${self} is a library used by ${callers.join(", ") || "no other tool"}; did you mean \`nosy peek\` or \`node skill/tools/collect-status.mjs\`?`);
  process.exit(1);
}
