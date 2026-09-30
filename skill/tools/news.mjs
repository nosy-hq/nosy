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

const Tool = path.dirname(fileURLToPath(import.meta.url));
const read = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

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
  line.push("", process.env.NOSY_PAGE_URL ? `Page: ${process.env.NOSY_PAGE_URL}` : "Detail: pm/page.html · nosy shipped · nosy score");
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
