// The week's "Psst…" message: builds and sends the short text that goes to Slack and Discord from pm/state/ outputs
// (wave 4a: speaks only, doesn't read chat). This is the developer → marketing bridge, the "Can be announced" section:
// it comes from git, not from chat.
// Used by: nosy.mjs notify. privacy-scan.mjs runs before sending; a secret or personal data (e-mail, phone, IBAN, card,
// ID number, a name from private.json or one of your commit authors) stops the message ("Never your data"), unless
// `nosy notify --allow-sensitive` is given.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { authorNames } from "./publish-safe.mjs";
import { pagePath } from "./page-path.mjs"; import { readSourcesSafe } from "./sources-file.mjs";

const Tool = path.dirname(fileURLToPath(import.meta.url));
const read = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

// The quiet digest (two optional files, written by other commands; no file, or a shape that isn't this one, adds nothing):
// pm/state/rival-signals.json { rivals: [{ name, signals: [{ label, value, previous, since }] }] }: a rival whose public signal moved by
//   10% or 5 units (previous must be a number), each rival at most once with its biggest move, biggest relative move first, 3 at most.
// pm/state/roadmap.json { generated, sections: { now, next, later, shipped } }: the counts only, and whether the file is behind.
const num = x => (typeof x === "number" && Number.isFinite(x) ? x : null);
const clip = (x, n) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, n);
export function rivalLines(pm, { max = 3 } = {}) {
  const best = new Map(); // rival name (any case) -> its biggest qualifying move
  for (const r of read(path.join(pm, "state", "rival-signals.json"))?.rivals || []) {
    const rival = clip(r?.name, 40); if (!rival) continue;
    for (const g of Array.isArray(r.signals) ? r.signals : []) {
      const value = num(g?.value), previous = num(g?.previous), label = clip(g?.label, 40);
      if (value === null || previous === null || !label) continue;
      const change = value - previous, abs = Math.abs(change), rel = previous === 0 ? Infinity : abs / Math.abs(previous);
      if (abs < 5 && rel < 0.1) continue;
      const have = best.get(rival.toLowerCase());
      if (!have || rel > have.rel || (rel === have.rel && abs > have.abs)) best.set(rival.toLowerCase(), { rival, label, value, previous, change, abs, rel, since: clip(g.since, 10) });
    }
  }
  return [...best.values()].sort((a, b) => b.rel - a.rel || b.abs - a.abs).slice(0, max).map(m => {
    const pct = m.previous === 0 ? "" : ` (${m.change > 0 ? "+" : "-"}${Math.round(m.rel * 100)}%)`;
    return `• ${m.rival}: ${m.label} ${m.previous} → ${m.value}${pct}${m.since ? `, since ${m.since}` : ""}`;
  });
}
// "Roadmap: 3 now, 2 next, 5 later, 4 shipped lately", then whether the file is behind: older than two weeks, or something merged after it
// was generated (pm/state/shipped.json's recent merges). "" when there is no roadmap file. `merged` is the dates of recent merges.
export function roadmapLine(pm, { merged = [], now = Date.now() } = {}) {
  const R = read(path.join(pm, "state", "roadmap.json")), S = R?.sections;
  if (!S || typeof S !== "object") return { line: "", behind: false };
  const n = x => (Array.isArray(x) ? x.length : num(x) ?? 0);
  const at = Date.parse(R.generated || ""), counts = `${n(S.now)} now, ${n(S.next)} next, ${n(S.later)} later, ${n(S.shipped)} shipped lately`;
  if (isNaN(at)) return { line: `Roadmap: ${counts} (behind: no date on the file)`, behind: true };
  const after = merged.filter(d => /^\d{4}-\d{2}-\d{2}/.test(d || "") && d.slice(0, 10) > new Date(at).toISOString().slice(0, 10)).length, age = Math.floor((now - at) / 864e5);
  const why = after ? `${after} merge${after === 1 ? "" : "s"} since it was generated` : age > 14 ? `generated ${age} days ago` : "";
  return { line: `Roadmap: ${counts} (${why ? `behind: ${why}` : "current"})`, behind: !!why };
}

export function messageSetup(pm, { notes = null, enExcess = 3 } = {}) {
  const d = read(path.join(pm, "state", "status.json")), l = read(path.join(pm, "state", "lowhanging.json")), n = notes && read(notes);
  const rc = read(path.join(pm, "state", "shipped.json"))?.recent, sc = read(path.join(pm, "state", "score.json"));
  const line = [];
  if (d) line.push(`👀 Psst… ${d.main ?? 0} commits landed on main this week, ${d.pr ?? 0} on open PRs.`);
  // What merged and what's close (recent, N2), then bets (score, N3) when there are any.
  if (rc?.merged?.length) { line.push("", "*Merged since last time:*"); for (const m of rc.merged.slice(0, 5)) line.push(`• #${m.n} ${m.title}${m.ref ? ` — for ${m.ref}` : ""}`); }
  if (rc?.close?.length) { line.push("", "*Close to merging:*"); for (const m of rc.close.slice(0, 3)) line.push(`• #${m.n} ${m.title}${m.ref ? ` — for ${m.ref}` : ""}`); }
  const weekAgo = Date.now() - 7 * 864e5, bets = (sc?.bets || []).filter(b => b.origin !== "backfill");
  const landed = bets.filter(b => b.landed && Date.parse(b.landed) >= weekAgo), late = bets.filter(b => b.openTooLong);
  if (landed.length || late.length) { line.push("", "*Bets:*");
    for (const b of landed) line.push(`• ${b.bet} landed ${b.landed} — estimated ${b.estimate}, took ${b.actual}${b.status === "reverted" ? " (reverted)" : ""}`);
    for (const b of late.slice(0, 3)) line.push(`• ${b.bet} — open longer than 2× its ${b.estimate} estimate`); }
  // The quiet digest: rivals whose public signals moved (3 lines at most, a rival once), then one roadmap line. At most 5 lines in all, a
  // blank one included. Nothing moved, nothing said; the roadmap line alone never makes a message (unless the file is behind).
  const moved = rivalLines(pm), road = roadmapLine(pm, { merged: (rc?.merged || []).map(m => m.merged) });
  if (moved.length || road.behind || (road.line && line.length)) line.push(...(line.length ? [""] : []), ...moved, ...(road.line ? [road.line] : []));
  // psst's list only goes out if it ran this week, never a stale one.
  // What goes out is the checked list when psst's refuter ran on this list, else the raw list
  // minus anything the receipts hold on purpose: a held item must never be announced as "cheap this week".
  const F = read(path.join(pm, "state", "psst-final.json")), R = read(path.join(pm, "state", "receipts.json"));
  const held = new Set((R?.items || []).filter(r => r.gate?.held).map(r => r.title));
  const checked = F && l && Date.parse(F.generated || 0) >= Date.parse(l.generated || 0) && Date.parse(F.generated || 0) >= weekAgo;
  const fruit = checked ? (F.items || []).map(i => ({ ...i, type: i.verdict === "weakened" ? `checked, corrected: ${String(i.fix).slice(0, 60)}` : "checked against the code", effort: i.verdict === "weakened" ? null : i.size })).slice(0, enExcess)
    : l && Date.parse(l.generated || 0) >= weekAgo ? (l.items || []).filter(i => !held.has(i.title)).slice(0, enExcess) : [];
  if (fruit.length) {
    line.push("", "*Could ship today:*");
    for (const m of fruit) line.push(`• ${m.title}${m.effort ? ` (${m.effort})` : ""} — ${m.type}`);
  }
  const announcement = (n?.items || []).filter(m => m.toCustomer !== false && !m.text_required && m.title && m.class === "Fresh").slice(0, 5);
  if (announcement.length) {
    line.push("", "*Can be announced (for marketing):*");
    // The "(10 Eyl, Alex): " prefix on a title coming from a decision line doesn't go out.
    for (const m of announcement) line.push(`• ${m.title.replace(/^\([^)]*\):\s*/, "").replace(/\.+$/, "")}`);
  }
  if (!line.length) return "";
  // The page where the owner keeps it (sources.json `page`, product.md's Page line). The usual one keeps its short name; another one is named as it is.
  const where = (() => { const f = pagePath(pm, readSourcesSafe(pm)).path, rel = path.relative(pm, f); if (rel === "page.html") return "pm/page.html"; return rel && !rel.startsWith("..") ? `${path.basename(path.resolve(pm))}/${rel}` : path.relative(process.cwd(), f) || f; })();
  line.push("", process.env.NOSY_PAGE_URL ? `Page: ${process.env.NOSY_PAGE_URL}` : `Detail: ${where} · nosy shipped · nosy score`);
  return line.join("\n");
}

// Scans the message for secrets/personal data before it goes out. Returns true if clean (or if allow is set: the findings
// are still printed).
export function cleanMi(message, pm, { allow = false } = {}) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nosy-news-")), "message.md");
  fs.writeFileSync(f, message);
  const names = authorNames(pm);
  const r = spawnSync(process.execPath, [path.join(Tool, "privacy-scan.mjs"), f, "--pm", pm, ...(names.length ? ["--names", names.join(",")] : [])], { encoding: "utf8" });
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
  if (r.status !== 0) process.stderr.write(r.stdout || r.stderr || ""); // 2 = a finding, 1 = the scan couldn't run; either way, not clean
  return r.status === 0 || (allow && r.status === 2);
}

// A Slack incoming webhook expects {text}, Discord {content} (2000-char limit).
export async function send(name, url, message) {
  const body = name === "Discord" ? { content: message.replace(/^\*(.+)\*$/gm, "**$1**").slice(0, 1990) } : { text: message };
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return r.ok;
  } catch { return false; }
}

// Library, not a CLI: a misdirected `node news.mjs ...` would otherwise print nothing
// and exit 0. Callers are found at runtime by scanning skill/tools/*.mjs for an import of this file.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const self = "news.mjs";
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const callers = fs.readdirSync(dir).filter(f => f.endsWith(".mjs") && f !== self)
    .filter(f => { try { return new RegExp(`["']\\./${self}["']`).test(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return false; } }).sort();
  console.error(`${self} is a library used by ${callers.join(", ") || "no other tool"}; did you mean \`nosy notify\` or \`node skill/tools/nosy.mjs\`?`);
  process.exit(1);
}
