// "Rivals this week": the box on the decision page that says what rivals did lately (BlogFactory field test: the page builder had no input for it, so the
// text was written into the HTML by hand, and a hand edit is lost the next time the page is built). The research writes this file; the page draws it.
//   pm/state/rivals-this-week.json   { "generated": "ISO time", "window": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
//       "items": [ { "rival": "<name>", "text": "<one line>", "url": "<where it was published>", "date": "YYYY-MM-DD",
//                    "delivery": "shipped" | "announced" } ], "nothing": false }
//   Every item needs its source and its day: a line without them is dropped, and counted, never drawn (an unsourced line on the page is a rumour).
//   "shipped" only for something usable today (the neighbor rule); the default is "announced". `nothing: true` with no items says "nothing new" on purpose,
//   which is different from a missing file: it carries the window it was checked over.
// Usage: node rivals-week.mjs <pm> [--json]        reads the file and says what the page will show; exit 0 ok · 2 some lines were dropped · 1 no file / unreadable
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { readSourcesSafe } from "./sources-file.mjs";

export const FILE = "rivals-this-week.json";
const MAX_ITEMS = 12, MAX_TEXT = 220;
const day = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? String(s) : null;
const httpUrl = u => { try { const x = new URL(String(u).trim()); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };

// What the page draws, and what was left out and why.
export function load(pm) {
  let raw; try { raw = JSON.parse(fs.readFileSync(path.join(pm, "state", FILE), "utf8").replace(/^﻿/, "")); } catch (e) { return fs.existsSync(path.join(pm, "state", FILE)) ? { error: `${FILE} isn't valid JSON (${String(e.message).split("\n")[0]})` } : null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: `${FILE} isn't a JSON object` };
  const known = new Set(); const K = readSourcesSafe(pm); for (const [slug, r] of Object.entries((K && K.rivals) || {})) { known.add(slug.toLowerCase()); if (r && r.name) known.add(String(r.name).toLowerCase()); }
  const items = [], dropped = [];
  for (const [i, it] of (Array.isArray(raw.items) ? raw.items : []).entries()) {
    const text = String(it?.text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT), rival = String(it?.rival ?? "").trim(), url = httpUrl(it?.url), d = day(it?.date);
    const why = !rival ? "no rival named" : !text ? "no text" : !url ? "no source address" : !d ? "no date (YYYY-MM-DD)" : null;
    if (why) { dropped.push({ index: i, rival: rival || null, why }); continue; }
    items.push({ rival, text, url, date: d, delivery: it.delivery === "shipped" ? "shipped" : "announced", ...(known.size && !known.has(rival.toLowerCase()) ? { unknownRival: true } : {}) });
  }
  items.sort((a, b) => b.date.localeCompare(a.date));
  const w = raw.window && typeof raw.window === "object" ? { from: day(raw.window.from), to: day(raw.window.to) } : { from: null, to: null };
  return { generated: raw.generated || null, window: w, nothing: raw.nothing === true && !items.length, items: items.slice(0, MAX_ITEMS), more: Math.max(0, items.length - MAX_ITEMS), dropped };
}

export function render(R) {
  if (!R) return "No rivals-this-week file yet: the neighbors step writes pm/state/rivals-this-week.json.";
  if (R.error) return R.error;
  const L = [`Rivals this week${R.window.from || R.window.to ? ` · ${R.window.from || "?"} to ${R.window.to || "?"}` : ""}: ${R.items.length} line${R.items.length === 1 ? "" : "s"}${R.nothing ? " (checked: nothing new)" : ""}${R.dropped.length ? `, ${R.dropped.length} left out` : ""}.`];
  for (const x of R.items) L.push(`- ${x.rival}: ${x.text} (${x.delivery}, ${x.date}, ${x.url})`);
  for (const d of R.dropped) L.push(`✗ item ${d.index + 1}${d.rival ? ` (${d.rival})` : ""}: ${d.why}`);
  return L.join("\n");
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), asJson = argv.includes("--json"), pm = argv.find(a => !a.startsWith("--")) || "pm";
  const R = load(pm);
  console.log(asJson ? JSON.stringify(R, null, 1) : render(R));
  process.exitCode = !R || R.error ? 1 : R.dropped.length ? 2 : 0;
}
