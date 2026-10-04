#!/usr/bin/env node
// handoff: turns one item of the team's list (psst, the team's own next list) into work on GitHub, where the team already works.
// Nosy hosts no board and no task list: the issue, its assignee and its project card live on GitHub, and `ship-notes`/`shipped` read
// them back. Shown to the owner first; written only with --yes.
// Usage: node handoff.mjs <pm folder> [<n> | --item "<title fragment>"] [--to <login>] [--agent] [--project <number> [--owner <login>]]
//                                      [--body-file <file>] [--yes] [--json <file>]
//   no item        lists the candidates of pm/state/lowhanging.filtered.json (psst's final list), numbered, with who is suggested for each
//   <n> / --item   builds the packet for that item: title, body, suggested owner, agent, project card. Without --yes nothing is written.
// Who:   the suggestion is a SUGGESTION. It is the GitHub login that wrote most of the last commits touching the item's evidence path
//   (`gh api repos/<repo>/commits?path=`), counted only when that login can be assigned in the repo. --to overrides it. Nothing is assigned
//   that the owner did not see in the preview.
// Agent: `--agent copilot` assigns the Copilot coding agent only when asked (it is paid: a premium request and Actions minutes per session). --agent follows Linear's rule: a person stays accountable, the agent is delegated. The person is --to, else the suggestion, else
//   the signed-in user. The agent is assigned when the repo lists a Copilot coding agent among its assignable actors; otherwise the issue
//   gets the label `handoff.agentLabel` (default `agent-ready`) and, if `handoff.agentMention` is set (for example "@claude"), one line
//   with that mention. Which one happened is printed; it is never faked.
// Project: `handoff.project` { owner, number, type, status, horizon } in sources.json (horizon: Now / Next / Later, `--horizon`, for a board that has a field of that name) (the shape `roadmap.project` uses), or --project. Adding a card
//   needs the `project` scope (not just `read:project`): checked before anything is written; `gh auth refresh -s project` fixes it.
// An item whose ref is an issue (#N) is already on GitHub: the handoff edits that issue (assignee, label, card) instead of opening a second one.
// Card fields (only the ones the board has, matched by name; the rest are skipped and said so): Status, Horizon (single-select), Signal (text: the
//   kind of signal that put the item on the list), Asked for (number: only when the item carries a count), Area and Rivals with it (--area <no|name>:
//   the matrix area this work closes and how many rivals have it; given by the owner, never guessed). `--setup-board` previews and, with --yes,
//   creates what a board is missing (the project itself when there is none, linked to the repo; the fields above).
// --review --brief: only what a merged pull request closed (what `nosy shipped` shows), and nothing at all when there is none.
// --review: what became of what was handed off (read-only, writes only pm/state/handoff-review.json). For each handed-off issue: open or closed, its card's
//   Status, and, when a merged pull request closed it, PROPOSALS: the matrix area it may now close (named with --area when it was handed off; the cell
//   `Nosy: p/n → y` is the owner's to change, after checking it works) and whether `nosy ship-notes` will tell whoever asked. Nothing is written to GitHub or
//   to the matrix.
// Never: closes, edits or deletes anything; opens a second issue for the same item (pm/state/handoff.json plus an exact-title check);
//   puts a customer, a quote or a count of people in the body (the privacy scan runs over it and stops on a finding). It pushes nothing.
// Writes (only with --yes, one at a time, the first failure stops it): gh issue create | gh issue edit, gh label create, gh api (the agent),
//   gh project item-add / item-edit; then pm/state/handoff.json.
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readSources, teamLogins, isTeamLogin } from "./sources-file.mjs";
import { matrixRead } from "./read-matrix.mjs";
import { advice } from "./hints.mjs";

export const MARKER = key => `<!-- nosy:handoff ${key} -->`;
const Tool = path.dirname(fileURLToPath(import.meta.url));
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const fill = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
const keyOf = title => createHash("sha1").update(String(title).trim().toLowerCase().replace(/\s+/g, " ")).digest("hex").slice(0, 10);

const phraseFile = code => readJson(fileURLToPath(new URL(`../data/lang/${code}/handoff.json`, import.meta.url)));
const warned = new Set();
export function phrases(lang) {
  const code = String(lang || "en").trim().toLowerCase().split(/[-_]/)[0];
  const P = /^[a-z]{2,3}$/.test(code) ? phraseFile(code) : null;
  if (P) return P;
  if (!warned.has(code)) { warned.add(code); console.error(`handoff: no phrases for language "${lang}" yet (skill/data/lang/${code}/handoff.json); using English`); }
  return phraseFile("en");
}

// The path an item's evidence points at ("src/a.ts:42" → "src/a.ts"); null when it points at no file.
export const evidencePath = e => { const m = String(e ?? "").match(/^([\w@./-]+\.[A-Za-z0-9]{1,6})(?::\d+(?:-\d+)?)?$/); return m ? m[1] : null; };
export const issueRefOf = ref => { const m = String(ref ?? "").match(/^#(\d+)$/); return m ? +m[1] : null; };
const isBotLogin = l => /\[bot\]$|^app\//i.test(String(l ?? ""));

// The fields a board needs for handoff to fill a card (`--setup-board` creates the missing ones).
export const WANTED_FIELDS = [
  { name: "Horizon", type: "SINGLE_SELECT", options: ["Now", "Next", "Later"] }, { name: "Signal", type: "TEXT" }, { name: "Asked for", type: "NUMBER" },
  { name: "Area", type: "TEXT" }, { name: "Rivals with it", type: "NUMBER" },
];
// The matrix area an owner names (`--area 12`, or a piece of its name): { no, name, rivals, total }. Rivals that are acquired or closed don't count. Null when nothing
// (or more than one area) matches: the caller says so, nothing is guessed.
export function areaOf(M, spec) {
  if (!M?.lines?.length || spec == null || String(spec).trim() === "") return null;
  const s = String(spec).trim().toLowerCase(), lines = M.lines;
  let hits = lines.filter(l => l.no != null && String(l.no).toLowerCase() === s);
  if (!hits.length && /^\d+$/.test(s) && lines[+s - 1] && lines.every(l => l.no == null)) hits = [lines[+s - 1]];
  if (!hits.length) hits = lines.filter(l => String(l.feature || "").toLowerCase().includes(s));
  if (hits.length !== 1) return null;
  const l = hits[0], rivals = (M.products || []).filter(p => p !== M.biz && !M.oh?.has(p));
  return { no: l.no ?? lines.indexOf(l) + 1, name: String(l.feature || "").replace(/\s+/g, " ").trim(), rivals: rivals.filter(p => l.codes?.[p] === "y").length, total: rivals.length };
}
// Which card fields to set. `wanted` is what we have a value for; `fields` is the board's own field list ([{ name, type, options? }]).
// Returns { will: [{ name, kind, value }], absent: [names the board lacks] }. A board whose field list couldn't be read (null) skips nothing: the write step says what failed.
export function cardFields(wanted, fields) {
  // gh's field list says "single select" but not text from number: the value we hold decides the rest (Asked for and Rivals with it are numbers).
  const kindOf = (f, value) => (f?.type === "ProjectV2SingleSelectField" || f?.options ? "single" : typeof value === "number" ? "number" : "text");
  const will = [], absent = [];
  for (const [name, value] of wanted) {
    if (value == null || value === "") continue;
    const f = fields?.find(x => x.name === name);
    if (fields && !f) { absent.push(name); continue; }
    will.push({ name, kind: kindOf(f, value), value });
  }
  return { will, absent };
}

// The whole issue body. Facts the item already carries, nothing invented: no reason text from the evidence files, no names, no quotes.
export function bodyOf(item, { lang, owner, agent, mention, key, notesDir } = {}) {
  const P = phrases(lang), L = [];
  L.push(`**${P.why}**`, `- ${item.type || P.onTheList}`);
  if (item.demand && Number(item.demand.count) > 0) L.push(`- ${fill(P.asked, { n: item.demand.count })}`);
  // Only a real file path goes into the issue. Prose evidence can name a person or a decision, and a path inside pm/ points at notes that are
  // not in the repo's public files: those say "the team's notes" instead.
  const p = evidencePath(item.evidence), inNotes = p && notesDir && (p === notesDir || p.startsWith(notesDir + "/"));
  L.push("", `**${P.where}**`, `- ${p && !inNotes ? `\`${item.evidence}\`` : inNotes ? P.notes : P.noEvidence}`);
  if (owner) L.push("", `**${P.owner}**`, `- @${owner.login}: ${fill(P.ownerWhy, { k: owner.k, n: owner.n, path: owner.path })} (${P.suggestion})`);
  if (agent && mention) L.push("", `${mention} ${P.agentAsk}`);
  L.push("", P.done, "", `<sub>${P.footer}</sub>`, MARKER(key));
  return L.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

// Who wrote most of the recent commits on a path, among the logins GitHub lets us assign. Pure: the commit and assignee lists come in.
export function suggestOwner(logins, assignable, p, { minShare = 0.5, minCommits = 2 } = {}) {
  const ok = new Set(assignable.map(x => x.toLowerCase())), count = new Map();
  let n = 0;
  for (const l of logins) { if (!l || isBotLogin(l)) continue; n++; if (ok.has(l.toLowerCase())) count.set(l, (count.get(l) || 0) + 1); }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top || n === 0 || top[1] < minCommits || top[1] / n <= minShare) return null; // a majority, not a tie
  return { login: top[0], k: top[1], n, path: p };
}

function main() {
  const argv = process.argv.slice(2);
  const al = f => { const i = argv.indexOf(f); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
  const flag = f => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
  const itemArg = al("--item"), to = al("--to")?.replace(/^@/, ""), projArg = al("--project"), ownerArg = al("--owner"), horizonArg = al("--horizon"), areaArg = al("--area"), bodyFile = al("--body-file"), jsonOut = al("--json");
  // `--agent` asks for a coding agent through the free path (a label, and a mention if one is configured); `--agent copilot` assigns GitHub's Copilot
  // coding agent, which is a paid feature of the owner's plan (a premium request and Actions minutes per session), so it is never picked on its own.
  let agentWanted = false, agentCopilot = false;
  { const i = argv.indexOf("--agent"); if (i >= 0) { agentWanted = true; if (argv[i + 1] === "copilot") { agentCopilot = true; argv.splice(i, 2); } else argv.splice(i, 1); } }
  const yes = flag("--yes"), setup = flag("--setup-board"), review = flag("--review"), brief = flag("--brief");
  const positional = argv.filter(a => !a.startsWith("--"));
  const [pm = "pm", nArg] = positional;
  const stop = (msg, code = 1) => { console.error(`Psst… ${msg}`); process.exit(code); };

  let K; try { K = readSources(pm); } catch { stop(`couldn't read ${path.join(pm, "sources.json")}. Run \`nosy setup\` first.`); }
  const R = K.issue?.repo;
  if (!R) stop("handoff needs the GitHub repo that holds the issues: set `issue.repo` (owner/name) in pm/sources.json.");
  if (!/^[\w.-]+\/[\w.-]+$/.test(R)) stop(`\`issue.repo\` in pm/sources.json is "${R}", which is not owner/name.`);
  const H = K.handoff || {}, lang = K.language;
  const notesDir = path.relative(K.repo || ".", path.resolve(pm)).split(path.sep).join("/") || null; // normally "pm"
  const gh = a => execFileSync("gh", a, { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
  const ghFail = (what, e) => { const t = `${e.stderr || ""}${e.message || ""}`; stop(`couldn't ${what}: ${t.trim().split("\n")[0].slice(0, 150)}\n${advice(t) || "Check that gh is signed in (`gh auth status`) and `issue.repo` in pm/sources.json is right."} Nothing was written.`); };

  const projectScopeProblem = what => {
    const r = spawnSync("gh", ["api", "-i", "user"], { encoding: "utf8" });
    const scopes = (/^x-oauth-scopes:[ \t]*(.*)$/im.exec(r.stdout || "") || [])[1];
    return scopes !== undefined && !/(^|[\s,])project([\s,]|$)/.test(scopes) ? `${what} needs the \`project\` scope (this token has: ${scopes.trim() || "none"}). Run \`gh auth refresh -s project\`, then again. Nothing was written.` : null;
  };
  const fieldsOf = (owner, number) => JSON.parse(gh(["project", "field-list", String(number), "--owner", owner, "--format", "json"])).fields;

  // --- --setup-board: what the board is missing for handoff, and (with --yes) creating it ---
  const setupBoard = () => {
    const owner = ownerArg || H.project?.owner || R.split("/")[0], number = projArg ? +projArg : H.project?.number ? +H.project.number : null;
    let have = null;
    if (number) { try { have = fieldsOf(owner, number); } catch (e) { return ghFail(`read project ${owner}/${number}`, e); } }
    const names = new Set((have || []).map(f => f.name)), missing = WANTED_FIELDS.filter(f => !names.has(f.name)), repoName = R.split("/")[1];
    let o = `# Board setup · ${R}\n\n- Project: ${number ? `${owner}/${number} (exists; has ${[...names].join(", ") || "no fields"})` : `none set. It would create a project "${repoName}" for ${owner} and link it to ${R}`}\n`;
    o += missing.length ? `- Fields to create: ${missing.map(f => f.options ? `${f.name} (${f.options.join(" / ")})` : `${f.name} (${f.type.toLowerCase()})`).join(", ")}\n` : "- Fields to create: none, the board has them all\n";
    o += "- Views: which field a board view uses for its columns can only be set in the GitHub UI (View → Column field by).\n";
    if (!number || missing.length) o += `\n${yes ? "" : "Nothing was written. Add `--yes` to do exactly this.\n"}`; else o += "\nNothing to do.\n";
    process.stdout.write(o);
    if (!yes || (number && !missing.length)) return;
    const problem = projectScopeProblem(`creating a board and its fields`); if (problem) stop(problem);
    const run = (args) => spawnSync("gh", args, { encoding: "utf8" });
    const bad = (what, r) => { const t = `${r.stderr || ""}${r.error?.message || ""}`; console.error(`Psst… couldn't ${what}: ${t.trim().split("\n")[0].slice(0, 150)}\n${advice(t) || "Check that gh is signed in with a token that can write projects for this owner."}\nStopped there.`); process.exitCode = 1; };
    let n = number;
    if (!n) {
      const c = run(["project", "create", "--owner", owner, "--title", repoName, "--format", "json"]); if (c.status !== 0) return bad("create the project", c);
      try { n = JSON.parse(c.stdout).number; } catch { return bad("read the new project's number", c); }
      console.log(`Created project ${owner}/${n}.`);
      const l = run(["project", "link", String(n), "--owner", owner, "--repo", R]); if (l.status !== 0) return bad(`link project ${n} to ${R} (the project exists)`, l); console.log(`Linked it to ${R}.`);
    }
    for (const f of (number ? missing : WANTED_FIELDS)) {
      const r = run(["project", "field-create", String(n), "--owner", owner, "--name", f.name, "--data-type", f.type, ...(f.options ? ["--single-select-options", f.options.join(",")] : [])]);
      if (r.status !== 0) return bad(`create the field ${f.name}`, r); console.log(`Created field ${f.name}.`);
    }
    let type = "organization"; try { type = gh(["api", `users/${owner}`, "--jq", ".type"]).trim() === "User" ? "user" : "organization"; } catch {}
    console.log(`Done. Put this in pm/sources.json to use it:\n  "handoff": { "project": { "owner": "${owner}", "number": ${n}, "type": "${type}", "status": "Todo" } }`);
  };
  if (setup) return setupBoard();

  // --- the list the owner works from ---
  const listFile = ["lowhanging.filtered.json", "lowhanging.json"].map(f => path.join(pm, "state", f)).find(f => fs.existsSync(f));
  const items = (listFile && readJson(listFile)?.items) || [];
  const stateFile = path.join(pm, "state", "handoff.json");
  const state = readJson(stateFile) || {};
  const done = new Map((state.done || []).map(x => [x.key, x]));
  const remember = e => {
    const list = state.done || [], i = list.findIndex(x => x.key === e.key), known = Object.fromEntries(Object.entries(e).filter(([, v]) => v != null));
    if (i >= 0) list[i] = { ...list[i], ...known }; else list.push({ ...known, at: new Date().toISOString() });
    state.done = list; fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state, null, 1) + "\n");
  };

  let assignableCache = null; // read once, only by the modes that need it
  const assignableLogins = () => assignableCache ??= (() => { try { return gh(["api", `repos/${R}/assignees`, "--paginate", "--jq", ".[].login"]).split("\n").filter(Boolean); } catch (e) { return ghFail("read who can be assigned", e); } })();
  const suggest = item => {
    const p = evidencePath(item.evidence);
    if (!p) return null;
    let logins; try { logins = gh(["api", `repos/${R}/commits?path=${encodeURIComponent(p)}&per_page=30`, "--jq", ".[].author.login"]).split("\n"); } catch { return null; }
    return suggestOwner(logins.filter(Boolean), assignableLogins(), p);
  };

  if (review) {
    const entries = state.done || [];
    if (!entries.length && brief) return; // `nosy shipped` asks: nothing to say is no output at all
    if (!entries.length) stop("nothing has been handed off yet: `nosy handoff <#> --yes` puts an item on GitHub first.", 0);
    const mp = K.matrix ? (path.isAbsolute(K.matrix) ? K.matrix : path.resolve(K.repo || ".", K.matrix)) : path.join(pm, "matrix.json");
    const M = fs.existsSync(mp) ? matrixRead(mp, { codes: K.matrixCodes }) : null, team = teamLogins(K), rows = [];
    for (const e of entries) {
      let v; try { v = JSON.parse(gh(["issue", "view", String(e.issue), "-R", R, "--json", "state,closedAt,closedByPullRequestsReferences,author,projectItems"])); } catch { rows.push({ issue: e.issue, title: e.title || null, status: "unreadable" }); continue; }
      const card = v.projectItems?.find(c => c.status?.name)?.status.name || null;
      let pr = null;
      if (v.state === "CLOSED") for (const ref of v.closedByPullRequestsReferences || []) {
        try { const p = JSON.parse(gh(["pr", "view", String(ref.number), "-R", R, "--json", "state,mergedAt"])); if (p.state === "MERGED") { pr = { number: ref.number, mergedAt: String(p.mergedAt).slice(0, 10) }; break; } } catch {}
      }
      const status = v.state === "OPEN" ? "open" : pr ? "closed by a merged pull request" : "closed, no merged pull request";
      let matrix = null;
      if (pr && e.area != null && M) { const l = M.lines.find(x => String(x.no) === String(e.area)), cur = l?.codes?.[M.biz]; if (l) matrix = cur === "y" ? { area: String(e.area), name: l.feature, already: true } : { area: String(e.area), name: l.feature, from: cur ?? "u", to: "y" }; }
      const tell = !!pr && !!v.author?.login && !v.author.is_bot && !isBotLogin(v.author.login) && !isTeamLogin(team, v.author.login);
      rows.push({ issue: e.issue, title: e.title || null, status, card, pr, area: e.area ?? null, matrix, tell });
    }
    const propsOf = r => {
      const out = [];
      if (r.pr && r.matrix && !r.matrix.already) out.push(`- Matrix area ${r.matrix.area} (${r.matrix.name}): Nosy ${r.matrix.from} → ${r.matrix.to}? #${r.issue} was closed by merged pull request #${r.pr.number} on ${r.pr.mergedAt}. If it works, change \`biz.codes["${r.matrix.area}"]\` in the matrix; it is yours to change.`);
      else if (r.pr && r.matrix?.already) out.push(`- Matrix area ${r.matrix.area} (${r.matrix.name}) already says y; #${r.issue} is merged (#${r.pr.number}).`);
      else if (r.pr && r.area == null) out.push(`- #${r.issue} is merged (#${r.pr.number}) but no matrix area was recorded; hand it off again with \`--area\` to say which area it closes.`);
      if (r.tell) out.push(`- \`nosy ship-notes\` will tell whoever asked for #${r.issue} (it previews first).`);
      if (r.status === "closed, no merged pull request") out.push(`- #${r.issue} is closed with no merged pull request: was it fixed? Nothing is proposed for it.`);
      if (r.status === "unreadable") out.push(`- #${r.issue} couldn't be read (gh signed out, or the issue is gone); nothing is proposed for it.`);
      return out;
    };
    const reviewFile = path.join(pm, "state", "handoff-review.json"), seen = new Set((readJson(reviewFile)?.rows || []).filter(x => x.pr).map(x => x.issue));
    let o;
    if (brief) {
      const merged = rows.filter(r => r.pr);
      o = merged.length ? `${merged.map(r => `- #${r.issue} ${String(r.title || "").replace(/\s+/g, " ").slice(0, 60)}: merged in #${r.pr.number} (${r.pr.mergedAt})${seen.has(r.issue) ? "" : " · new since the last look"}`).join("\n")}\n${merged.flatMap(propsOf).join("\n")}\n(\`nosy handoff --review\` has the whole list; nothing here is written to GitHub or the matrix.)\n` : "";
    } else {
      o = `# Hand-off review · ${R}\n\n| Issue | Title | State | Card | Merged PR | Matrix area |\n|---|---|---|---|---|---|\n`;
      for (const r of rows) o += `| #${r.issue} | ${String(r.title || "–").replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 50)} | ${r.status} | ${r.card || "–"} | ${r.pr ? `#${r.pr.number} (${r.pr.mergedAt})` : "–"} | ${r.area ?? "not recorded"} |\n`;
      const props = rows.flatMap(propsOf);
      o += `\n${props.length ? `Proposals (nothing is written to GitHub or to the matrix):\n${props.join("\n")}\n` : "No proposals: nothing handed off has been merged yet.\n"}`;
    }
    process.stdout.write(o);
    fs.mkdirSync(path.join(pm, "state"), { recursive: true });
    fs.writeFileSync(path.join(pm, "state", "handoff-review.json"), JSON.stringify({ type: "handoffReview", generated: new Date().toISOString(), repo: R, rows }, null, 1) + "\n");
    return;
  }

  if (!nArg && !itemArg) {
    if (!items.length) stop("no list to hand off yet: run `nosy psst` first (it writes pm/state/lowhanging.filtered.json).");
    let o = `# Hand-off candidates · ${R}\n\n| # | Item | Where | Suggested owner | State |\n|---|---|---|---|---|\n`;
    items.slice(0, 15).forEach((it, i) => {
      const s = suggest(it), d = done.get(keyOf(it.title)), ref = issueRefOf(it.ref);
      let live = ""; if (d) { try { const v = JSON.parse(gh(["issue", "view", String(d.issue), "-R", R, "--json", "state,assignees,projectItems"])); const card = v.projectItems?.find(c => c.status?.name)?.status.name; live = ` ${v.state.toLowerCase()}${v.assignees?.length ? ` (${v.assignees.map(a => `@${a.login}`).join(", ")})` : ""}${card ? ` · card: ${card}` : ""}`; } catch {} }
      o += `| ${i + 1} | ${String(it.title).replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 70)} | ${it.evidence || "–"} | ${s ? `@${s.login} (${s.k} of ${s.n})` : "–"} | ${d ? `handed off: #${d.issue}${live}` : ref ? `already issue #${ref}` : "not on GitHub yet"} |\n`;
    });
    process.stdout.write(`${o}\nPick one: \`nosy handoff <#> [--agent] [--to <login>] [--project <n>]\`. Nothing is written until \`--yes\`.\n`);
    return;
  }

  // --- the one item ---
  let item;
  if (itemArg) {
    const hits = items.filter(it => String(it.title).toLowerCase().includes(itemArg.toLowerCase()));
    if (hits.length !== 1) stop(hits.length ? `"${itemArg}" matches ${hits.length} items; use its number from \`nosy handoff\`.` : `no item on the list matches "${itemArg}".`);
    item = hits[0];
  } else {
    const n = +nArg; item = items[n - 1];
    if (!Number.isInteger(n) || !item) stop(`item ${nArg} is not on the list (1-${items.length}).`);
  }
  const key = keyOf(item.title), before = done.get(key);
  // A run that stopped half way (the issue opened, the card didn't) is finished by running it again with the same flags: the issue is then
  // "existing", and an assignee, a label or a card that is already there is a no-op. Without any of those flags there is nothing left to do.
  if (before && !agentWanted && !to && !projArg && !H.project?.number) stop(`already handed off as #${before.issue} ${before.url || ""}. Nothing to do (add --agent, --to or --project to finish what it didn't).`, 0);
  const existing = issueRefOf(item.ref) || before?.issue || null;
  if (to && !assignableLogins().some(l => l.toLowerCase() === to.toLowerCase())) stop(`${to} can't be assigned in ${R} (assignable: ${assignableLogins().slice(0, 8).join(", ")}${assignableLogins().length > 8 ? ", …" : ""}).`);

  const suggested = to ? null : suggest(item);
  const person = to ? { login: to, explicit: true } : suggested;
  let me = null; const meLogin = () => me ??= gh(["api", "user", "--jq", ".login"]).trim();
  const human = person?.login || (agentWanted ? meLogin() : null);

  // --- the agent: an assignable Copilot actor, else a label (+ mention) ---
  let agent = null;
  if (agentWanted) {
    const [o, n] = R.split("/");
    let actors = []; try { actors = JSON.parse(gh(["api", "graphql", "-f", `query=query{repository(owner:"${o}",name:"${n}"){suggestedActors(capabilities:[CAN_BE_ASSIGNED],first:50){nodes{__typename ... on Bot{login} ... on User{login}}}}}`])).data.repository.suggestedActors.nodes; } catch {}
    const bot = actors.find(a => a.__typename === "Bot" && /copilot/i.test(a.login));
    if (agentCopilot && !bot) stop(`Copilot's coding agent can't be assigned in ${R}: it needs a Copilot plan that includes it, enabled for this repo. Use \`--agent\` (the label path, no cost) instead. Nothing was written.`);
    agent = agentCopilot ? { kind: "assignee", login: /\[bot\]$/.test(bot.login) ? bot.login : `${bot.login}[bot]` }
      : { kind: "label", label: H.agentLabel || "agent-ready", mention: H.agentMention || null, copilotAvailable: !!bot };
  }

  // --- the project card, checked before anything is written ---
  const P = projArg || H.project?.number ? { owner: ownerArg || H.project?.owner || R.split("/")[0], number: +(projArg || H.project.number), status: H.project?.status || null, horizon: horizonArg || H.project?.horizon || null } : null;
  if (horizonArg && !P) stop("--horizon sets a field on the project card: add --project <number> (or set `handoff.project` in sources.json).");
  if (areaArg != null && !P) stop("--area sets fields on the project card: add --project <number> (or set `handoff.project` in sources.json).");
  if (P && yes) { const problem = projectScopeProblem(`adding to project ${P.owner}/${P.number}`); if (problem) stop(problem); }
  // The matrix area the owner names: given, never guessed.
  let area = null;
  if (areaArg != null) {
    const mp = K.matrix ? (path.isAbsolute(K.matrix) ? K.matrix : path.resolve(K.repo || ".", K.matrix)) : path.join(pm, "matrix.json");
    const M = matrixRead(mp, { codes: K.matrixCodes });
    area = areaOf(M, areaArg);
    if (!area) stop(`--area "${areaArg}" doesn't match exactly one area of ${M ? mp : "a matrix (none was found at " + mp + ")"}. Give its number, or a piece of its name that only one area has.`);
  }
  let boardFields = null; if (P) { try { boardFields = fieldsOf(P.owner, P.number); } catch {} }
  const wantedFields = P ? [["Status", P.status], ["Horizon", P.horizon], ["Signal", item.type ? String(item.type).replace(/\s+/g, " ").trim().slice(0, 120) : null],
    ["Asked for", Number(item.demand?.count) > 0 ? Number(item.demand.count) : null], ["Area", area ? `${area.no} · ${area.name}` : null], ["Rivals with it", area ? area.rivals : null]] : [];
  const card = cardFields(wantedFields, boardFields);

  // --- the body ---
  const title = String(item.title).replace(/\s+/g, " ").trim();
  const body = bodyFile ? fs.readFileSync(bodyFile, "utf8").replace(/\s*$/, "\n") + MARKER(key) + "\n" : bodyOf(item, { lang, owner: suggested, agent, mention: agent?.kind === "label" ? agent.mention : null, key, notesDir });
  const scanDir = fs.mkdtempSync(path.join(os.tmpdir(), "nosy-handoff-")); fs.writeFileSync(path.join(scanDir, "issue.md"), `# ${title}\n\n${body}`);
  const scan = spawnSync(process.execPath, [path.join(Tool, "privacy-scan.mjs"), "issue.md", "--pm", path.resolve(pm)], { encoding: "utf8", cwd: scanDir }); fs.rmSync(scanDir, { recursive: true, force: true });
  if (scan.status === 2) stop(`the privacy scan found something in the issue text; nothing was written.\n${scan.stdout}\nFix the item's title at its source, or pass a cleaned --body-file.`, 2);

  // --- an issue with this exact title already on GitHub? (only for an item that isn't an issue itself) ---
  let dup = null;
  if (!existing) {
    try { dup = JSON.parse(gh(["issue", "list", "-R", R, "--state", "all", "--search", `"${title.replace(/["\\]/g, " ")}" in:title`, "--limit", "20", "--json", "number,title,state"])).find(i => i.title.trim().toLowerCase() === title.toLowerCase()) || null; } catch (e) { ghFail("search existing issues", e); }
  }

  // --- who can read it: an issue in a public repo is public ---
  let visibility = "unknown"; try { visibility = gh(["api", `repos/${R}`, "--jq", ".private"]).trim() === "true" ? "private" : "public"; } catch {}

  // --- the preview (always) ---
  const plan = {
    action: existing ? `edit issue #${existing}` : dup ? `nothing: #${dup.number} already has this title` : "open a new issue",
    title, assignees: [human, agent?.kind === "assignee" ? agent.login : null].filter(Boolean),
    label: agent?.kind === "label" ? agent.label : null, project: P ? `${P.owner}/${P.number}${card.will.map(f => ` · ${f.name} ${f.value}`).join("")}` : null,
  };
  let o = `# Hand-off · ${R}\n\n**${title}**\n\n- Action: ${plan.action}\n- Assignees: ${plan.assignees.length ? plan.assignees.map(a => `@${a}`).join(", ") : "none"}${suggested ? ` (suggested from ${suggested.k} of the last ${suggested.n} commits on ${suggested.path}; a suggestion)` : to ? " (--to)" : ""}\n`;
  if (agentWanted) o += agent.kind === "assignee" ? `- Agent: ${agent.login} will be assigned. **This uses your Copilot plan** (one premium request, plus GitHub Actions minutes, per session; extra use is billed to you). ${human ? `@${human}` : "A person"} stays accountable\n` : `- Agent: ${agent.copilotAvailable ? "the free path, so" : "no coding agent is assignable in this repo, so"} the issue gets the label \`${agent.label}\`${agent.mention ? ` and a ${agent.mention} line` : ""}; ${human ? `@${human}` : "a person"} stays accountable${agent.copilotAvailable ? ". Copilot's coding agent is available here: `--agent copilot` would assign it instead (it uses your Copilot plan)" : ""}\n`;
  if (plan.project) o += `- Project card: ${plan.project}\n`;
  if (card.absent.length) o += `- Not on the board (left out): ${card.absent.join(", ")}. \`nosy handoff --setup-board\` adds them.\n`;
  if (P && !boardFields) o += `- Couldn't read the board's fields to check them; the write step will say what it couldn't set.\n`;
  o += `- Who can read it: ${visibility === "public" ? `**everyone** (${R} is a public repo; read the text below as something you are publishing)` : visibility === "private" ? `people with access to ${R}` : "unknown (couldn't read the repo's visibility; treat it as public)"}\n`;
  if (existing) o += "- The issue's own text is not touched; only what is listed above is added.\n";
  else if (!bodyFile) o += `- Heads-up: this is the short default body (why now, where to look, a suggestion). For work someone will pick up, write the problem and checkable "Done when" criteria and pass \`--body-file\`.\n`;
  o += existing ? "\n" : `\n---\n${body}---\n\n`;
  process.stdout.write(o);
  if (jsonOut) { fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify({ type: "handoff", generated: new Date().toISOString(), repo: R, key, plan, body }, null, 1) + "\n"); }
  if (dup) { process.stdout.write(`Nothing to open: #${dup.number} (${dup.state.toLowerCase()}) has this title. Hand that issue off with its own number if it's the same work.\n`); return; }
  if (!yes) { process.stdout.write("Nothing was written. Add `--yes` to do exactly this.\n"); return; }

  // --- --yes: write, one step at a time, stop on the first failure ---
  const fail = (what, r) => { const t = `${r.stderr || ""}${r.error?.message || ""}`; console.error(`Psst… couldn't ${what}: ${t.trim().split("\n")[0].slice(0, 150)}\n${advice(t) || "Check that gh is signed in with a token that can write issues in this repo."}\nStopped there; nothing further was tried.`); process.exitCode = 1; };
  const run = (args, input) => spawnSync("gh", args, { input, encoding: "utf8" });
  let number = existing, url = existing ? `https://github.com/${R}/issues/${existing}` : "";

  if (agent?.kind === "label") { const r = run(["label", "create", agent.label, "-R", R, "--description", "Ready for a coding agent to pick up", "--color", "5319e7"]); if (r.status !== 0 && !/already exists/i.test(`${r.stderr}`)) return fail(`create the label ${agent.label}`, r); }
  if (existing) {
    const args = ["issue", "edit", String(existing), "-R", R]; for (const a of plan.assignees.filter(a => !/\[bot\]$/.test(a))) args.push("--add-assignee", a); if (plan.label) args.push("--add-label", plan.label);
    if (args.length > 5) { const r = run(args); if (r.status !== 0) return fail(`edit #${existing}`, r); } else { console.log(`Nothing to change on #${existing}: no assignee or label to add.`); }
  } else {
    const args = ["issue", "create", "-R", R, "--title", title, "--body-file", "-"]; for (const a of plan.assignees.filter(a => !/\[bot\]$/.test(a))) args.push("--assignee", a); if (plan.label) args.push("--label", plan.label);
    const r = run(args, body); if (r.status !== 0) return fail("open the issue", r);
    url = r.stdout.trim().split("\n").pop(); number = +url.split("/").pop();
  }
  remember({ key, title, issue: number, url, area: area?.no }); // a new entry, or the area added to a known one: what `--review` needs later
  console.log(`${existing ? "Looked at" : "Opened"} #${number} ${url}`);
  if (agent?.kind === "assignee") { const r = run(["api", "-X", "POST", `repos/${R}/issues/${number}/assignees`, "-f", `assignees[]=${agent.login}`]); if (r.status !== 0) return fail(`assign ${agent.login} (the issue is open and the person is assigned)`, r); console.log(`Assigned ${agent.login}.`); }
  if (P) {
    const r = run(["project", "item-add", String(P.number), "--owner", P.owner, "--url", url, "--format", "json"]); if (r.status !== 0) return fail(`add the card to project ${P.owner}/${P.number} (the issue is open)`, r);
    console.log(`Added to project ${P.owner}/${P.number}.`);
    // The card's fields, from the board's own field list now (single-select options matched case-insensitively; text and number as given).
    if (card.will.length) {
      let itemId, projectId, fields;
      try {
        itemId = JSON.parse(r.stdout).id; projectId = JSON.parse(gh(["project", "view", String(P.number), "--owner", P.owner, "--format", "json"])).id;
        fields = fieldsOf(P.owner, P.number);
      } catch (e) { console.error(`Psst… the card was added but its fields weren't set: ${String(e.message).split("\n")[0].slice(0, 150)}`); return; }
      for (const { name, kind, value } of cardFields(wantedFields, fields).will) {
        const f = fields.find(x => x.name === name); let how, shown = value;
        if (kind === "single") {
          const opt = f.options?.find(x => x.name.toLowerCase() === String(value).toLowerCase());
          if (!opt) { console.error(`Psst… the board has no ${name} "${value}" (it has: ${(f.options || []).map(o => o.name).join(", ")}); that field is left as the board has it.`); continue; }
          how = ["--single-select-option-id", opt.id]; shown = opt.name;
        } else how = [kind === "number" ? "--number" : "--text", String(value)];
        const e = run(["project", "item-edit", "--id", itemId, "--project-id", projectId, "--field-id", f.id, ...how]); if (e.status !== 0) return fail(`set the card's ${name}`, e);
        console.log(`${name}: ${shown}.`);
      }
    }
  }
  console.log("Done. Nothing else was written outside pm/.");
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
