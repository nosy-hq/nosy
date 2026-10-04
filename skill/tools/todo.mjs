// todo: what only a person can do, or said they would do. An agent that reaches a step it can't take (an account, a
// payment, a submission under someone's name, a token, a sign-off) keeps going with the rest and files it here, so it
// doesn't live in a chat that ends. The list is kept in the repo, so every agent and every teammate sees the same one.
// Not a task tracker: no due dates, no estimates, no assignments by Nosy. `who` is the person's own word for themselves.
// Usage:
//   node todo.mjs <pm> add "<what>" [--who ali] [--why "<why only a person can>"] [--blocks "<what waits on it>"] [--link <url|ref>] [--date YYYY-MM-DD]
//   node todo.mjs <pm> list [--who ali] [--all] [--json <file>]
//   node todo.mjs <pm> show <id>
//   node todo.mjs <pm> done <id> [--note "<how it went>"] [--date YYYY-MM-DD]
//   node todo.mjs <pm> drop <id> --reason "<why it's no longer needed>"
// Files: pm/todo/<id>.md, one per item (human-editable, and a teammate's new item never conflicts with yours).
// An <id> can be the full id or any part of it that names one item. Nothing here is sent anywhere: `publish` sends counts only.
import { withExtras } from "./owner-json.mjs";
import { localDay, localDayOf } from "./today.mjs";
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { smallAscii } from "./text.mjs";

export const ID_RE = /\bnt-\d{6}-[a-z0-9]+(?:-[a-z0-9]+){0,2}\b/;
const STATUSES = ["open", "done", "dropped"];
const SLUG_STOP = new Set("a an the and or of for to in on with by from at is are be as it this that we our my your add adds make let lets can".split(" "));
const FIELDS = [["todo", "Todo"], ["who", "Who"], ["why", "Why"], ["blocks", "Blocks"], ["link", "Link"], ["added", "Added"], ["status", "Status"], ["done", "Done"], ["note", "Note"], ["dropReason", "Dropped because"]];
const line = (s, n = 300) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const norm = s => smallAscii(s).replace(/[^a-z0-9]+/g, " ").trim();
const who = s => line(s, 40).replace(/^@+/, "") || "owner";
const same = (a, b) => smallAscii(a) === smallAscii(b);

// nt-<yyMMdd>-<slug of up to 3 words>, unique within pm/todo/.
export function todoId(what, date, taken = new Set()) {
  const d = String(date).slice(2, 10).replace(/-/g, "");
  const ws = norm(what).split(" ").filter(w => w && !SLUG_STOP.has(w)).slice(0, 3);
  const base = `nt-${d}-${(ws.length ? ws : ["todo"]).join("-")}`;
  let id = base, n = 2; while (taken.has(id)) id = `${base}-${n++}`;
  return id.length > 60 ? id.slice(0, 60).replace(/-+$/, "") : id;
}

export function todoRender(t) {
  let o = `# Todo ${t.id}\n\n`;
  for (const [k, label] of FIELDS) {
    if (k === "dropReason" && !t.dropReason) continue;
    if ((k === "done" || k === "note") && t.status === "open") continue;
    o += `- **${label}:** ${t[k] || "—"}\n`;
  }
  if (t.status === "open") o += `\nWhen it's done: \`nosy todo done ${t.id}\`. Any teammate or agent can read this file; only a person does the work.\n`;
  return o;
}

// Reads the files `nosy todo` writes and the ones a person writes by hand: the label may be bold or plain, in either colon form, in any case
// ("- **Status:** Done", "**Status**: done", "Status: DONE"); a file with no "Todo" line takes its first heading as the title.
export function todoParse(md, file = "") {
  const id = (md.match(/^# Todo (\S+)/m) || [])[1] || path.basename(file, ".md");
  const t = { id };
  for (const [k, label] of FIELDS) { const m = md.match(new RegExp(`^[ \\t]*(?:[-*][ \\t]+)?(?:\\*\\*)?${label}(?::\\*\\*|\\*\\*:|:)[ \\t]*(.*)$`, "im")); const v = m?.[1].replace(/\*+$/, "").trim(); t[k] = v && v !== "—" ? v : null; }
  if (!t.todo) { const h = (md.match(/^# (?!Todo \S+\s*$)(.+)$/m) || [])[1]; t.todo = h ? h.trim() : id; }
  t.status = String(t.status || "").toLowerCase(); t.status = STATUSES.includes(t.status) ? t.status : "open";
  t.who = t.who || "owner";
  return t;
}

// Every .md file in pm/todo/ is an item (a README or a file starting with "_" or "." is not): a hand-written one is as good as one `add` wrote.
export function todoLoad(pm) {
  const dir = path.join(pm, "todo"); if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /\.md$/i.test(f) && !/^[._]|^readme\.md$/i.test(f)).sort().map(f => todoParse(fs.readFileSync(path.join(dir, f), "utf8"), f));
}
export function todoSave(pm, t) {
  const dir = path.join(pm, "todo"); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${t.id}.md`); let was = ""; try { was = fs.readFileSync(file, "utf8"); } catch {}
  fs.writeFileSync(file, withExtras(todoRender(t), was)); // what the owner added to the file stays
}

// The open items, oldest first, with their age in whole days. `onlyWho` narrows to one person.
export function todoSummary(pm, { now = Date.now(), onlyWho = null } = {}) {
  const items = todoLoad(pm).filter(t => t.status === "open" && (!onlyWho || same(t.who, onlyWho))).map(t => {
    const at = Date.parse(`${t.added}T00:00:00Z`);
    return { id: t.id, title: t.todo, who: t.who, why: t.why, blocks: t.blocks, link: t.link, added: t.added, days: Number.isFinite(at) ? Math.max(0, Math.round((Date.parse(`${localDayOf(now)}T00:00:00Z`) - at) / 864e5)) : 0 }; // whole calendar days between the owner's days, not hours since a UTC midnight
  }).sort((a, b) => b.days - a.days || a.id.localeCompare(b.id));
  // "Ada" and "ada" are one person: the first spelling seen names them, and every item carries it.
  const seen = new Map(); for (const i of items) { const k = smallAscii(i.who); if (!seen.has(k)) seen.set(k, i.who); i.who = seen.get(k); }
  return { open: items.length, oldestDays: items[0]?.days ?? 0, people: [...seen.values()], items };
}

const days = n => n === 0 ? "today" : n === 1 ? "1 day" : `${n} days`;
export const openWords = n => n === 1 ? "1 thing waits on a person" : `${n} things wait on people`;
// One line for the session start and the page: how many, how old, and the first few.
export function todoLine(S, { max = 3 } = {}) {
  if (!S.open) return null;
  const first = S.items.slice(0, max).map(i => `${i.who}: ${i.title} (${days(i.days)})`).join(" · ");
  return `${openWords(S.open)}${S.oldestDays ? `, the oldest for ${days(S.oldestDays)}` : ""}: ${first}${S.open > max ? ` · +${S.open - max} more` : ""}`;
}

function find(all, key) {
  const k = String(key || "").trim().toLowerCase(); if (!k) return { error: "give the id (or part of it): `nosy todo list` shows them." };
  const exact = all.find(t => t.id.toLowerCase() === k); if (exact) return { t: exact };
  const hits = all.filter(t => t.id.toLowerCase().includes(k));
  if (hits.length === 1) return { t: hits[0] };
  return { error: hits.length ? `"${key}" fits more than one: ${hits.map(t => t.id).join(", ")}. Use more of the id.` : `no item matches "${key}". \`nosy todo list --all\` shows every item.` };
}

function main() {
  const argv = process.argv.slice(2), pm = argv.shift() || "pm";
  const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const flag = k => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true; };
  const why = opt("--why"), blocks = opt("--blocks"), link = opt("--link"), byWho = opt("--who"), note = opt("--note"), reason = opt("--reason"), dateArg = opt("--date"), json = opt("--json"), all = flag("--all");
  const [sub = "list", ...rest] = argv, today = dateArg || localDay();
  const fail = msg => { console.error(`Psst… ${msg}`); process.exit(1); };
  if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) fail(`--date is YYYY-MM-DD, not "${dateArg}".`);

  if (sub === "add") {
    const what = line(rest.join(" "));
    if (!what) fail('usage: nosy todo add "<what>" [--who <name>] [--why "<why only a person can>"] [--blocks "<what waits on it>"] [--link <url>]');
    const all0 = todoLoad(pm), person = who(byWho);
    const dup = all0.find(t => t.status === "open" && same(t.who, person) && norm(t.todo) === norm(what));
    if (dup) { console.log(`Psst… already on the list as ${dup.id} (for ${dup.who}, since ${dup.added}). Nothing added.`); return; }
    const t = { id: todoId(what, today, new Set(all0.map(x => x.id))), todo: what, who: person, why: line(why) || null, blocks: line(blocks) || null, link: line(link, 400) || null, added: today, status: "open" };
    todoSave(pm, t);
    console.log(`Psst… added ${t.id} for ${t.who}: ${t.todo}\nIt shows on the next session's first line and on the page. When it's done: \`nosy todo done ${t.id}\``);
    return;
  }

  if (sub === "list") {
    const S = todoSummary(pm, { onlyWho: byWho });
    if (json) { fs.mkdirSync(path.dirname(json), { recursive: true }); fs.writeFileSync(json, JSON.stringify({ type: "todo", generated: new Date().toISOString(), ...S }, null, 1)); }
    if (!S.open) console.log(`Psst… nothing waits on ${byWho ? who(byWho) : "a person"}.`);
    else {
      console.log(`Psst… ${openWords(S.open)}${S.oldestDays ? `. The oldest has waited ${days(S.oldestDays)}` : ""}.`);
      for (const p of S.people) {
        console.log(`\n${p}`);
        for (const i of S.items.filter(x => x.who === p)) {
          console.log(`  ${i.id} · ${days(i.days)}\n    ${i.title}`);
          for (const [label, v] of [["why", i.why], ["blocks", i.blocks], ["link", i.link]]) if (v) console.log(`    ${label}: ${v}`);
        }
      }
    }
    if (all) {
      const past = todoLoad(pm).filter(t => t.status !== "open" && (!byWho || same(t.who, byWho))).sort((a, b) => String(b.done || b.added).localeCompare(String(a.done || a.added))).slice(0, 10);
      if (past.length) { console.log("\nLately closed"); for (const t of past) console.log(`  ${t.id} · ${t.status}${t.done ? ` ${t.done}` : ""} · ${t.who}: ${t.todo}`); }
    }
    return;
  }

  if (sub === "show" || sub === "done" || sub === "drop") {
    const { t, error } = find(todoLoad(pm), rest[0]); if (error) fail(error);
    if (sub === "show") { process.stdout.write(todoRender(t)); return; }
    if (t.status !== "open") { console.log(`Psst… ${t.id} is already ${t.status}${t.done ? ` (${t.done})` : ""}. Nothing changed.`); return; }
    if (sub === "drop" && !line(reason)) fail(`drop needs --reason "<why it's no longer needed>", so the list keeps its history.`);
    if (sub === "done") { t.status = "done"; t.done = today; t.note = line(note) || null; }
    else { t.status = "dropped"; t.dropReason = line(reason); t.done = today; }
    todoSave(pm, t);
    const left = todoSummary(pm).open;
    console.log(`Psst… ${t.id} ${sub === "done" ? "done" : "dropped"}. ${left ? openWords(left) + "." : "Nothing else waits on a person."}`);
    return;
  }
  fail(`unknown action "${sub}": add, list, show, done or drop.`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
