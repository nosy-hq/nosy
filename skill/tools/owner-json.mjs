// A file the owner or a teammate keeps in pm/ (learned.json, canwe/ledger.json, design/approvals.json) that exists but doesn't parse is not an empty file. Three tools read
// such a file with `catch { return empty }` and then wrote the empty result back: one stray comma or a merge-conflict marker after a teammate's edit, and every learned rule,
// every recorded answer or every owner verdict was replaced by the one new entry (field-test hunt, 4 Oct 2026). Writers ask here first and stop.
import fs from "node:fs";

// null when the file is missing (start empty) or valid; else a short reason it can't be read.
export function damagedJson(file) {
  let text; try { text = fs.readFileSync(file, "utf8"); } catch (e) { return e.code === "ENOENT" ? null : `can't be read (${e.code || e.message})`; }
  try { JSON.parse(text.replace(/^﻿/, "")); return null; } catch (e) { return String(e.message).split("\n")[0]; }
}
// What to say, and where the damage is likely to be.
export const damagedMessage = (file, why) => `Psst… ${file} exists but isn't valid JSON (${why}). Nothing was changed: it is yours, and writing a new entry over it would lose what is in it. A trailing comma or a merge-conflict marker (<<<<<<<) is the usual cause: fix that spot, or move the file aside, then run this again.`;
// For a writer: stop the process with that message.
export function refuseDamaged(file) { const why = damagedJson(file); if (why) { console.error(damagedMessage(file, why)); process.exit(1); } }

// A bet or a to-do is a markdown file the owner may add to ("## Notes (owner)", a section, a table). Rendering it again from its fields erased those. What is kept: every
// `## ` section the tool doesn't write itself, verbatim, after what the tool renders. (`own`: the headings the tool writes, e.g. "Score".)
export function extraSections(oldMd, own = []) {
  const parts = String(oldMd || "").split(/^(?=## )/m).slice(1);
  return parts.filter(p => !own.some(h => new RegExp(`^## ${h}\\b`).test(p))).map(p => p.replace(/\s+$/, "")).join("\n\n");
}
export function withExtras(rendered, oldMd, own = []) {
  const extra = extraSections(oldMd, own);
  return extra ? `${rendered.replace(/\s+$/, "")}\n\n${extra}\n` : rendered;
}
