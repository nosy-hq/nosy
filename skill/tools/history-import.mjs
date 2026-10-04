// history: what happened in the repository BEFORE Nosy arrived (BlogFactory field test). `peek` and `shipped` answer "since the last run", and the snapshots only start when Nosy does,
// so on day one there was no changelog and no "before": the repository's own past (28 commits on main, 77 PRs, tags) was readable but nowhere shown. This reads it once, over a window
// you choose (30 or 90 days), from git and, when it is there, gh, and writes a typed record so nothing confuses it with a Nosy snapshot:
//   pm/state/history.json   { type: "history", kind: "before-nosy", window, ref, commits: { count, byWeek, byArea }, merged: [ { n, title, mergedAt } ], releases: [ { tag, date } ], issues }
//   pm/state/history.md     the same as a changelog, by week, newest first
// It stays on this machine: `publish` doesn't send it (the subjects and PR titles are the owner's text). Counts only would be sent if a later version asks for that.
// A rerun with the same window replaces the file; a snapshot of Nosy's own (pm/history/<timestamp>/) is never touched.
// Usage: node history-import.mjs <pm> [--days 90] [--json <file>]    Exit: 0 written · 1 no sources.json / the repo can't be read
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { readSourcesSafe } from "./sources-file.mjs"; import { localDayOf } from "./today.mjs";

const sh = (cmd, args, opts = {}) => { try { return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"], ...opts }); } catch { return null; } };
// A calendar week as its Monday, in the owner's day: "2026-09-28".
const weekOf = ms => { const day = localDayOf(ms), t = Date.parse(`${day}T00:00:00Z`), wd = (new Date(t).getUTCDay() + 6) % 7; return new Date(t - wd * 864e5).toISOString().slice(0, 10); }; // the weekday of the owner's day (not of the UTC instant), then calendar arithmetic
const areaOf = subject => { const m = subject.match(/^(?:feat|fix|perf|refactor|docs|chore|test)\(([^)]+)\)/i) || subject.match(/^([a-z][\w-]{2,24}):\s/i); return m ? m[1].toLowerCase() : "(none)"; };

export function importHistory(pm, { days = 90, now = Date.now() } = {}) {
  const K = readSourcesSafe(pm); if (!K) return { error: `no readable ${path.join(pm, "sources.json")}: run \`nosy setup .\` first` };
  const repo = K.repo || ".", ref = K.ref || "HEAD", since = new Date(now - days * 864e5).toISOString();
  if (sh("git", ["-C", repo, "rev-parse", "--git-dir"]) === null) return { error: `${repo} isn't a git repository` };
  const raw = sh("git", ["-C", repo, "log", "--first-parent", `--since=${since}`, "--format=%H\x1f%cI\x1f%s", ref]);
  if (raw === null) return { error: `couldn't read ${ref} in ${repo}` };
  const commits = raw.split("\n").filter(Boolean).map(l => { const [hash, at, subject] = l.split("\x1f"); return { hash: hash.slice(0, 7), at: Date.parse(at), subject }; }).filter(c => !Number.isNaN(c.at));
  const byWeek = new Map(), byArea = new Map();
  for (const c of commits) { const w = weekOf(c.at); byWeek.set(w, (byWeek.get(w) || 0) + 1); const a = areaOf(c.subject); byArea.set(a, (byArea.get(a) || 0) + 1); }
  const tagRaw = sh("git", ["-C", repo, "for-each-ref", "--sort=-creatordate", "--format=%(refname:short)\t%(creatordate:iso-strict)", "refs/tags"]) || "";
  const releases = tagRaw.split("\n").filter(Boolean).map(l => { const [tag, date] = l.split("\t"); return { tag, date: localDayOf(date), ms: Date.parse(date) }; }).filter(t => t.ms >= now - days * 864e5).map(({ ms, ...t }) => t);
  // GitHub, when the repo is set and gh is there: merged PRs and the issue counts. Missing is said, never guessed.
  const gh = { merged: [], issues: null, note: null }, issueRepo = K.issue?.repo;
  if (!issueRepo) gh.note = "no issue.repo in sources.json: merged pull requests and issues are not read";
  else {
    const day = localDayOf(new Date(now - days * 864e5)), j = a => { const o = sh("gh", [...a]); try { return o ? JSON.parse(o) : null; } catch { return null; } };
    const prs = j(["pr", "list", "-R", issueRepo, "--state", "merged", "--search", `merged:>=${day}`, "--limit", "200", "--json", "number,title,mergedAt"]);
    if (!prs) gh.note = "gh isn't available or couldn't read the repository: merged pull requests and issues are not read";
    else {
      gh.merged = prs.map(p => ({ n: p.number, title: String(p.title || "").slice(0, 140), mergedAt: p.mergedAt })).sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt)));
      const opened = j(["issue", "list", "-R", issueRepo, "--state", "all", "--search", `created:>=${day}`, "--limit", "200", "--json", "number"]), closed = j(["issue", "list", "-R", issueRepo, "--state", "closed", "--search", `closed:>=${day}`, "--limit", "200", "--json", "number"]);
      gh.issues = { opened: opened ? opened.length : null, closed: closed ? closed.length : null };
    }
  }
  return { type: "history", kind: "before-nosy", generated: new Date(now).toISOString(), window: { days, from: localDayOf(new Date(now - days * 864e5)), to: localDayOf(now) }, ref, repo: path.basename(path.resolve(repo)),
    commits: { count: commits.length, byWeek: [...byWeek].sort((a, b) => b[0].localeCompare(a[0])).map(([week, count]) => ({ week, count })), byArea: [...byArea].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([area, count]) => ({ area, count })),
      list: commits.slice(0, 60).map(c => ({ hash: c.hash, date: localDayOf(c.at), subject: c.subject.slice(0, 140) })) },
    merged: gh.merged, releases, issues: gh.issues, ...(gh.note ? { note: gh.note } : {}), baseline: "This is the repository's past before Nosy looked at it. Nosy's own snapshots (pm/history/<timestamp>/) and `nosy diff` start from the first run and are a different thing." };
}

export function render(H) {
  if (H.error) return `Psst… ${H.error}`;
  const L = [`# Before Nosy · ${H.repo} · ${H.window.from} – ${H.window.to} (${H.window.days} days, ${H.ref})`, "", H.baseline, "",
    `${H.commits.count} commits on the integration branch · ${H.merged.length} merged pull requests · ${H.releases.length} tag${H.releases.length === 1 ? "" : "s"}${H.issues ? ` · issues: ${H.issues.opened ?? "?"} opened, ${H.issues.closed ?? "?"} closed` : ""}.`];
  if (H.note) L.push(`(${H.note})`);
  if (H.commits.byWeek.length) L.push("", "## By week (commits)", ...H.commits.byWeek.map(w => `- week of ${w.week}: ${w.count}`));
  if (H.commits.byArea.length) L.push("", "## Where the work went", ...H.commits.byArea.map(a => `- ${a.area}: ${a.count}`));
  if (H.releases.length) L.push("", "## Releases", ...H.releases.map(r => `- ${r.tag} · ${r.date}`));
  if (H.merged.length) L.push("", "## Merged pull requests", ...H.merged.slice(0, 40).map(p => `- #${p.n} ${p.title} · ${localDayOf(p.mergedAt) || ""}`));
  if (H.commits.list.length) L.push("", "## Latest commits", ...H.commits.list.slice(0, 30).map(c => `- ${c.date} ${c.hash} ${c.subject}`));
  return L.join("\n");
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const daysArg = take("--days"), jsonOut = take("--json"), pm = argv[0] || "pm", days = daysArg ? +daysArg : 90;
  if (!Number.isInteger(days) || days < 1 || days > 730) { console.error("Psst… --days needs a whole number of days between 1 and 730 (30 or 90 are the usual windows)."); process.exit(1); }
  const H = importHistory(pm, { days });
  if (H.error) { console.error(render(H)); process.exit(1); }
  const out = jsonOut || path.join(pm, "state", "history.json");
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify(H, null, 1));
  const md = render(H); fs.writeFileSync(out.replace(/\.json$/, ".md"), md + "\n");
  console.log(md);
}
