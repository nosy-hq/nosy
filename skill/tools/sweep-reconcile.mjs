// sweep-reconcile: does what the rival files say agree with what the sweep just read? (BlogFactory field test, 4 Oct 2026.) The deep research had LightCMS at 7.2.2 from
// July and the summary said only one rival had shipped lately, while the sweep of the rival's own release page listed five releases on 1 and 2 October. Both ran; nobody
// compared them. This does, with no model and no network: for each rival it takes the newest dated entry the sweep found (release notes, newsroom, blog, the App Store's current
// version) and the date in the rival file's "Latest major announcement" row. A rival whose newest entry is later than that row is "behind": the file may not say "nothing new"
// about it, and the next step is to open the entry and either update the row or say why it isn't a major announcement.
//   pm/state/rival-sweep.json (written by `nosy sweep`)  ×  pm/rivals/<slug>.md  →  pm/state/sweep-reconcile.json
// Dates are compared at the precision the file gives ("2026-07" means July, so an entry in July is not later; one in August is). A rival the sweep couldn't read is listed as
// "not compared" (never as agreeing); a rival with no dated entry in the window is "nothing found" (which the sweep's own page problems qualify).
// Usage: node sweep-reconcile.mjs <pm> [--json <file>]    Exit: 0 every rival read agrees · 2 at least one is behind, or none could be read · 1 no sweep file (run `nosy sweep` first)
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { readSourcesSafe, rivalsDir, rivalFiles, markdownSlug } from "./sources-file.mjs";

const isoPart = s => { const m = String(s || "").match(/\b(20\d\d)(?:-(\d{2})(?:-(\d{2}))?)?\b/); return m ? { y: m[1], m: m[2] || null, d: m[3] || null, text: m[0] } : null; };
// "Latest major announcement" row: `- **Latest major announcement:** 2026-07-14 — what, url · delivery: shipped`.
export function announcementDate(md) {
  const line = (md.match(/^[-*\s]*\*{0,2}Latest major announcement:?\*{0,2}:?\s*(.*)$/mi) || [])[1];
  return line ? isoPart(line.split(/\s[—–-]\s/)[0] || line) : null;
}
// Is `entry` (YYYY-MM-DD) later than what the file says, at the file's own precision?
export function laterThan(entry, A) {
  if (!A) return true; // a file with no date at all is behind any dated entry
  const e = isoPart(entry); if (!e) return false;
  if (A.d) return `${e.y}-${e.m}-${e.d}` > `${A.y}-${A.m}-${A.d}`;
  if (A.m) return `${e.y}-${e.m}` > `${A.y}-${A.m}`;
  return e.y > A.y;
}

export function reconcile(pm) {
  const sweepFile = path.join(pm, "state", "rival-sweep.json");
  let S; try { S = JSON.parse(fs.readFileSync(sweepFile, "utf8")); } catch { return null; }
  const K = readSourcesSafe(pm) || {}, dir = rivalsDir(pm, K), files = new Map(rivalFiles(dir, { nested: dir !== path.join(pm, "rivals") }).map(f => [markdownSlug(path.basename(f)), path.join(dir, f)]));
  const rivals = [];
  for (const R of S.rivals || []) {
    const file = files.get(R.slug), md = file ? (() => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } })() : "";
    const A = md ? announcementDate(md) : null;
    const pages = R.pages || [], unread = pages.filter(p => !p.ok && !p.quiet);
    const entries = pages.flatMap(p => (p.entries || []).map(e => ({ date: e.date, text: String(e.text || "").slice(0, 160), page: p.url, kind: p.kind }))).filter(e => isoPart(e.date)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const row = { slug: R.slug, name: R.name, file: file ? path.relative(pm, file) : null, fileSays: A ? A.text : null, newest: entries[0] || null, entriesInWindow: entries.length, unread: unread.map(p => p.url) };
    row.status = !file ? "no rival file" : !entries.length ? (unread.length ? "not compared (a page couldn't be read)" : "nothing found in the window") : laterThan(entries[0].date, A) ? "behind" : "agrees";
    rivals.push(row);
  }
  return { type: "sweepReconcile", generated: new Date().toISOString(), window: { from: S.from, to: S.to }, rivals, behind: rivals.filter(r => r.status === "behind").map(r => r.slug), compared: rivals.filter(r => r.status === "behind" || r.status === "agrees").length };
}

export function render(R) {
  if (!R) return "Psst… no pm/state/rival-sweep.json yet: run `nosy sweep` first.";
  const L = [`# Sweep vs rival files · ${R.window.from} – ${R.window.to}`, ""];
  for (const r of R.rivals) {
    if (r.status === "behind") L.push(`✗ ${r.name}: the file says ${r.fileSays || "no date"}, the sweep found ${r.newest.date} · ${r.newest.text} (${r.newest.page}). Open it and update the row, or say why it isn't a major announcement; the file may not say "nothing new".`);
    else L.push(`${r.status === "agrees" ? "✓" : "–"} ${r.name}: ${r.status}${r.status === "agrees" ? ` (file ${r.fileSays || "—"}, newest entry ${r.newest.date})` : r.unread.length ? ` — ${r.unread.join(", ")}` : ""}`);
  }
  L.push("", R.behind.length ? `${R.behind.length} rival file${R.behind.length === 1 ? " is" : "s are"} behind the sweep: ${R.behind.join(", ")}.` : !R.compared ? `None of the rivals could be read (${R.rivals.length ? "no dated entry compared with a rival file" : "the sweep lists no rivals"}), so nothing was checked: this is not agreement. Open the sweep's unread pages above, or run \`nosy sweep\` again.` : "Every rival the sweep could read agrees with its file.");
  return L.join("\n");
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), i = argv.indexOf("--json"), jsonOut = i >= 0 ? argv.splice(i, 2)[1] : null, pm = argv[0] || "pm";
  const R = reconcile(pm);
  if (R && jsonOut) { fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(R, null, 1)); }
  console.log(render(R));
  process.exitCode = !R ? 1 : R.behind.length || !R.compared ? 2 : 0; // exit 2 too when nothing at all was compared (like `watch`)
}
