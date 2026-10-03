#!/usr/bin/env node
// board-status: the week, posted as a status update on the GitHub Projects board the roadmap reads (the line at the top of the board).
// Titles and counts only, taken from that board and the pull requests merged in the window; no reasons, no names, no customers, no rivals.
// Shown first; posted only with --yes.
// Usage: node board-status.mjs <pm folder> [--days N=7] [--status on-track|at-risk|off-track|inactive|complete] [--lang tr] [--yes] [--json <file>]
// Board: `roadmap.project` in sources.json ({ owner, number, type, field }): the same board `nosy roadmap` reads. Nothing is posted without it.
// Status: on-track / at-risk / off-track is a judgment, so it is the owner's: without --status the update has no status. Nothing is guessed.
// Once a week: the body ends in `<!-- nosy:board-status YYYY-Www -->`; if an update with that marker is already on the board it posts nothing and
//   says so (it never edits or deletes an update). A second look at the same week is a preview.
// Reads: what `nosy roadmap` reads (the board's cards, merged PRs, release tags) plus the GitHub releases of the window (a project that ships by release) and, with --yes, the board's id and its latest status updates.
// Writes (only with --yes): one `createProjectV2StatusUpdate` mutation (needs the `project` scope). Nothing else, and nothing in your repo.
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build, configOf, readGithub } from "./roadmap.mjs";
import { readSourcesSafe } from "./sources-file.mjs";
import { advice } from "./hints.mjs";

const Tool = path.dirname(fileURLToPath(import.meta.url));
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const fill = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
export const STATUSES = { "on-track": "ON_TRACK", "at-risk": "AT_RISK", "off-track": "OFF_TRACK", inactive: "INACTIVE", complete: "COMPLETE" };
export const MARKER = week => `<!-- nosy:board-status ${week} -->`;

const phraseFile = code => readJson(fileURLToPath(new URL(`../data/lang/${code}/board-status.json`, import.meta.url)));
const warned = new Set();
export function phrases(lang) {
  const code = String(lang || "en").trim().toLowerCase().split(/[-_]/)[0];
  const P = /^[a-z]{2,3}$/.test(code) ? phraseFile(code) : null;
  if (P) return P;
  if (!warned.has(code)) { warned.add(code); console.error(`board-status: no phrases for language "${lang}" yet (skill/data/lang/${code}/board-status.json); using English`); }
  return phraseFile("en");
}

// "2026-W40": the ISO week a date falls in (weeks start on Monday; the week belongs to the year of its Thursday).
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())), day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear(), week = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
}

const line = it => `- ${String(it.title).replace(/\s+/g, " ").trim()}${it.ref && it.url ? ` ([${it.ref}](${it.url}))` : it.ref ? ` (${it.ref})` : it.url ? ` ([release](${it.url}))` : ""}`;
// The whole body, from the roadmap model (`m`: now / next / later / shipped[{ title, ref, url, date }]). Pure.
// `releases` are GitHub releases published in the window ({ title, url, date }): a project that ships by release rather than by pull request has shipped too.
export function bodyOf(m, { now = Date.now(), days = 7, lang, releases = [] } = {}) {
  const P = phrases(lang), from = new Date(now - days * 864e5), day = d => d.toISOString().slice(0, 10), week = isoWeek(new Date(now));
  const shipped = [...(m.shipped || []), ...releases.map(r => ({ title: r.title, ref: null, url: r.url, date: r.date }))].filter(s => String(s.date) >= day(from)).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5);
  const up = [...(m.now || []), ...(m.next || [])].slice(0, 3);
  const L = [`**${fill(P.week, { week, from: day(from), to: day(new Date(now)) })}**`, "", `**${P.shipped}**`, ...(shipped.length ? shipped.map(line) : [P.nothing]), "",
    `**${P.board}** ${fill(P.counts, { now: (m.now || []).length + (m.hidden?.now || 0), next: (m.next || []).length + (m.hidden?.next || 0), later: (m.later || []).length + (m.hidden?.later || 0) })}`];
  if (up.length) L.push("", `**${P.up}**`, ...up.map(line));
  L.push("", `<sub>${P.footer}</sub>`, MARKER(week));
  return { body: L.join("\n") + "\n", week, from: day(from), to: day(new Date(now)), shipped: shipped.length };
}

function main() {
  const argv = process.argv.slice(2);
  const al = f => { const i = argv.indexOf(f); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
  const flag = f => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
  const daysArg = al("--days"), statusArg = al("--status"), lang = al("--lang"), jsonOut = al("--json"), yes = flag("--yes");
  const [pm = "pm"] = argv.filter(a => !a.startsWith("--"));
  const stop = (msg, code = 1) => { console.error(`Psst… ${msg}`); process.exit(code); };
  const days = daysArg === undefined ? 7 : +daysArg;
  if (!(days > 0 && days <= 90)) stop(`--days wants a number of days from 1 to 90, got "${daysArg}".`);
  if (statusArg !== undefined && !STATUSES[statusArg.toLowerCase()]) stop(`--status is one of ${Object.keys(STATUSES).join(", ")}; got "${statusArg}". It is the owner's call, so it is never picked for you.`);

  // The board first: with none named there is nothing to build for.
  if (!configOf(readSourcesSafe(pm) || {}).project) stop("board-status posts to the board named in `roadmap.project` in pm/sources.json ({ owner, number, type }); none is set. Nothing was posted.");
  const B = build(pm, { lang });
  if (B.error) stop(B.error);
  const P = B.cfg.project;
  // GitHub releases in the window (read-only; a failure or no gh just means none).
  let releases = [];
  if (B.K.issue?.repo && !process.env.NOSY_OFFLINE) {
    const r = spawnSync("gh", ["release", "list", "-R", B.K.issue.repo, "--limit", "10", "--json", "name,tagName,publishedAt"], { encoding: "utf8" });
    try { if (r.status === 0) releases = JSON.parse(r.stdout).filter(x => !x.isDraft && x.publishedAt).map(x => ({ title: String(x.name || x.tagName), url: `https://github.com/${B.K.issue.repo}/releases/tag/${encodeURIComponent(x.tagName)}`, date: String(x.publishedAt).slice(0, 10) })); } catch {}
  }
  // "On the board" is the board's own cards: the roadmap model may also hold items from the evidence (`roadmap.source: "both"`), which are not on it.
  const live = readGithub(B.K, { ...B.cfg, source: "github" }), skip = t => B.cfg.skip.some(s => String(t.title).toLowerCase().includes(s));
  const onBoard = Object.fromEntries(["now", "next", "later"].map(k => [k, (live.sections?.[k] || []).filter(t => !skip(t))]));
  const { body, week, from, to, shipped } = bodyOf({ ...onBoard, hidden: {}, shipped: B.m.shipped }, { days, lang: lang || B.K.language, releases });
  const status = statusArg ? STATUSES[statusArg.toLowerCase()] : null;

  const scanDir = fs.mkdtempSync(path.join(os.tmpdir(), "nosy-board-status-")); fs.writeFileSync(path.join(scanDir, "status.md"), body);
  const scan = spawnSync(process.execPath, [path.join(Tool, "privacy-scan.mjs"), "status.md", "--pm", path.resolve(pm)], { encoding: "utf8", cwd: scanDir }); fs.rmSync(scanDir, { recursive: true, force: true });
  if (scan.status === 2) stop(`the privacy scan found something in the status text; nothing was posted.\n${scan.stdout}\nFix the item's title at its source.`, 2);

  const root = P.type === "user" ? "user" : "organization";
  const gh = (args, input) => spawnSync("gh", args, { encoding: "utf8", input });
  const fail = (what, r) => { const t = `${r.stderr || ""}${r.error?.message || ""}`; stop(`couldn't ${what}: ${t.trim().split("\n")[0].slice(0, 150)}\n${advice(t) || "Check that gh is signed in with a token that can write projects for this owner."} Nothing was posted.`); };
  const known = () => {
    const r = gh(["api", "graphql", "-f", `query=query($o:String!,$n:Int!){ ${root}(login:$o){ projectV2(number:$n){ id statusUpdates(first:10){ nodes{ body } } } } }`, "-f", `o=${P.owner}`, "-F", `n=${P.number}`]);
    if (r.status !== 0) return fail(`read the board ${P.owner}/${P.number}`, r);
    const board = JSON.parse(r.stdout).data?.[root]?.projectV2;
    if (!board) stop(`no ${P.type} project #${P.number} for "${P.owner}" was found, or the token can't see it. Nothing was posted.`);
    return { id: board.id, posted: (board.statusUpdates?.nodes || []).some(n => String(n.body || "").includes(MARKER(week))) };
  };

  let o = `# Board status · ${P.owner}/${P.number} · ${week}\n\n- Window: ${from} to ${to} (${days} days)\n- Status: ${status ? status.toLowerCase().replace("_", " ") : "not set (it is a judgment: add --status on-track|at-risk|off-track|inactive|complete)"}\n- Shipped in the window: ${shipped}\n\n---\n${body}---\n\n`;
  if (jsonOut) { fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify({ type: "boardStatus", generated: new Date().toISOString(), board: `${P.owner}/${P.number}`, week, status, body }, null, 1) + "\n"); }
  if (!yes) { process.stdout.write(o + "Nothing was posted. Add `--yes` to post exactly this.\n"); return; }

  const sc = gh(["api", "-i", "user"]), scopes = (/^x-oauth-scopes:[ \t]*(.*)$/im.exec(sc.stdout || "") || [])[1];
  if (scopes !== undefined && !/(^|[\s,])project([\s,]|$)/.test(scopes)) stop(`posting to the board needs the \`project\` scope (this token has: ${scopes.trim() || "none"}). Run \`gh auth refresh -s project\`, then again. Nothing was posted.`);
  process.stdout.write(o);
  const b = known();
  if (b.posted) { console.log(`Nothing to post: the board already has this week's update (${week}). Updates are never edited.`); return; }
  const args = ["api", "graphql", "-f", "query=mutation($p:ID!,$b:String!,$s:ProjectV2StatusUpdateStatus,$sd:Date,$td:Date){ createProjectV2StatusUpdate(input:{projectId:$p,body:$b,status:$s,startDate:$sd,targetDate:$td}){ statusUpdate{ id } } }",
    "-f", `p=${b.id}`, "-f", `b=${body}`, "-f", `sd=${from}`, "-f", `td=${to}`, ...(status ? ["-f", `s=${status}`] : [])];
  const r = gh(args); if (r.status !== 0) return fail("post the status update", r);
  console.log(`Posted the ${week} update on ${P.owner}/${P.number}.`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
