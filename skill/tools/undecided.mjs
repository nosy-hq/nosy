// Requests nobody has decided on: open feature requests older than `minAge` days with no
// sign of a decision: no assignee, no milestone, no decision label. The one number a cold reader acted on in the
// comprehension check (Metabase: 141 of 190 still "Needs Triage"). Only explicit signals; no text similarity.
// Reads the product's GitHub issues (sources.json issue.repo) with `gh`; writes ONLY the "undecided" key of
// <pm>/state/shipped.json (read-modify-write, like N2's "recent"), creating the file if it doesn't exist.
// Usage: node undecided.mjs <pm folder> [--min-age 14] [--limit 1000] [--dry]    (--dry prints the list, writes nothing)
// If gh returns exactly --limit issues, older open issues were not read: "undecidedScope.capped" is set and the page
// says "at least" instead of presenting a partial count as the total.
// Optional sources.json keys: undecided: { request: "<label regex>", decided: "<label regex>", team: "<label regex, 1 group>" }
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { advice, sourcesProblem } from "./hints.mjs";
import { readSources } from "./sources-file.mjs";

export const Default = {
  request: "feat|enhanc|improv|request",                       // labels that make an issue a request (bugs are not)
  decided: "planned|accepted|roadmap|scheduled|in progress|wontfix|won't fix|not planned|duplicate|icebox",
  team: "team[/:\\s-]+([\\w-]+)",                              // "Team/Metabot", "team: api"
};
const RequestTitle = /^\s*(\[?\s*feat|feature request|\[?\s*enhancement|\[?\s*request\b)/i;

// Pure: issues as gh returns them ({number,title,createdAt,labels:[{name}],assignees:[],milestone}) → undecided list.
export function undecidedOf(issues, { now = Date.now(), minAge = 14, rules = {} } = {}) {
  const R = { ...Default, ...rules }, req = new RegExp(R.request, "i"), dec = new RegExp(R.decided, "i"), team = new RegExp(R.team, "i");
  const out = [];
  for (const i of issues) {
    const labels = (i.labels || []).map(l => l.name || l), all = labels.join(" · ");
    const isRequest = labels.some(l => req.test(l)) || RequestTitle.test(i.title || "");
    if (!isRequest || (labels.some(l => /bug/i.test(l)) && !labels.some(l => req.test(l)))) continue;
    if ((i.assignees || []).length || i.milestone || labels.some(l => dec.test(l))) continue;
    const ageDays = Math.floor((now - Date.parse(i.createdAt)) / 864e5);
    if (ageDays < minAge) continue;
    const t = all.match(team);
    out.push({ ref: `#${i.number}`, title: i.title, team: t ? t[1] : null, opened: i.createdAt.slice(0, 10), ageDays });
  }
  return out.sort((a, b) => b.ageDays - a.ageDays);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), opt = n => { const i = a.indexOf(n); return i >= 0 ? a.splice(i, 2)[1] : undefined; };
  const minAge = +(opt("--min-age") || 14), limit = +(opt("--limit") || 1000), dry = a.includes("--dry"); if (dry) a.splice(a.indexOf("--dry"), 1);
  const [pm = "pm"] = a;
  let K; try { K = readSources(pm); } catch { console.error(`Psst… ${sourcesProblem(pm)}`); process.exit(1); }
  if (!K.issue?.repo) { console.error("sources.json has no issue.repo: undecided reads GitHub issues. Add `\"issue\": { \"repo\": \"owner/name\" }` to pm/sources.json (and `gh auth login` if gh isn't signed in)."); process.exit(1); }
  let issues;
  try { issues = JSON.parse(execFileSync("gh", ["issue", "list", "-R", K.issue.repo, "--state", "open", "--limit", String(limit), "--json", "number,title,createdAt,labels,assignees,milestone"], { encoding: "utf8", maxBuffer: 64 << 20 })); }
  catch (e) { console.error(`gh issue list failed for ${K.issue.repo}: ${e.message.split("\n")[0]}\n${advice(`${e.message}\n${e.stderr || ""}`) || "Check that gh is signed in (`gh auth status`, then `gh auth login`) and that `issue.repo` in pm/sources.json is right."}`); process.exit(1); }
  const list = undecidedOf(issues, { minAge, rules: K.undecided || {} }), capped = issues.length >= limit;
  const scope = `${capped ? "at least " : ""}${list.length} undecided of ${issues.length}${capped ? " newest" : ""} open issues${capped ? ` (capped at --limit ${limit}; older ones not read)` : ""}`;
  if (dry) { for (const u of list) console.log(`${u.ageDays}d\t${u.team || "-"}\t${u.ref}\t${u.title}`); console.log(scope); process.exit(0); }
  const f = path.join(pm, "state", "shipped.json");
  let s = {}; try { s = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  s.undecided = list; s.undecidedScope = { read: issues.length, capped, minAge };
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(s, null, 1));
  console.log(`${scope} → ${f}`);
}
