// Local "close to merging" fallback for peek/recent when there's no remote to read PRs from (no GitHub
// repo configured, gh unavailable, or offline): every local branch not yet merged into the integration
// branch, with commits ahead, the last commit's date/subject/author, and every explicit ref found across
// the branch's own commit subjects+bodies (refs.mjs's pattern set, plus the `Bet: nb-...` id bet.mjs
// writes - not a refs.mjs pattern by itself, it's the convention, not a decision/request ref, but just as
// useful to see here). Worktree branches count as normal branches: `git branch --format=...` lists them
// like any other local branch (a worktree's own checkout marker only shows in the default, non-`--format`
// listing). Never throws: a repo with nothing to compare (no integration branch locally, a shallow clone)
// just returns [].
import { execFileSync } from "node:child_process";
import fs from "node:fs"; import path from "node:path";
import { fileURLToPath } from "node:url";
import { patternsOfLoad, refRegex, groupKeyOf } from "./refs.mjs";

const BET_RE = /\bBet:\s*(nb-\d{6}-[a-z0-9-]+)/i;

// opts: { repo, integrationBranch (local ref, no "origin/" prefix needed - any commit-ish git accepts),
//         refSource (a pm folder path or sources.json K object, passed through to refs.mjs) }
export function localBranchesCloseToMerging({ repo, integrationBranch, refSource } = {}) {
  if (!repo || !integrationBranch) return [];
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 64 << 20 });
  let raw;
  try { raw = git("branch", "--no-merged", integrationBranch, "--format=%(refname:short)"); }
  catch { return []; }
  const refRe = refRegex(patternsOfLoad(refSource));
  const branches = [...new Set(raw.split("\n").map(s => s.trim()).filter(Boolean))].filter(b => b !== integrationBranch);
  const out = [];
  for (const branch of branches) {
    let ahead;
    try { ahead = parseInt(git("rev-list", "--count", `${integrationBranch}..${branch}`).trim(), 10); }
    catch { continue; }
    if (!ahead) continue; // diverged but nothing unique of its own - not "close to merging"
    let tip, range;
    try { tip = git("log", "-1", "--format=%aI%x1f%an%x1f%s", branch); }
    catch { continue; }
    const [last, author, subject] = tip.split("\x1f");
    try { range = git("log", `${integrationBranch}..${branch}`, "--format=%s%x1f%b%x1e"); } catch { range = ""; }
    const allText = range.split("\x1e").join("\n");
    const refs = [...new Set((allText.match(refRe) || []).map(groupKeyOf))];
    const bet = allText.match(BET_RE);
    if (bet && !refs.includes(bet[1])) refs.push(bet[1]);
    out.push({ branch, ahead, last, author, subject: (subject || "").trim(), refs });
  }
  return out.sort((a, b) => Date.parse(b.last) - Date.parse(a.last));
}

// Library, not a CLI: a misdirected `node local-branches.mjs ...` would otherwise
// print nothing and exit 0. Callers are found at runtime by scanning skill/tools/*.mjs for an import of this file.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const self = "local-branches.mjs";
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const callers = fs.readdirSync(dir).filter(f => f.endsWith(".mjs") && f !== self)
    .filter(f => { try { return new RegExp(`["']\\./${self}["']`).test(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return false; } }).sort();
  console.error(`${self} is a library used by ${callers.join(", ") || "no other tool"}; did you mean \`nosy recent\` or \`node skill/tools/recent.mjs\`?`);
  process.exit(1);
}
