// roadmap: the roadmap lives in the repo, as a file the team already reads. Nosy builds Now / Next / Later from
// the evidence (pm/state/waves.json, which `scoop` writes) and/or from what the team already curates on GitHub (labels, milestones, a
// Projects v2 board; read-only), plus what merged lately, and proposes it as a PULL REQUEST that edits one block of ROADMAP.md. Merging is
// the approval; reverting is the undo; nobody has to open a new tool. Nothing is pushed, and no PR is opened, without `--yes`.
//   node roadmap.mjs <pm> [--path ROADMAP.md] [--lang tr] [--json <file>]   preview: the block, written to pm/state/roadmap.md, and the same
//                                                                 content for a dashboard in pm/state/roadmap.json (`--json` copies it elsewhere too)
//   node roadmap.mjs <pm> --write <file>                                put the block into <file> in YOUR working tree (no git, no network): for a repo that has
//                                                                 no `origin` (Nosy's own working repo is exported, never pushed) or when you would rather commit it yourself
//   node roadmap.mjs <pm> --check                                 is the file in the repo's integration branch current? (exit 2: stale or missing)
//   node roadmap.mjs <pm> --pr --yes                              branch from the integration branch in a throwaway worktree, edit the block,
//                                                                 commit, push, `gh pr create`. Your checkout is never touched. An open PR from an
//                                                                 earlier run (head branch `nosy/roadmap-*`) is UPDATED (force-with-lease, one commit
//                                                                 on the current base), never duplicated; Nosy never closes a PR.
// What goes in (the file is read by the world when the repo is public, so only what the team already says in the open):
//   Now / Next / Later: the titles as the owner wrote them (a title the writer cut mid-sentence ends at its last whole word with "…"), `(#N)` when
//   the item's reference is an issue number (a link when the repo is known), never the reason text, the evidence paths, the score, the effort,
//   a person's name or a customer count; an item appears once, in the earliest of Now, Next, Later; the privacy scan runs over the block and the
//   JSON and a finding stops it. Shipped recently: merged PR titles (gh) or, without PRs, release tags.
// Config (sources.json → roadmap), everything optional:
//   { path: "ROADMAP.md", now: ["Now", "When code lands"], next: ["Needs backend", "After"], later: ["Open requests"], shipped: { days: 30, max: 10 },
//     skip: ["title fragment"], max: { now: 8, next: 10, later: 10 },
//     source: "evidence" | "github" | "both",     (github: only what the team curated there; both: curated items win for the same item)
//     labels: { now: "roadmap:now", next: "roadmap:next", later: "roadmap:later" },   open issues with the label
//     milestones: true,                            open milestones by due date: soonest = Now, the next = Next, the rest and undated = Later
//     project: { owner: "acme", number: 3, type: "organization" | "user", status: { now: ["In progress"], next: ["Todo", "Ready"], later: ["Backlog"] }, field: "Status" | "Horizon" } }
// GitHub is only ever READ here (gh issue list, gh api, a GraphQL query): nothing in this file writes to issues, milestones or Projects. If gh
// can't read a source (no read:project scope, not found, offline) it says so on stderr, says what to run, and the block is the evidence only.
// Language: the block's fixed phrases come from skill/data/lang/<code>/roadmap.json (`--lang`, else sources.json `language`, else English; an unknown
// language is English with one stderr line). The marker comments stay English.
// Only the block between <!-- nosy:roadmap --> and <!-- /nosy:roadmap --> is Nosy's; the rest of the file stays as written.
import { localDayOf } from "./today.mjs";
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { execFileSync, spawnSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { readSourcesSafe } from "./sources-file.mjs";
import { nosyCommand } from "./hints.mjs";

const Tool = path.dirname(fileURLToPath(import.meta.url));
export const HEAD = "<!-- nosy:roadmap -->", FOOT = "<!-- /nosy:roadmap -->";
const SECTIONS = ["now", "next", "later"];
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")); } catch { return null; } };
const firstLine = e => String((e && (e.stderr || e.message)) || e || "").trim().split("\n")[0].slice(0, 200);
const DEFAULTS = { path: "ROADMAP.md", now: ["Now", "When code lands"], next: ["Needs backend", "After"], later: ["Open requests"], shipped: { days: 30, max: 10 }, skip: [],
  source: "evidence", max: { now: 8, next: 10, later: 10 }, status: { now: ["In progress"], next: ["Todo", "Ready"], later: ["Backlog"] } };

export function configOf(K) {
  const R = (K && typeof K.roadmap === "object" && K.roadmap) || {}, list = (v, d) => (Array.isArray(v) ? v.map(String) : d), str = v => (typeof v === "string" && v.trim() ? v.trim() : null);
  const cap = k => (+R.max?.[k] >= 1 ? Math.floor(+R.max[k]) : DEFAULTS.max[k]);
  const P = R.project && typeof R.project === "object" ? R.project : null;
  return { path: str(R.path) || DEFAULTS.path, now: list(R.now, DEFAULTS.now), next: list(R.next, DEFAULTS.next), later: list(R.later, DEFAULTS.later),
    shipped: { days: +R.shipped?.days > 0 ? +R.shipped.days : DEFAULTS.shipped.days, max: +R.shipped?.max >= 0 ? +R.shipped.max : DEFAULTS.shipped.max }, skip: list(R.skip, []).map(s => s.toLowerCase()),
    source: ["evidence", "github", "both"].includes(R.source) ? R.source : DEFAULTS.source, badSource: R.source != null && !["evidence", "github", "both"].includes(R.source) ? String(R.source) : null,
    max: { now: cap("now"), next: cap("next"), later: cap("later") },
    labels: Object.fromEntries(SECTIONS.map(k => [k, str(R.labels?.[k])]).filter(([, v]) => v)), milestones: R.milestones === true,
    project: P && str(P.owner) && Number.isInteger(+P.number) && +P.number > 0
      ? { owner: str(P.owner), number: +P.number, type: P.type === "user" ? "user" : "organization", field: str(P.field) || "Status",
          // A board that has its own Now / Next / Later field (`field: "Horizon"`) maps by those words unless the owner says otherwise.
          status: Object.fromEntries(SECTIONS.map(k => [k, list(P.status?.[k], str(P.field) && str(P.field).toLowerCase() !== "status" ? [k[0].toUpperCase() + k.slice(1)] : DEFAULTS.status[k])])) } : null };
}

// ---- items ------------------------------------------------------------------------------------------------------------------------------------
// An earlier tool cut wave titles at about 110 characters, mid-word ("…while the"). A long (105+) title with no closing punctuation looks cut: it ends at its
// last whole word with "…" (the final word may be the cut one, so it goes). Whitespace collapses. Nothing is ever added to the words.
const CUT_AT = 105, CLOSED = /[.!?…。！？)\]}"'”’»]$/;
export function tidy(raw, cut = true) {
  let t = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (cut && t.length >= CUT_AT && !CLOSED.test(t)) { const i = t.lastIndexOf(" "); if (i > 0) t = t.slice(0, i); t = t.replace(/[\s,;:\-–—(\[{/&+]+$/, "") + "…"; }
  return t;
}
const publicUrl = u => (typeof u === "string" && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(issues|pull)\/\d+$/.test(u) ? u : null);
// { title, ref: "#12" | null, url } from a wave task. A reference like K12 or §3 is the team's own shorthand for a decision that isn't public, so it never appears.
export function itemOf(task, repoUrl) {
  const n = String(task.ref || "").match(/^#(\d+)$/)?.[1];
  return { title: tidy(task.title), ref: n ? `#${n}` : null, url: n && repoUrl ? `${repoUrl}/issues/${n}` : null };
}
// An item's line: its title, plus the issue as a link when it is known and the title doesn't already name it.
export const lineFor = it => `- ${it.title}${it.ref && !new RegExp(`${it.ref}\\b`).test(it.title) ? ` (${it.url ? `[${it.ref}](${it.url})` : it.ref})` : ""}`;
export const lineOf = (task, repoUrl) => lineFor(itemOf(task, repoUrl));
const shippedLine = s => `- ${s.title}${s.ref ? ` (${s.url ? `[${s.ref}](${s.url})` : s.ref})` : ""} · ${s.date}`;

// The same item: the same `#N` when both have one, else the same title (case, punctuation and accents aside).
const norm = s => String(s).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const same = (a, b) => (a.ref && b.ref ? a.ref === b.ref : norm(a.title) === norm(b.title));

// The model: { now: [item], next: [item], later: [item], shipped: [{title, ref, url, date}], hidden: {now, next, later} } from the waves the config maps, the
// curated GitHub sections (when there are any), merged PRs and tags. An item is in the earliest of Now, Next, Later only; each section is cut at its cap.
export function model({ waves, cfg, repoUrl = null, merged = [], tags = [], now = Date.now(), curated = null }) {
  const by = new Map((waves?.waves || []).map(w => [w.name, w.tasks || []]));
  const skipped = t => cfg.skip.some(s => t.title.toLowerCase().includes(s));
  const evidence = Object.fromEntries(SECTIONS.map(k => [k, cfg[k].flatMap(n => by.get(n) || []).filter(t => t && t.title).map(t => itemOf(t, repoUrl)).filter(t => t.title && !skipped(t))]));
  const cur = curated && Object.fromEntries(SECTIONS.map(k => [k, curated[k].filter(t => !skipped(t))]));
  // "both": a curated item decides its own section; the evidence copy of the same item, wherever it sits, is dropped.
  const picked = !cur ? evidence : cfg.source === "github" ? cur : Object.fromEntries(SECTIONS.map(k => [k, [...cur[k], ...evidence[k].filter(e => !SECTIONS.some(j => cur[j].some(c => same(c, e))))]]));
  const out = { hidden: {} }, seen = [];
  for (const k of SECTIONS) {
    const mine = []; for (const it of picked[k]) if (!seen.some(o => same(o, it))) { seen.push(it); mine.push(it); }
    out[k] = mine.slice(0, cfg.max[k]); out.hidden[k] = mine.length - out[k].length;
  }
  const since = now - cfg.shipped.days * 864e5, clean = s => String(s).replace(/\s+/g, " ").trim();
  const prs = merged.filter(p => p && p.title && Date.parse(p.mergedAt) >= since).sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt));
  out.shipped = prs.slice(0, cfg.shipped.max).map(p => ({ title: clean(p.title), ref: `#${p.number}`, url: repoUrl ? `${repoUrl}/pull/${p.number}` : null, date: localDayOf(p.mergedAt) || String(p.mergedAt).slice(0, 10) }));
  if (!out.shipped.length) out.shipped = tags.filter(t => Date.parse(t.date) >= since).slice(0, cfg.shipped.max).map(t => ({ title: clean(t.name), ref: null, url: null, date: localDayOf(t.date) || String(t.date).slice(0, 10) }));
  return out;
}

// ---- language ---------------------------------------------------------------------------------------------------------------------------------
// The phrase file of a code ("tr", "tr-TR"; null or "en" is English). An unknown code is English, and `warn` hears it once.
const phraseFile = code => readJson(fileURLToPath(new URL(`../data/lang/${code}/roadmap.json`, import.meta.url)));
export function phrases(lang, warn = m => console.error(m)) {
  const code = String(lang || "en").trim().toLowerCase().split(/[-_]/)[0], P = /^[a-z]{2,3}$/.test(code) ? phraseFile(code) : null;
  if (P) return P;
  warn(`roadmap: no phrases for language "${lang}" yet (skill/data/lang/${code}/roadmap.json); using English`);
  return phraseFile("en");
}
const fill = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");

// The block as it goes into the file. Empty sections are left out, a roadmap with nothing in it says so. A cut section ends with "…and N more".
export function render(m, { day, P = phrases("en"), source = "evidence" }) {
  const sec = (k, lines, hidden = 0) => (lines.length ? `### ${P.sections[k]}\n\n${lines.join("\n")}\n${hidden > 0 ? `\n_${fill(P.more, { n: hidden })}_\n` : ""}` : "");
  const body = [...SECTIONS.map(k => sec(k, m[k].map(lineFor), m.hidden?.[k])), sec("shipped", m.shipped.map(shippedLine))].filter(Boolean).join("\n");
  return `${HEAD}\n> ${fill(P.built, { source: P.sources[source] || P.sources.evidence, date: day })}\n\n${body || `${P.empty}\n`}${FOOT}`;
}
// pm/state/roadmap.json: what a dashboard draws. The same public-safe fields the block carries, nothing else (title, issue ref, link, date, counts).
export function jsonOf(m, { now = Date.now(), path: file = DEFAULTS.path } = {}) {
  const pick = a => a.map(i => ({ title: i.title, ref: i.ref, url: i.url }));
  return { type: "roadmap", generated: new Date(now).toISOString(), path: file, sections: { now: pick(m.now), next: pick(m.next), later: pick(m.later), shipped: m.shipped.map(s => ({ title: s.title, ref: s.ref, url: s.url, date: s.date })) },
    hidden: { now: m.hidden?.now || 0, next: m.hidden?.next || 0, later: m.hidden?.later || 0 } };
}

// Puts the block into a file's text: replaces the old block, or appends one (after a heading when the file is new).
export function splice(text, block, { title = "Roadmap" } = {}) {
  if (text == null || !text.trim()) return `# ${title}\n\n${block}\n`;
  const a = text.indexOf(HEAD), b = text.indexOf(FOOT);
  if (a >= 0 && b > a) return text.slice(0, a) + block + text.slice(b + FOOT.length);
  return text.replace(/\s*$/, "\n\n") + block + "\n";
}
export const blockOf = text => { const a = text ? text.indexOf(HEAD) : -1, b = text ? text.indexOf(FOOT) : -1; return a >= 0 && b > a ? text.slice(a, b + FOOT.length) : null; };
// The items in a block, by section, so a PR can say what was added, removed or moved. The "Built ... on <date>" line never counts as a change; the
// "…and N more" line does (a different count is a different block).
export function itemsOf(block) {
  const out = new Map(); let sec = null;
  for (const l of String(block || "").split("\n")) { const h = l.match(/^### (.+)/); if (h) sec = h[1]; else if (sec && (l.startsWith("- ") || l.startsWith("_…"))) out.set(l, sec); }
  return out;
}
export function changes(oldBlock, newBlock) {
  const a = itemsOf(oldBlock), b = itemsOf(newBlock), added = [], removed = [], moved = [];
  const key = l => l.replace(/ · \d{4}-\d{2}-\d{2}$/, "");
  const ak = new Map([...a].map(([l, s]) => [key(l), s])), bk = new Map([...b].map(([l, s]) => [key(l), s]));
  for (const [l, s] of bk) { if (!ak.has(l)) added.push({ line: l, section: s }); else if (ak.get(l) !== s) moved.push({ line: l, from: ak.get(l), to: s }); }
  for (const [l, s] of ak) if (!bk.has(l)) removed.push({ line: l, section: s });
  return { added, removed, moved };
}
const nothing = ch => !ch.added.length && !ch.removed.length && !ch.moved.length;
const bodyOf = (ch, day, notes = []) => {
  const L = l => l.replace(/^- /, "");
  const part = (h, a) => (a.length ? `**${h}**\n${a.map(x => `- ${L(x.line)}${x.section ? ` (${x.section})` : ""}${x.from ? `: ${x.from} → ${x.to}` : ""}`).join("\n")}\n\n` : "");
  return `Roadmap block updated by Nosy on ${day}.\n\n${nothing(ch) ? "Only the date line changed.\n\n" : ""}${part("Added", ch.added)}${part("Moved", ch.moved.map(m => ({ line: m.line, from: m.from, to: m.to })))}${part("Removed", ch.removed)}${notes.length ? `**Note**\n${notes.map(n => `- ${n}`).join("\n")}\n\n` : ""}Merging publishes it; closing this PR changes nothing. Only the block between \`${HEAD}\` and \`${FOOT}\` is Nosy's.\n`;
};

// ---- GitHub-curated sources (read-only) --------------------------------------------------------------------------------------------------------
// Teams that keep their roadmap in GitHub need no new tool: labels, milestones and a Projects v2 board are read through `gh`, never written.
// `gh` is injected so a test (or a caller) can answer without the network. Returns { sections | null, warnings }: sections is null (and the warning says
// why and what to run) when anything configured couldn't be read, so the caller falls back to the evidence only. Never partial, never silent.
const ghRun = args => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 << 20, stdio: ["ignore", "pipe", "pipe"] });
function ghJson(gh, args) {
  try { const data = JSON.parse(gh(args)); return data?.errors?.length ? { error: `${data.errors[0].type || "error"}: ${data.errors[0].message || ""}` } : { data }; }
  catch (e) { return { error: e.code === "ENOENT" ? "gh isn't installed" : firstLine(e.stderr || e.stdout || e) || firstLine(e) }; }
}
const PROJECT_QUERY = root => `query($owner:String!,$number:Int!,$field:String!,$after:String){ ${root}(login:$owner){ projectV2(number:$number){ items(first:100,after:$after){ pageInfo{hasNextPage endCursor} nodes{ isArchived status: fieldValueByName(name:$field){ ... on ProjectV2ItemFieldSingleSelectValue{ name } } content{ __typename ... on Issue{ number title url state repository{ nameWithOwner isPrivate } } ... on DraftIssue{ title } } } } } } }`;

export function readGithub(K, cfg, { gh = ghRun } = {}) {
  const repo = K?.issue?.repo, stop = msg => ({ sections: null, warnings: [`Psst… ${msg} Using the evidence only.`] });
  if (!cfg.project && !Object.keys(cfg.labels).length && !cfg.milestones) return stop(`roadmap.source is "${cfg.source}", but no roadmap.labels, roadmap.milestones or roadmap.project is set.`);
  if (process.env.NOSY_OFFLINE) return stop("NOSY_OFFLINE is set, so GitHub isn't read.");
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) { if (!cfg.project || Object.keys(cfg.labels).length || cfg.milestones) return stop("roadmap labels and milestones need `issue.repo` (owner/name) in sources.json."); }
  const out = { now: [], next: [], later: [] }, warnings = [];
  const issue = (i, r = repo) => (Number.isInteger(i?.number) && tidy(i.title, false) ? { title: tidy(i.title, false), ref: `#${i.number}`, url: publicUrl(i.url) || `https://github.com/${r}/issues/${i.number}` } : null);
  const issues = (extra, what) => { const r = ghJson(gh, ["issue", "list", "-R", repo, "--state", "open", ...extra, "--json", "number,title,url", "--limit", "100"]); return r.error ? { error: `${what} (${r.error})` } : { items: (Array.isArray(r.data) ? r.data : []).map(i => issue(i)).filter(Boolean) }; };

  for (const k of SECTIONS) {
    if (!cfg.labels[k]) continue;
    const r = issues(["--label", cfg.labels[k]], `roadmap.labels: couldn't list the open issues labelled "${cfg.labels[k]}" in ${repo}`);
    if (r.error) return stop(`${r.error}.`);
    out[k].push(...r.items);
  }

  if (cfg.milestones) {
    const r = ghJson(gh, ["api", `repos/${repo}/milestones?state=open&per_page=100`]);
    if (r.error || !Array.isArray(r.data)) return stop(`roadmap.milestones: couldn't list the open milestones of ${repo} (${r.error || "unexpected answer"}).`);
    const all = r.data.filter(m => m && m.title), due = m => Date.parse(m.due_on), dated = all.filter(m => due(m) > 0).sort((a, b) => due(a) - due(b)), ordered = [...dated, ...all.filter(m => !(due(m) > 0))];
    for (const [i, m] of ordered.entries()) {
      const q = issues(["--milestone", m.title], `roadmap.milestones: couldn't list the open issues of milestone "${m.title}" in ${repo}`);
      if (q.error) return stop(`${q.error}.`);
      out[i === 0 && dated.length ? "now" : i === 1 && dated.length > 1 ? "next" : "later"].push(...q.items);
    }
  }

  if (cfg.project) {
    const P = cfg.project, root = P.type === "user" ? "user" : "organization", items = [];
    let after = null, more = false;
    for (let page = 0; page < 3; page++) {
      const r = ghJson(gh, ["api", "graphql", "-f", `query=${PROJECT_QUERY(root)}`, "-f", `owner=${P.owner}`, "-F", `number=${P.number}`, "-f", `field=${P.field}`, ...(after ? ["-f", `after=${after}`] : [])]);
      const board = r.data?.data?.[root]?.projectV2;
      if (r.error || !board) {
        const e = r.error || "";
        if (/read:project|required scopes|INSUFFICIENT_SCOPES/i.test(e)) return stop(`roadmap.project: the GitHub token can't read Projects (missing the read:project scope). Run \`gh auth refresh -s read:project\`, then run this again.`);
        if (!e || /NOT_FOUND|Could not resolve/i.test(e)) return stop(`roadmap.project: no ${P.type} project #${P.number} for "${P.owner}" was found, or the token can't see it. Check owner, number and type in sources.json; for a private board run \`gh auth refresh -s read:project\`.`);
        return stop(`roadmap.project: gh couldn't read project #${P.number} of ${P.owner} (${e}). Check \`gh auth status\`.`);
      }
      items.push(...(board.items?.nodes || []));
      more = !!board.items?.pageInfo?.hasNextPage; after = board.items?.pageInfo?.endCursor;
      if (!more || !after) break;
    }
    if (more) warnings.push(`Psst… roadmap.project: the board has more than 300 items; only the first 300 were read.`);
    const want = k => P.status[k].map(s => s.trim().toLowerCase());
    for (const n of items) {
      const c = n?.content, section = SECTIONS.find(k => want(k).includes(String(n?.status?.name || "").trim().toLowerCase()));
      if (!c || n.isArchived || !section) continue; // content is null when the token can't see it (redacted); archived and unmapped items stay off
      if (c.__typename === "Issue") {
        const r = c.repository || {};
        if (c.state !== "OPEN" || (r.isPrivate && r.nameWithOwner !== repo)) continue; // closed, or from a private repo that isn't this one
        const title = tidy(c.title, false), mine = r.nameWithOwner === repo && Number.isInteger(c.number);
        if (title) out[section].push(mine ? issue(c) : { title, ref: null, url: null });
      } else if (c.__typename === "DraftIssue" && tidy(c.title, false)) out[section].push({ title: tidy(c.title, false), ref: null, url: null });
    }
  }
  return { sections: out, warnings };
}

// ---- git and gh (read-only here, except the PR flow) ------------------------------------------------------------------------------------
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
const tryGit = (repo, ...a) => { try { return git(repo, ...a); } catch { return null; } };
export function repoUrlOf(K) { const r = K?.issue?.repo; return r && /^[\w.-]+\/[\w.-]+$/.test(r) ? `https://github.com/${r}` : null; }
function mergedPrs(K, days) {
  if (!K?.issue?.repo || process.env.NOSY_OFFLINE) return [];
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  try { return JSON.parse(execFileSync("gh", ["pr", "list", "-R", K.issue.repo, "--state", "merged", "--search", `merged:>=${since}`, "--limit", "50", "--json", "number,title,mergedAt"], { encoding: "utf8", maxBuffer: 16 << 20, stdio: ["ignore", "pipe", "ignore"] })); } catch { return []; }
}
function tagList(repo) {
  const raw = tryGit(repo, "for-each-ref", "--sort=-creatordate", "--format=%(refname:short)\t%(creatordate:iso-strict)", "refs/tags");
  return (raw || "").split("\n").filter(Boolean).map(l => { const [name, date] = l.split("\t"); return { name, date }; });
}

// The privacy scan over the block and the JSON (the same scan `publish` runs): a secret or personal data stops it.
export function scan(block, pm, json = null) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nosy-roadmap-"));
  try {
    fs.writeFileSync(path.join(tmp, "roadmap.md"), block); if (json != null) fs.writeFileSync(path.join(tmp, "roadmap.json"), json);
    const r = spawnSync(process.execPath, [path.join(Tool, "privacy-scan.mjs"), "roadmap.md", ...(json != null ? ["roadmap.json"] : []), "--pm", path.resolve(pm)], { encoding: "utf8", cwd: tmp });
    return { ok: r.status === 0, status: r.status, output: (r.stdout || r.stderr || "").trim() };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

export function build(pm, { now = Date.now(), lang = null, gh = null } = {}) {
  const K = readSourcesSafe(pm) || {}, cfg = configOf(K), waves = readJson(path.join(pm, "state", "waves.json")), warnings = [];
  if (cfg.badSource) warnings.push(`Psst… roadmap.source "${cfg.badSource}" isn't evidence, github or both; using evidence.`);
  const curated = cfg.source === "evidence" ? null : readGithub(K, cfg, gh ? { gh } : {});
  if (curated) warnings.push(...curated.warnings);
  if (!curated?.sections && !waves?.waves) return { error: `No ${path.join(pm, "state", "waves.json")}: run scoop first (the roadmap is built from its waves).`, warnings };
  const repo = path.resolve(K.repo || "."), repoUrl = repoUrlOf(K), source = curated?.sections ? cfg.source : "evidence", P = phrases(lang || K.language, w => warnings.push(w));
  const m = model({ waves, cfg, repoUrl, merged: mergedPrs(K, cfg.shipped.days), tags: tagList(repo), now, curated: curated?.sections || null });
  const day = localDayOf(now), block = render(m, { day, P, source }), json = jsonOf(m, { now, path: cfg.path });
  return { K, cfg, repo, m, day, block, json, now, source, warnings, notes: curated && !curated.sections ? curated.warnings.map(w => w.replace(/^Psst… /, "")) : [] };
}

// The PR flow, in a throwaway worktree so the owner's checkout (and their uncommitted work) is never touched. The branch is pushed straight from a
// detached worktree: no local branch is left behind. An open PR from an earlier run (head `nosy/roadmap-*`, still on origin) is updated: the branch
// is rebuilt as ONE commit on the current base and pushed with --force-with-lease against the head Nosy just fetched. Nobody's PR is ever closed.
export function openPr(pm, B, { yes = false, gh: ghFn = null } = {}) {
  if (!yes) return { ok: false, needsYes: true, message: "Opening a PR pushes a branch and opens a pull request in your repo. Say yes, then run it again with --yes." };
  const { K, cfg, repo, block, day } = B, top = tryGit(repo, "rev-parse", "--show-toplevel")?.trim();
  if (!top) return { ok: false, message: `${repo} isn't a git repo.` };
  const base = String(K.integrationBranch || K.ref || "main").replace(/^origin\//, ""), ghRepo = K.issue?.repo ? ["-R", K.issue.repo] : [];
  const gh = (a, cwd = top) => (ghFn || (x => execFileSync("gh", x, { encoding: "utf8", cwd, maxBuffer: 16 << 20, stdio: ["ignore", "pipe", "pipe"] })))(a);
  if (!tryGit(top, "remote", "get-url", "origin")) return { ok: false, message: "This repo has no `origin` remote, so there's nowhere to open a PR. `nosy roadmap` (no flags) writes the block to pm/state/roadmap.md instead." };
  if (tryGit(top, "fetch", "-q", "origin", base) === null) return { ok: false, message: `Couldn't fetch origin/${base}. Check the remote and the branch name (sources.json integrationBranch or ref).` };
  const baseRef = `origin/${base}`, rel = cfg.path.replace(/^\/+/, ""), old = tryGit(top, "show", `${baseRef}:${rel}`);
  const ch = changes(blockOf(old), block), title = `Roadmap: update from Nosy (${day})`;
  let open;
  try { open = JSON.parse(gh(["pr", "list", "--state", "open", "--json", "number,headRefName,url", "--limit", "100", ...ghRepo])); }
  catch (e) { return { ok: false, message: `Stopped: couldn't ask GitHub for the open pull requests (${firstLine(e)}), so Nosy can't tell whether a roadmap PR is already open. Nothing was pushed.` }; }
  const prev = (Array.isArray(open) ? open : []).filter(p => p && /^nosy\/roadmap-/.test(p.headRefName) && tryGit(top, "ls-remote", "--exit-code", "--heads", "origin", p.headRefName) !== null).sort((a, b) => b.number - a.number)[0];
  if (blockOf(old) && nothing(ch)) return { ok: true, noChange: true, url: prev?.url || null, message: prev ? `${rel} on ${baseRef} already has this roadmap, so ${prev.url} is now empty. Nosy never closes a PR: close it when you like.` : `${rel} on ${baseRef} already has this roadmap: no PR.` };

  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "nosy-roadmap-wt-")); let branch = prev?.headRefName, lease = null;
  try {
    if (prev) {
      git(top, "fetch", "-q", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`);
      lease = git(top, "rev-parse", `refs/remotes/origin/${branch}`).trim();
      const there = tryGit(top, "show", `origin/${branch}:${rel}`), current = tryGit(top, "merge-base", "--is-ancestor", baseRef, `origin/${branch}`) !== null;
      if (current && blockOf(there) && nothing(changes(blockOf(there), block))) return { ok: true, noChange: true, url: prev.url, message: `${prev.url} already has this roadmap: nothing to update.` };
    } else {
      branch = `nosy/roadmap-${day}`;
      for (let n = 2; tryGit(top, "ls-remote", "--exit-code", "--heads", "origin", branch) !== null; n++) branch = `nosy/roadmap-${day}-${n}`;
    }
    git(top, "worktree", "add", "-q", "--detach", wt, baseRef);
    fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true }); fs.writeFileSync(path.join(wt, rel), splice(old, block));
    git(wt, "add", "--", rel);
    git(wt, "commit", "-q", "-m", title, "-m", `Changes the block between ${HEAD} and ${FOOT} in ${rel} only.`);
    git(wt, "push", "-q", ...(prev ? [`--force-with-lease=refs/heads/${branch}:${lease}`] : []), "origin", `HEAD:refs/heads/${branch}`);
    const body = bodyOf(ch, day, B.notes || []);
    if (prev) {
      let fresh = ""; try { gh(["pr", "edit", String(prev.number), "--title", title, "--body", body, ...ghRepo], wt); } catch (e) { fresh = ` (its title and description weren't refreshed: ${firstLine(e)})`; }
      return { ok: true, updated: true, branch, url: prev.url, changes: ch, message: `Updated ${prev.url}${fresh}` };
    }
    const out = gh(["pr", "create", "--base", base, "--head", branch, "--title", title, "--body", body, ...ghRepo], wt), url = String(out).trim().split("\n").pop();
    return { ok: true, branch, url, changes: ch, message: `Opened ${url}` };
  } catch (e) {
    return { ok: false, branch, message: `Stopped: ${firstLine(e)}. The branch ${branch} may exist on origin; your checkout is unchanged.` };
  } finally { try { git(top, "worktree", "remove", "--force", wt); } catch { fs.rmSync(wt, { recursive: true, force: true }); } }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; }, flag = k => { const i = argv.indexOf(k); if (i >= 0) argv.splice(i, 1); return i >= 0; };
  const pathArg = take("--path"), jsonOut = take("--json"), lang = take("--lang"), check = flag("--check"), write = take("--write"), pr = flag("--pr"), yes = flag("--yes"), allow = flag("--allow-sensitive");
  const pm = argv[0] || "pm", B = build(pm, { lang });
  for (const w of B.warnings || []) console.error(w);
  if (B.error) { console.error(`Psst… ${B.error}`); process.exit(1); }
  if (pathArg) { B.cfg.path = pathArg; B.json.path = pathArg; }
  const jsonText = JSON.stringify(B.json, null, 1) + "\n", S = scan(B.block, pm, jsonText);
  if (!S.ok && !allow) { console.error(`Psst… the privacy scan found something in the roadmap text; nothing was written.\n${S.output}\nFix the item's title, or (only if you've read the list and it is fine) run again with --allow-sensitive.`); process.exit(2); }
  fs.mkdirSync(path.join(pm, "state"), { recursive: true }); fs.writeFileSync(path.join(pm, "state", "roadmap.md"), B.block + "\n"); fs.writeFileSync(path.join(pm, "state", "roadmap.json"), jsonText);
  if (jsonOut) fs.writeFileSync(jsonOut, jsonText);
  const hid = B.m.hidden.now + B.m.hidden.next + B.m.hidden.later;
  const counts = `${B.m.now.length} now, ${B.m.next.length} next, ${B.m.later.length} later, ${B.m.shipped.length} shipped${hid ? ` (${hid} more not shown: the max in sources.json)` : ""}`;
  if (write) {
    const top = path.resolve(tryGit(B.repo, "rev-parse", "--show-toplevel")?.trim() || B.repo), file = path.resolve(top, String(write).replace(/^\/+/, ""));
    if (file !== top && !file.startsWith(top + path.sep)) { console.error(`Psst… ${write} points outside the repo; nothing was written.`); process.exit(1); }
    const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, splice(old, B.block));
    console.log(`Wrote the block into ${path.relative(process.cwd(), file) || file} (${counts}). Nothing is committed or pushed: read the file, then commit it like any other change.`); process.exit(0);
  }
  if (check) {
    const base = String(B.K.integrationBranch || B.K.ref || "main").replace(/^origin\//, ""), top = tryGit(B.repo, "rev-parse", "--show-toplevel")?.trim() || B.repo;
    const there = tryGit(top, "show", `origin/${base}:${B.cfg.path}`) ?? tryGit(top, "show", `${base}:${B.cfg.path}`), ch = changes(blockOf(there), B.block);
    const stale = !blockOf(there) || ch.added.length + ch.removed.length + ch.moved.length > 0;
    console.log(!blockOf(there) ? `${B.cfg.path} has no Nosy roadmap block on ${base} yet (${counts}).` : stale ? `${B.cfg.path} on ${base} is behind: ${ch.added.length} to add, ${ch.removed.length} to remove, ${ch.moved.length} moved.` : `${B.cfg.path} on ${base} is current (${counts}).`);
    process.exit(stale ? 2 : 0);
  }
  if (pr) {
    const R = openPr(pm, B, { yes });
    console.log(R.message); process.exit(R.ok ? 0 : 1);
  }
  console.log(`${B.block}\n\n${counts}. Preview at ${path.join(pm, "state", "roadmap.md")} (and roadmap.json beside it). \`${nosyCommand("roadmap --pr --yes")}\` proposes it as a PR on ${B.cfg.path} (nothing is pushed without --yes).`);
}
