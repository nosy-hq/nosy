// Learning loop: turns the owner's "noise / knowingly / important" verdict into a persistent rule, filters any
// script's JSON output through these rules, and suggests a pattern for sources.json from repeated verdicts.
// Usage: node learn.mjs <pm> mute|knowingly|important "<key>" --reason ".." [--type ..] [--duration days] [--who ..]
//        node learn.mjs <pm> list [--all] | remove <id> | apply <input.json> [--output ..] [--type ..] | suggest [--apply]
// Patterns: CodeRabbit "Learnings" (a fix goes into persistent memory, never flagged again), Kiro steering/Crew
// ("a fix turns into a persistent rule"), Visualping 👍/👎 (task-specific "important" learning), Linear
// accept/dismiss + opt-in auto-apply, DeepWiki's hand-editable steering file (repo_notes).
import fs from "node:fs"; import path from "node:path"; import { createHash } from "node:crypto";
import { readSources } from "./sources-file.mjs";

let argv = process.argv.slice(2);
const flag = name => { const i = argv.indexOf(`--${name}`); if (i < 0) return false; argv.splice(i, 1); return true; };
const value = (name, def = null) => { const i = argv.indexOf(`--${name}`); if (i < 0) return def; const v = argv[i + 1]; argv.splice(i, 2); return v ?? def; };
const argOutput = value("output"), argJson = value("json"), argReason = value("reason", ""), argType = value("type"), argDuration = value("duration"), argWho = value("who");
const argContext = value("context"); // what topic a "reject" rule relates to (measure-size/canwe mapping)
const argAll = flag("all"), argApply = flag("apply");
const [pmDir, command, ...remaining] = argv;
const error = m => { console.error(`Error: ${m}`); process.exit(1); };
if (!pmDir || !command) error('usage: learn.mjs <pm> <mute|knowingly|important|reject|list|remove|apply|suggest> ...');

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const dayDiffOf = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const small = s => String(s ?? "").toLocaleLowerCase("tr");
// lowhanging.mjs's add() function appends " (in #438)" and " · in PR" to items touching an open PR; stripped before matching.
const plain = s => String(s ?? "").replace(/\s*\(in #\d+\)\s*/g, " ").replace(/\s*·\s*in PR\s*/gi, " ").replace(/\s+/g, " ").trim();
const REF_FIND = /§\d+[a-z]?|K\d{2,3}(?:\s*m\.\d+)?|#\d+/;
const REF_FULL = /^(§\d+[a-z]?|K\d{2,3}(?:\s*m\.\d+)?|#\d+)$/i;
const REF_PREFIX = /^(§\d+[a-z]?|K\d{2,3}(?:\s*m\.\d+)?|#\d+)\b/i; // a leading ref, even if a description follows
const REGEX_FORMAT_OF = /^\/(.+)\/([a-z]*)$/s;
const equalRef = (a, b) => small(plain(a)).replace(/\s+/g, "") === small(plain(b)).replace(/\s+/g, "");

const filePath = path.join(pmDir, "learned.json");
const read = () => { try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return { version: 1, rules: [] }; } };
const write = rules => fs.writeFileSync(filePath, JSON.stringify({ version: 1, rules }, null, 1));
const writeJson = (file, data) => { if (file) fs.writeFileSync(file, JSON.stringify(data, null, 1)); };
// id is short and stable: kind + a key digest. type/reason/duration/who are updatable fields; if the key+kind match, no duplicate opens.
const shortId = (tip, key) => `${tip}-${createHash("sha1").update(`${tip}:${REGEX_FORMAT_OF.test(key) ? key : small(plain(key))}`).digest("hex").slice(0, 8)}`;

// --- mute | knowingly | important: add or update a rule -----------------------------------
function ruleAdd(tip) {
  const key = remaining[0];
  if (!key) error(`key required: learn.mjs <pm> ${tip} "<key>" --reason "..."`);
  const { rules } = read();
  const id = shortId(tip, key);
  const existing = rules.find(k => k.id === id);
  const end = argDuration ? new Date(Date.now() + Number(argDuration) * 864e5).toISOString().slice(0, 10) : (existing?.end ?? null);
  const current = { id, tip, key, type: argType || existing?.type || "all", reason: argReason || existing?.reason || "", who: argWho || existing?.who || null, date: today(), end, match: existing?.match || 0, last_match: existing?.last_match || null };
  if (existing) Object.assign(existing, current); else rules.push(current);
  write(rules);
  console.log(`# ${existing ? "Updated" : "WasAdded"} · ${tip}\n\n- id: \`${id}\`\n- key: ${key}\n- type: ${current.type}\n- end: ${end || "permanent"}${current.reason ? `\n- reason: ${current.reason}` : ""}`);
  writeJson(argJson, { type: "learn-rule", generated: now(), ...current });
}

// --- reject: reject a candidate, with context ------------------------------------------------
// Differs from mute/knowingly/important: this doesn't reject a psst item, it rejects ONE ITEM in measure-size/canwe/dresscode's
// "similar/candidate" list, FOR A SPECIFIC TOPIC ("client portal" may be irrelevant for one topic, relevant for another)
// — so `--context` is required and also enters the id (the same key under a different context is a separate rule).
function rejectAdd() {
  const key = remaining[0];
  if (!key) error('key required: learn.mjs <pm> reject "<candidate key>" --context "<topic>" --type size|canwe|dresscode --reason "..."');
  if (!argContext) error('--context required: a reject rule needs to know which topic it relates to (e.g. "client portal")');
  const { rules } = read();
  const id = shortId("reject", `${small(plain(argContext))}::${key}`);
  const existing = rules.find(k => k.id === id);
  const end = argDuration ? new Date(Date.now() + Number(argDuration) * 864e5).toISOString().slice(0, 10) : (existing?.end ?? null);
  const current = { id, tip: "reject", key, context: argContext, type: argType || existing?.type || "all", reason: argReason || existing?.reason || "", who: argWho || existing?.who || null, date: today(), end, match: existing?.match || 0, last_match: existing?.last_match || null };
  if (existing) Object.assign(existing, current); else rules.push(current);
  write(rules);
  console.log(`# ${existing ? "Updated" : "WasAdded"} · reject\n\n- id: \`${id}\`\n- key: ${key}\n- context: ${argContext}\n- type: ${current.type}\n- end: ${end || "permanent"}${current.reason ? `\n- reason: ${current.reason}` : ""}`);
  writeJson(argJson, { type: "learn-rule", generated: now(), ...current });
}

// --- list ------------------------------------------------------------------------------------
function list() {
  const { rules } = read();
  const b = today();
  const active = rules.filter(k => !k.end || k.end >= b);
  const expired = rules.filter(k => k.end && k.end < b);
  const maybe = k => k.match === 0 && dayDiffOf(k.date, b) >= 14; // 14 days: same measure as request.last_day's default
  const line = k => `| \`${k.id}\` | ${k.tip} | ${k.type} | ${k.key.replace(/\|/g, "/")} | ${k.match} | ${k.last_match ? k.last_match.slice(0, 10) : "—"} | ${maybe(k) ? "maybe remove" : ""} |`;
  let o = `# Learned rules · ${pmDir}\n\nActive: ${active.length} · expired: ${expired.length}${!argAll && expired.length ? " (see with --all)" : ""}\n\n| id | kind | type | key | matches | last match | note |\n|---|---|---|---|---|---|---|\n`;
  o += active.map(line).join("\n") || "—";
  if (argAll && expired.length) o += `\n\n## Expired (${expired.length})\n\n| id | kind | type | key | end | matches |\n|---|---|---|---|---|---|\n` + expired.map(k => `| \`${k.id}\` | ${k.tip} | ${k.type} | ${k.key.replace(/\|/g, "/")} | ${k.end} | ${k.match} |`).join("\n");
  console.log(o);
  writeJson(argJson, { type: "learn-list", generated: now(), active, duration_of_expired: expired });
}

// --- remove -----------------------------------------------------------------------------------
function remove() {
  const id = remaining[0]; if (!id) error("id required: learn.mjs <pm> remove <id>");
  const { rules } = read();
  const i = rules.findIndex(k => k.id === id);
  if (i < 0) error(`no such rule: ${id}`);
  const [deleted] = rules.splice(i, 1);
  write(rules);
  console.log(`# Removed\n\n\`${id}\` · ${deleted.tip} · ${deleted.key}`);
  writeJson(argJson, { type: "learn-remove", generated: now(), deleted });
}

// --- apply: filter any script's JSON output through the rules --------------------------------
// Recognized formats: lowhanging ({items:[{title,evidence,detail,...}]} — no ref field in the JSON, pulled from
// title/evidence), status ({groups:[{ref,topic,...}]}), generic {findings|changes|goals|lines:[...]}.
const TITLE_FIELDS_OF = ["title", "topic", "name", "title", "description", "summary"];
const textOfFind = o => { for (const a of TITLE_FIELDS_OF) if (typeof o[a] === "string" && o[a]) return o[a]; return ""; };
const refFind = (o, text) => { if (o.ref) return String(o.ref); const m = plain(text).match(REF_FIND) || plain(o.evidence || o.not || "").match(REF_FIND); return m ? m[0] : null; };
// includes type: also accepts a category name as a key, like "mute 'Issue opened against us'".
const rawTextOf = o => [o.title, o.topic, o.name, o.evidence, o.not, o.type, o.detail].flat().filter(Boolean).join(" \n ");
const ARRAY_KEYS_OF = ["items", "groups", "findings", "changes", "goals", "lines"];
const arrayFind = data => { for (const a of ARRAY_KEYS_OF) if (Array.isArray(data[a])) return a; return null; };

function match(k, item) {
  const rm = REGEX_FORMAT_OF.exec(k.key);
  if (rm) { try { return new RegExp(rm[1], rm[2] || "i").test(item.rawText); } catch { return false; } } // used as a regex as-is
  if (REF_FULL.test(k.key.trim())) return !!item.ref && equalRef(item.ref, k.key); // a ref matches exactly
  return small(plain(item.rawText)).includes(small(plain(k.key))); // a title/category/evidence fragment, tr-insensitive
}

function apply() {
  const input = remaining[0];
  if (!input) error("input.json required: learn.mjs <pm> apply <input.json> [--output file] [--type ..]");
  const data = JSON.parse(fs.readFileSync(input, "utf8"));
  const keyNameOf = arrayFind(data);
  if (!keyNameOf) error(`unrecognized format (expected items|groups|findings|changes|goals|lines): ${input}`);
  const { rules } = read();
  const activeRules = rules.filter(k => (!k.end || k.end >= today()) && (!argType || k.type === argType || k.type === "all"));
  const nowIso = now(), used = new Set();
  let muted = 0, knowinglyN = 0, importantN = 0;
  const knowinglyListOf = [], remainingValue = [];
  for (const item of data[keyNameOf]) {
    const text = textOfFind(item), ref = refFind(item, text), rawText = rawTextOf(item);
    const suitable = activeRules.filter(k => match(k, { text, ref, rawText }));
    const s = suitable.find(k => k.tip === "mute");
    const bl = !s && suitable.find(k => k.tip === "knowingly");
    const on = suitable.filter(k => k.tip === "important");
    for (const k of [s, bl, ...on].filter(Boolean)) { k.match = (k.match || 0) + 1; k.last_match = nowIso; used.add(k.id); }
    if (s) { muted++; continue; }
    if (bl) { knowinglyN++; knowinglyListOf.push(item); continue; }
    if (on.length) { importantN++; remainingValue.push({ ...item, constant: true }); continue; } // pinned: always stays on top
    remainingValue.push(item);
  }
  remainingValue.sort((a, b) => (b.constant === true) - (a.constant === true)); // stable: important ones move to the front, the rest keep their order
  write(rules); // match counters and last_match are persisted
  const result = { ...data, [keyNameOf]: remainingValue, [`${keyNameOf}_knowingly`]: knowinglyListOf, learn: { muted, knowingly: knowinglyN, important: importantN, rules: [...used] } };
  const goal = argOutput || input.replace(/\.json$/i, ".filtered.json");
  fs.writeFileSync(goal, JSON.stringify(result, null, 1));
  console.log(`# Filtered · ${input}\n\nBefore ${data[keyNameOf].length} items → after ${remainingValue.length} (muted ${muted}, knowingly ${knowinglyN}, important ${importantN})\n\nWritten: ${goal}`);
}

// --- suggest: suggest a pattern for sources.json from repeated mute/knowingly rules -------------
// English filler plus Turkish-language support (skill/data/lang/tr/learn.json), both folded the same way as the words.
const TR_STOP = JSON.parse(fs.readFileSync(new URL("../data/lang/tr/learn.json", import.meta.url), "utf8")).stopwords;
const Stop = new Set(["for", "as", "not", "the", "and", "with", "that", "this", "does", "yet", "isn't", ...TR_STOP].map(w => small(plain(w))));
const words = s => small(plain(s)).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(w => w.length >= 3 && !Stop.has(w));
function candidates(rules) {
  const counter = new Map(); // phrase -> Set(rule id) — counts DIFFERENT rules that share the same phrase
  for (const k of rules) {
    const ks = words(`${k.reason} ${REGEX_FORMAT_OF.test(k.key) ? "" : k.key}`);
    const buInRule = new Set();
    for (let n = 3; n >= 2; n--) for (let i = 0; i + n <= ks.length; i++) buInRule.add(ks.slice(i, i + n).join(" "));
    for (const expression of buInRule) { if (!counter.has(expression)) counter.set(expression, new Set()); counter.get(expression).add(k.id); }
  }
  return [...counter].filter(([, ids]) => ids.size >= 3).sort((a, b) => b[1].size - a[1].size || b[0].length - a[0].length);
}
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function enGoodAday(rules, existingPattern) {
  const re = existingPattern ? new RegExp(existingPattern, "i") : null;
  for (const [expression, ids] of candidates(rules)) if (!re || !re.test(expression)) return { expression, rules: ids };
  return null; // either there's no 3+ shared phrase, or the ones found are already in the existing pattern
}

function suggest() {
  const { rules } = read();
  const kPath = path.join(pmDir, "sources.json");
  const K = fs.existsSync(kPath) ? readSources(pmDir, { raw: true }) : {};
  const suggestions = [];
  if (typeof K.dropped?.knowingly === "string") {
    const pool = rules.filter(k => k.tip === "knowingly" && (k.type === "psst" || k.type === "all") && !REGEX_FORMAT_OF.test(k.key) && !REF_PREFIX.test(k.key.trim()));
    const a = enGoodAday(pool, K.dropped.knowingly);
    if (a) suggestions.push({ area: "dropped.knowingly", old: K.dropped.knowingly, fresh: `${K.dropped.knowingly}|${escape(a.expression)}`, justification: `${a.rules.size} rules share the same phrase ("${a.expression}"): ${[...a.rules].join(", ")}`, applicable: true });
  }
  if (typeof K.request?.screen_missing === "string") {
    const pool = rules.filter(k => k.tip === "knowingly" && (k.type === "psst" || k.type === "all") && /^§\d+[a-z]?\b/.test(k.key.trim()));
    const a = enGoodAday(pool, K.request.screen_missing);
    if (a) suggestions.push({ area: "request.screen_missing", old: K.request.screen_missing, fresh: `${K.request.screen_missing}|${escape(a.expression)}`, justification: `${a.rules.size} rules share the same phrase ("${a.expression}"): ${[...a.rules].join(", ")}`, applicable: true });
  }
  (K.preread?.never || []).forEach((rule, i) => {
    const related = rules.filter(k => k.tip === "mute" && (k.type === "overheard" || k.type === "all") && small(plain(`${k.reason} ${k.key}`)).includes(small(rule.name)));
    if (related.length >= 3) suggestions.push({ area: `preread.never[${i}].pattern (${rule.name})`, old: rule.pattern, fresh: null, justification: `false positive ${related.length} times, the owner needs to narrow this: ${related.map(k => k.key).join(", ")}`, applicable: false });
  });

  if (!suggestions.length) { console.log("# No pattern suggestion\n\nNo repeated (3+) rule pattern found, or the ones found are already in the existing pattern."); writeJson(argJson, { type: "learn-suggest", generated: now(), suggestions: [] }); return; }
  let o = `# Pattern suggestion · ${pmDir}\n\n`;
  for (const suggestion of suggestions) o += `## ${suggestion.area}\n- before: \`${suggestion.old}\`\n- after: ${suggestion.fresh ? `\`${suggestion.fresh}\`` : "(no suggestion — needs manual narrowing)"}\n- rationale: ${suggestion.justification}\n\n`;
  if (argApply) {
    const applied = suggestions.filter(x => x.applicable);
    if (applied.length) {
      fs.copyFileSync(kPath, `${kPath}.yedek`);
      for (const suggestion of applied) { const [upper, alt] = suggestion.area.split("."); K[upper][alt] = suggestion.fresh; }
      fs.writeFileSync(kPath, JSON.stringify(K, null, 1));
      o += `Applied (${applied.length}) → ${kPath} (backup: ${kPath}.yedek)\n`;
    } else o += `--apply was given but there's no automatically applicable suggestion (some need manual narrowing).\n`;
  } else o += `--apply wasn't given; ${kPath} unchanged.\n`;
  console.log(o);
  writeJson(argJson, { type: "learn-suggest", generated: now(), suggestions });
}

const Commands = { mute: () => ruleAdd("mute"), knowingly: () => ruleAdd("knowingly"), important: () => ruleAdd("important"), reject: rejectAdd, list, remove, apply, suggest };
if (!Commands[command]) error(`unknown subcommand: ${command} (mute|knowingly|important|reject|list|remove|apply|suggest)`);
Commands[command]();
