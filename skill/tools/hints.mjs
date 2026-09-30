// hints: a failure should say what to do next, in one line (treg's pattern: the error carries the fix). This turns the
// raw things that break on a stranger's machine (git or gh not installed, gh signed out, no network, a folder that
// isn't a repo, a branch that isn't there, a JSON file with a typo, a Node stack trace) into a sentence with the
// command or link that fixes it. Pure functions plus two read-only checks; no network, writes nothing.
import fs from "node:fs"; import path from "node:path"; import { spawnSync } from "node:child_process";

import { fileURLToPath } from "node:url"; import { parseJson } from "./sources-file.mjs";

const FIRST = s => String(s ?? "").trim().split("\n").find(l => l.trim()) || "";

// How to run Nosy from a terminal HERE, as a stranger would have to type it: a global `nosy` on PATH when there is one,
// else `node <this copy's nosy.mjs>` (a clone, or the folder `nosy install` made: .claude/skills/nosy/tools/nosy.mjs),
// else the npx form when this copy lives in npx's throwaway cache. `nosyCommand("setup .")` → "nosy setup .". Every hint that
// names a command goes through this (NOSY_COMMAND overrides it, for a wrapper script or an alias), because nothing puts `nosy` on PATH after `nosy install`. The plugin path
// (/nosy:<command>) is a different thing and stays as it is. Read-only: looks at PATH and the file system.
const NOSY_NPX = "npx github:nosy-hq/nosy";
const quoteArg = p => /^[\w@%+=:,./\\~-]+$/.test(p) ? p : `"${p.replace(/(["\\$`])/g, "\\$1")}"`;
// Is there a global `nosy` on PATH that is ours (the npm/pnpm shim, or a link into a nosy.mjs)?
export function nosyOnPath({ env = process.env } = {}) {
  const dirs = String(env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  const names = process.platform === "win32" ? ["nosy.cmd", "nosy.exe", "nosy.ps1", "nosy"] : ["nosy"];
  for (const d of dirs) for (const n of names) {
    const f = path.join(d, n); if (!fs.existsSync(f)) continue;
    let real = ""; try { real = fs.realpathSync(f); } catch {}
    if (/\.(cmd|ps1|exe)$/i.test(n) || /nosy\.mjs$/.test(real)) return true; // a `nosy` that is some other program isn't ours
  }
  return false;
}
// `node <file>` as typed from `cwd`: the relative path when the file is under it, else the absolute one.
export function nodeCommandFor(file, cwd = process.cwd()) {
  const rel = path.relative(cwd, file);
  return `node ${quoteArg(rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : file)}`;
}
export function nosyPrefix({ env = process.env, cwd = process.cwd(), self = path.join(path.dirname(fileURLToPath(import.meta.url)), "nosy.mjs") } = {}) {
  if (String(env.NOSY_COMMAND ?? "").trim()) return String(env.NOSY_COMMAND).trim(); // an alias or wrapper of your own
  if (nosyOnPath({ env })) return "nosy";
  let me = self; try { me = fs.realpathSync(self); } catch {}
  return /[\\/]_npx[\\/]/.test(me) ? NOSY_NPX : nodeCommandFor(me, cwd);
}
export const nosyCommand = (sub = "", opts) => `${nosyPrefix(opts)}${sub ? ` ${sub}` : ""}`;
const nosy = sub => nosyCommand(sub);

// The next step for a raw failure text (an error message, a stderr), or null when it isn't one we know.
// Order matters: the specific ones first.
export function advice(text) {
  const t = String(text ?? "");
  if (/spawnSync git ENOENT|git: command not found|'git' is not recognized/.test(t)) return "git isn't installed (or isn't on your PATH): install it from https://git-scm.com/downloads, open a new terminal, and run this again.";
  if (/spawnSync gh ENOENT|gh: command not found|'gh' is not recognized/.test(t)) return "gh (the GitHub CLI) isn't installed: install it from https://cli.github.com and run `gh auth login`. Everything that reads only git still works without it.";
  if (/gh auth login|not logged in|HTTP 401|Bad credentials|requires authentication|authentication required|GH_TOKEN/i.test(t)) return "gh isn't signed in: run `gh auth login` (or set GH_TOKEN), then run this again.";
  if (/rate limit/i.test(t)) return "GitHub's rate limit is used up: wait a few minutes, or run `gh auth login` for a higher limit.";
  if (/Could not resolve to a Repository|HTTP 404/i.test(t)) return "GitHub can't find that repo: check `issue.repo` in pm/sources.json (owner/name) and that your gh account can read it (`gh repo view owner/name`).";
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT|Could not resolve host|error connecting to|fetch failed|network is unreachable/i.test(t)) return "no network (or the site is down): check your connection and run this again. The commands that read only git work offline; NOSY_OFFLINE=1 skips the network steps.";
  if (/not a git repository|cannot change to|is not a git repo|No such file or directory.*\.git/i.test(t)) return "that folder isn't a git repo Nosy can read: run it inside the product's repo, or fix `repo` in pm/sources.json.";
  if (/does not have any commits yet|bad default revision|Needed a single revision/i.test(t)) return "the repo has no commits yet: make a first commit (`git commit --allow-empty -m start`), then run this again.";
  if (/unknown revision or path|ambiguous argument|bad revision|not a valid object name|invalid reference/i.test(t)) return "the branch in pm/sources.json (`ref`) isn't in this repo: `git branch -a` lists them; fix `ref`, or `git fetch` if it's a remote branch.";
  if (/is not a symbolic ref|refs\/remotes\/origin\/HEAD/.test(t)) return "this repo has no `origin` to follow (never fetched, or no remote): fine for local work; with a remote, `git remote set-head origin -a` fixes it.";
  if (/EACCES|EPERM|permission denied/i.test(t)) return "permission denied: check that you can write to this folder (Nosy writes only under pm/ and the folders `nosy install` names).";
  if (/ENOSPC/.test(t)) return "the disk is full: free some space and run this again.";
  if (/in JSON at position|Unexpected token .* JSON|JSON\.parse|Unexpected end of JSON/i.test(t)) return "a JSON file has a typo (the message names the spot): fix it by hand, or move the file aside and run the command that writes it again.";
  return null;
}

// A short reason for a failed fetch(): Node says only "fetch failed", the code is in `cause`.
export function netError(e) {
  if (e?.name === "AbortError") return "timed out";
  const code = e?.cause?.code || e?.cause?.errors?.[0]?.code || e?.code; // a host with several addresses fails with an AggregateError
  if (/ENOTFOUND|EAI_AGAIN/.test(code || "")) return `no network or the host doesn't exist (${code})`;
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT/.test(code || "")) return `couldn't connect (${code})`;
  return String(e?.message || e);
}

// A raw Node crash (a stack trace from a script) as one line plus the fix: the first "fatal:"/"Error:" line, then advice.
// Returns null when `stderr` isn't a stack trace, so callers print real messages untouched.
export function cleanTrace(stderr) {
  const t = String(stderr ?? "");
  if (!/^\s+at .*(\(|:\d+:\d+)|node:internal\//m.test(t)) return null;
  const lines = t.split("\n").map(l => l.trim()).filter(Boolean);
  const cause = lines.find(l => /^fatal:/i.test(l)) || lines.find(l => /^(\w+)?Error:/.test(l)) || lines[0];
  const nice = String(cause).replace(/^Error: Command failed: /, "").replace(/^Error: /, "");
  const fix = advice(t);
  return `Psst… couldn't run: ${nice.length > 160 ? nice.slice(0, 157) + "…" : nice}${fix ? `\n${fix}` : `\nRe-run it with the folder's pm/sources.json checked: \`${nosy("doctor --check")}\`.`}`;
}

// A pm/ written by an older Nosy (Turkish file and folder names, see docs/RENAMES.md): the old names found at its top
// level, [] for a current one. `doctor --fix` renames them; `setup` must not write a second sources.json beside them.
export function oldLayout(pm) {
  try {
    const R = JSON.parse(fs.readFileSync(new URL("../data/lang/tr/renames.json", import.meta.url), "utf8"));
    const old = { ...(R.files || {}), ...(R.folders || {}) };
    return fs.readdirSync(pm).filter(n => old[n] && old[n] !== n && !fs.existsSync(path.join(pm, old[n])) || n === "kaynaklar.json");
  } catch { return []; }
}
// The one-line pointer for an old pm/, or null.
export function oldLayoutNote(pm) {
  const old = oldLayout(pm);
  return old.length ? `${pm}/ is from an older Nosy (${old.slice(0, 3).join(", ")}${old.length > 3 ? ", …" : ""}: old names, not sources.json). Run \`${nosy("doctor --fix")}\` to rename it; setup would only start a second, empty one beside it.` : null;
}

// pm/sources.json: null when it reads, else what's wrong and the command that fixes it.
export function sourcesProblem(pm) {
  const f = path.join(pm, "sources.json");
  if (!fs.existsSync(pm)) return `no ${pm}/ folder here. Run this from the product's folder (or pass --pm <folder>); Nosy hasn't moved in yet? Run \`${nosy("setup .")}\` (or /nosy:move-in in your agent).`;
  if (!fs.existsSync(f)) return oldLayoutNote(pm)
    || `${f} is missing. Run \`${nosy("setup .")}\` (or /nosy:move-in in your agent) to write it.`;
  try { const K = parseJson(fs.readFileSync(f, "utf8")); if (K && typeof K === "object" && !Array.isArray(K)) return null; return `${f} isn't a JSON object. Move it aside and run \`${nosy("setup .")}\` (or /nosy:move-in).`; }
  catch (e) { return `${f} isn't valid JSON (${FIRST(e.message).slice(0, 90)}). Fix that spot by hand, or move the file aside and run \`${nosy("setup .")}\`; \`${nosy("doctor --check")}\` says where.`; }
}

// The repo and branch sources.json names: null when both read, else what's wrong and the fix. Resolved from the
// current folder, the same way the scripts read it (they run from the product's folder).
export function repoProblem(K, { cwd = process.cwd() } = {}) {
  const repo = path.resolve(cwd, K.repo || "."), ref = K.ref;
  const git = (...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const probe = git("rev-parse", "--git-dir");
  if (probe.error?.code === "ENOENT") return advice("spawnSync git ENOENT");
  if (!fs.existsSync(repo) || probe.status !== 0) return `\`repo\` in pm/sources.json (${K.repoAsWritten ?? (K.repo || ".")}) isn't a git repo (looked in ${repo}). Fix \`repo\` there, or run this from the product's folder.`;
  if (git("rev-parse", "--verify", "--quiet", "HEAD").status !== 0) return `${repo} has no commits yet. Make a first commit (\`git commit --allow-empty -m start\`), then run this again.`;
  if (ref && git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`).status !== 0) return `\`ref\` in pm/sources.json (${ref}) isn't a branch or commit in ${repo}. \`git branch -a\` lists them; fix \`ref\`, or \`git fetch\` if it's a remote branch.`;
  return null;
}

// The nearest command name for a mistyped one (`nosy shiped` → shipped), or null.
export function closest(word, names) {
  const d = (a, b) => { const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return m[a.length][b.length]; };
  const best = names.map(n => [n, d(word.toLowerCase(), n)]).sort((x, y) => x[1] - y[1])[0];
  return best && best[1] <= Math.max(2, Math.floor(word.length / 3)) ? best[0] : null;
}
