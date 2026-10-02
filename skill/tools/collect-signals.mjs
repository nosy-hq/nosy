// Demand-signal collector: reads support/survey/interview notes and GitHub issue records, matches them against
// Nosy's own evidence (matrix row, request-document item, decision, psst item); clusters the rest into themes.
// Answers "does the customer want this, how many, since when?" from local files — matrix row 5
// "Demand signal" used to read n ("no customer interview/support connection"); scoop.md said "if there
// are demand signals" but there was no tool reading them (log, cycle 0/1).
// Usage: node collect-signals.mjs <pm folder> [file|folder ...] [--gh] [--json <file>] [--quote N] [--day N]
// Rival patterns: Enterpret/Unwrap's automatic theme taxonomy + every claim traces back to a source (pm/rivals/
// enterpret.md "citation-based exploration", unwrap-ai.md "mention count + link to source"); Productboard
// Spark's insight → feature linking, opportunities "ranked by evidence" (pm/rivals/productboard-spark.md);
// Dovetail's bridge from tag frequency to prioritization (pm/rivals/dovetail.md).
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { execFileSync } from "node:child_process"; import { matrixRead } from "./read-matrix.mjs"; import { patternsOfLoad } from "./refs.mjs"; import { small, smallAscii, root, ascii, langOfLoad } from "./text.mjs"; import { thresholds } from "./thresholds.mjs";
import { mask } from "./mask.mjs";
import { windowText } from "./demand.mjs";
import { readSources, teamLogins as teamLoginsOf, isTeamLogin } from "./sources-file.mjs";

const argv = process.argv.slice(2);
const ji = argv.indexOf("--json"); const jsonOut = ji >= 0 ? argv.splice(ji, 2)[1] : null;
const gi = argv.indexOf("--gh"); const GH = gi >= 0; if (GH) argv.splice(gi, 1);
const ai = argv.indexOf("--quote"); const Quote = ai >= 0 ? +argv.splice(ai, 2)[1] : 2;
const gni = argv.indexOf("--day"); const Day = gni >= 0 ? +argv.splice(gni, 2)[1] : 30;
const [pm = "pm", ...paths] = argv;
const K = readSources(pm);
langOfLoad(K); // sources.json's `language`
const ES = thresholds(K); // the optional `thresholds` object in sources.json, falls back to defaults otherwise

// --- base text tools: text.mjs's shared helper (same pattern as gather-evidence/measure-size) ---
// rarity-weighted, word-start matching, rough stem + consonant-softening rollback, ASCII folding.
const low = small;
// Turkish-language support (matching Turkish text in a user's product, e.g. a support export or interview notes):
// stopwords and column-name synonyms live in skill/data/lang/tr/collect-signals.mjs, not here. English stopwords
// were also added: the request document (BACKEND-NEEDS.md) is English, and short sections were randomly matching
// on shared words like "can/have/would/their" (seen in 10 manual checks on the example data).
const Lang = JSON.parse(fs.readFileSync(new URL("../data/lang/tr/collect-signals.json", import.meta.url), "utf8"));
const Stop = new Set([...Lang.stopWords, ..."the and for with that this from are was were is to of in on at an a we you can could would should will have has had their our your his her its every without when where which who what if not no so then than just only also more most some any all each other such very much many same own do does did been being".split(" ")]);
// tokenOrder: ordered (duplicates included, adjacency preserved — required for bigrams). words: a unique set for matching.
const tokenOrder = t => low(t).replace(/['’]/g, "").split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2 && !Stop.has(w)).map(root);
const words = t => [...new Set(tokenOrder(t))];

// K.glossary (TR key → EN synonym array) is expanded in both directions; keys are also stemmed so that a
// Turkish glossary key finds its own inflected forms in a signal, under the same stem.
const phraseAgainst = {}; const phraseAdd = (k, v) => (phraseAgainst[k] ??= new Set()).add(v);
for (const [tr, ens] of Object.entries(K.glossary || {})) { const trL = low(tr);
  for (const enL of (ens || []).map(low)) { phraseAdd(root(trL), enL); phraseAdd(root(enL.split(/\s+/)[0]), trL); } }
const synonym = w => [w, ...(phraseAgainst[w] || [])];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const reCache = new Map();
// ASCII-folded (text.mjs's pattern): each synonym is tried both in its own form and its
// ASCII-folded form (an ASCII-typed Turkish word matches its correctly-accented spelling); the target text
// (h._low) must be prepared with smallAscii() for the ASCII branch to work.
const reOf = w => { if (!reCache.has(w)) { const parts = new Set(); for (const f of synonym(w)) { parts.add(f); parts.add(ascii(f)); }
  reCache.set(w, new RegExp([...parts].map(f => `(?<![\\p{L}\\p{N}])${esc(f)}`).join("|"), "u")); } return reCache.get(w); };

// --- git reading (only via K.repo:K.ref, same pattern as collect-status/gather-evidence) ---
const show = f => { try { return execFileSync("git", ["-C", K.repo, "show", `${K.ref}:${f}`], { encoding: "utf8", maxBuffer: 64 << 20 }); } catch { return ""; } };
const blocks = (src, re) => { const out = []; let m, last = null; const r = new RegExp(re, "gm");
  while ((m = r.exec(src))) { if (last) out.push(src.slice(last.i, m.index)); last = { i: m.index }; } if (last) out.push(src.slice(last.i)); return out; };
// Reference pattern: the shared helper refs.mjs (sources.json `refs`, otherwise the DEFAULT). One match is enough here: no g flag.
const refRe = new RegExp(patternsOfLoad(K).join("|"));

// --- field detection: find text/date/source/customer from a header name (CSV column or JSON field name), TR+EN ---
// Turkish column-name synonyms (Lang.fields) support a user's own Turkish support export/survey; English ones are code.
const F = Lang.fields;
const NotDoingRe = new RegExp([...Lang.notDoing, "not doing"].map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
// Product-sourced column-name words (the language audit #7): a support/survey export's
// headers can be in ANY language ("Beschreibung", "Datum") - EN+TR word lists alone silently drop the whole
// file (0 signals, no error). sources.json's `glossary.signals` gives the product's OWN header words, one entry
// per field: "text:Nachricht", "date:Datum", "source:Kanal", "email:E-Mail", "customer:Kunde" - same flat,
// "<field>:<word>" shape as `glossary.design`/`glossary.prd` (internal request 105/106; K.glossary is read
// generically as a plain {word: [translations]} map by half a dozen other tools, so this stays a flat array of
// strings, never a nested object). An entry with an unrecognized field prefix, or no prefix at all, is dropped
// rather than silently applied to the wrong field.
const SIGNAL_FIELDS = new Set(["text", "date", "source", "email", "customer"]);
function signalsGlossaryMap(list) {
  const map = {};
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const m = raw.match(/^(\w+):(.+)$/);
    if (!m || !SIGNAL_FIELDS.has(m[1])) continue;
    (map[m[1]] ??= []).push(m[2].trim());
  }
  return map;
}
const GlossarySignals = signalsGlossaryMap(K.glossary?.signals);
const ALAN = {
  text: new RegExp(`(${[...F.text, "body", "description", "comment", "message", "content", "subject", "summary", ...(GlossarySignals.text || []).map(esc)].join("|")})`, "i"),
  date: new RegExp(`^(${[...F.date, "created", "date", "received", "ts$", "timestamp", "submitted", "started", ...(GlossarySignals.date || []).map(esc)].join("|")})`, "i"),
  source: new RegExp(`^(${[...F.source, "source", "channel", "platform", "type", ...(GlossarySignals.source || []).map(esc)].join("|")})$`, "i"),
  email: new RegExp(`(${[...F.email, "email", "e-mail", "mail", ...(GlossarySignals.email || []).map(esc)].join("|")})`, "i"),
  customer: new RegExp(`^(${[...F.customer, "account", "customer", "requester", "contact", "user", ...(GlossarySignals.customer || []).map(esc)].join("|")})`, "i"),
};
const roleFindList = titles => { const role = { text: [], date: null, source: null };
  titles.forEach((h, i) => { const t = low(String(h || "").trim());
    if (ALAN.text.test(t)) role.text.push(i);
    else if (role.date === null && ALAN.date.test(t)) role.date = i;
    else if (role.source === null && ALAN.source.test(t)) role.source = i; });
  const ei = titles.findIndex(h => ALAN.email.test(low(String(h || "").trim())));
  const mi = ei >= 0 ? ei : titles.findIndex(h => ALAN.customer.test(low(String(h || "").trim())));
  role.customer = mi >= 0 ? mi : null; return role; };
const roleFindObject = keys => { const role = { text: [], date: null, source: null };
  const last = k => low(k).split(".").pop();
  keys.forEach(k => { const t = low(k), l = last(k);
    if (ALAN.text.test(t)) role.text.push(k);
    else if (role.date === null && ALAN.date.test(l)) role.date = k;
    else if (role.source === null && ALAN.source.test(l)) role.source = k; });
  const extra = keys.find(k => ALAN.email.test(last(k)));
  role.customer = extra || keys.find(k => ALAN.customer.test(last(k))) || null; return role; };

// --- shape-first column typing (the language audit #7): a header word is one
// language's naming choice; the VALUE underneath is not. Before ever consulting a header, every column/field
// is classified by what its values actually look like - a date (ISO/numeric/epoch/parseable), an email, an
// id (uuid or a purely numeric, low-variety token), or free text (long, mostly-unique strings: the message).
// Header words (ALAN above: EN+TR defaults + glossary.signals) only step in to BREAK A TIE between more than
// one shape-candidate for the same role, or to add a second text column (e.g. "subject" alongside "body").
// This is what lets a German/French/any-language support export be read correctly even with zero sources.json
// setup: "Datum" doesn't need to be recognized as a word when the column's values already parse as dates.
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_SHAPE_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{1,20})$/i;
function shapeOfValues(values) {
  const sample = values.map(v => (v == null ? "" : String(v)).trim()).filter(Boolean).slice(0, 300);
  if (!sample.length) return { kind: "empty", avgLen: 0, distinctRatio: 0 };
  const n = sample.length;
  const dateN = sample.filter(v => dateParse(v)).length;
  const emailN = sample.filter(v => EMAIL_SHAPE_RE.test(v)).length;
  const idN = sample.filter(v => ID_SHAPE_RE.test(v)).length;
  const distinctRatio = new Set(sample.map(v => low(v))).size / n;
  const avgLen = sample.reduce((s, v) => s + v.length, 0) / n;
  if (dateN / n >= 0.7) return { kind: "date", avgLen, distinctRatio };
  if (emailN / n >= 0.7) return { kind: "email", avgLen, distinctRatio };
  if (idN / n >= 0.8 && avgLen <= 40) return { kind: "id", avgLen, distinctRatio };
  return { kind: "text", avgLen, distinctRatio };
}
// A column/key counts as "the message" (long free text) only once it clears a minimum average length; below
// that, even the "least short" column is closer to a status/category flag than to prose. Score rewards length
// AND variety together (a long-but-repeated boilerplate string, or a short-but-unique code, both score low),
// so the genuinely prose-shaped column wins even when several candidates are left after date/email/id are
// pulled out.
const MIN_TEXT_AVG_LEN = 8;
const textScoreOf = shape => shape.kind === "empty" ? -1 : shape.avgLen * Math.max(shape.distinctRatio, 0.05);
// Shared role-picking logic over a list of {key, shape} candidates (CSV column index or JSON/JSONL flattened
// key) plus the header-based fallback (roleFindList/roleFindObject above, used only to break ties or to add a
// second text field). Returns null fields when nothing qualifies - callers decide what "no text field found"
// means for their format.
function rolesFromShapes(entries, headerRole, headerOf) {
  const shaped = entries.map(([key, values]) => [key, shapeOfValues(values)]);
  const byKind = kind => shaped.filter(([, s]) => s.kind === kind).map(([k]) => k);
  const pick = (cands, testerRe) => cands.length > 1 ? (cands.find(k => testerRe.test(low(String(headerOf(k) || "").trim()))) ?? cands[0])
    : cands.length === 1 ? cands[0] : null;
  const dateKey = pick(byKind("date"), ALAN.date) ?? headerRole.date;
  const emailKey = pick(byKind("email"), ALAN.email);
  const excluded = new Set([dateKey, emailKey].filter(k => k != null));
  byKind("id").forEach(k => excluded.add(k));
  const textCands = shaped.filter(([k, s]) => !excluded.has(k) && s.kind !== "empty")
    .map(([k, s]) => ({ k, score: textScoreOf(s) })).sort((a, b) => b.score - a.score);
  let textKeys = [];
  if (textCands.length && textCands[0].score > 0 && shaped.find(([k]) => k === textCands[0].k)[1].avgLen >= MIN_TEXT_AVG_LEN) {
    textKeys = [textCands[0].k];
    shaped.forEach(([k, s]) => { if (k !== textKeys[0] && !excluded.has(k) && s.kind !== "empty" && ALAN.text.test(low(String(headerOf(k) || "").trim()))) textKeys.push(k); });
  } else if (headerRole.text.length) {
    textKeys = headerRole.text; // shape found nothing confident; fall back to a header match if there is one
  }
  const customerKey = emailKey ?? (headerRole.customer ?? null);
  return { textKeys, dateKey: dateKey ?? null, customerKey };
}

const dateParse = s => { if (!s) return null;
  // Epoch seconds or milliseconds (Intercom created_at, Slack "1695812345.000100").
  if (typeof s === "number" || /^\d{9,13}(\.\d+)?$/.test(String(s).trim())) { const n = +s; const d = new Date(n > 1e12 ? n : n * 1000); return isNaN(d) ? null : d; }
  s = String(s).trim(); if (!s) return null;
  let d = new Date(s); if (!isNaN(d)) return d;
  const m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/); if (m) { d = new Date(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`); if (!isNaN(d)) return d; }
  return null; };

// --- small CSV parser: quoted fields, commas/newlines inside a field, "" escaping ---
const csvParse = t => { t = t.replace(/^﻿/, ""); const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') { q = true; continue; }
    if (c === ",") { row.push(f); f = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; continue; }
    f += c; }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows; };

const csvRead = file => { const rows = csvParse(fs.readFileSync(file, "utf8")); if (!rows.length) return [];
  const titles = rows[0];
  const entries = []; // { row, line } for every non-blank data row, in order
  for (let i = 1; i < rows.length; i++) { const row = rows[i]; if (row.some(c => c && c.trim())) entries.push({ row, line: i + 1 }); }
  if (!entries.length) return [];
  const headerRole = roleFindList(titles);
  const columns = titles.map((_, ci) => entries.map(e => e.row[ci]));
  const roles = rolesFromShapes(titles.map((h, ci) => [ci, columns[ci]]), headerRole, ci => titles[ci]);
  if (!roles.textKeys.length) return { unrecognized: true, headers: titles, samples: entries.slice(0, 2).map(e => e.row) };
  const out = [];
  for (const e of entries) { const row = e.row;
    const text = roles.textKeys.map(ix => row[ix]).filter(Boolean).join(" · ").trim(); if (!text) continue;
    out.push({ text, date: roles.dateKey != null ? dateParse(row[roles.dateKey]) : null,
      customerRaw: roles.customerKey != null ? row[roles.customerKey] : null, line: e.line, format: "csv" }); }
  return out; };
// Native exports nest their records and text: Intercom (conversations[].source.body + conversation_parts),
// Zendesk (tickets[].description, via.channel), HubSpot (results[].properties.content), Slack (a channel-day
// array of {text, ts}), Gong/Fireflies transcripts (sentences[].text), Linear/GraphQL (data.issues.nodes).
// unwrapRecords finds the record array; flatten turns one record into dotted keys, joining the text of nested
// arrays (conversation parts, comments, sentences) into one "<path>.body" string.
const RECORD_KEYS = ["items", "data", "conversations", "tickets", "results", "messages", "posts", "nodes", "records", "reviews", "responses", "entries", "feedback", "notes", "issues", "calls", "transcripts"];
const unwrapRecords = (v, depth = 0) => { if (Array.isArray(v)) return v; if (!v || typeof v !== "object" || depth > 3) return [];
  for (const k of RECORD_KEYS) if (Array.isArray(v[k]) && v[k].some(x => x && typeof x === "object")) return v[k];
  for (const x of Object.values(v)) { const r = unwrapRecords(x, depth + 1); if (r.length) return r; }
  return []; };
const htmlStrip = s => String(s).replace(/<br\s*\/?>|<\/p>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const TEXT_LEAF = ["body", "text", "content", "message", "description", "comment", "sentence"];
// Replies from our own side (support agent, bot, internal call participant) are not demand: skip those parts.
const OurSide = /^(admin|bot|agent|teammate|internal|rep|operator|host)$/i;
const ourSide = x => [x.author?.type, x.author_type, x.role, x.affiliation, x.speaker_type, x.speakerType].some(v => typeof v === "string" && OurSide.test(v));
const flatten = (o, prefix = "", out = {}, depth = 0) => {
  for (const [k, v] of Object.entries(o)) { const key = prefix ? `${prefix}.${k}` : k;
    if (v == null) continue;
    if (Array.isArray(v)) { if (depth < 3 && v.some(x => x && typeof x === "object")) {
        const texts = v.flatMap(x => x && typeof x === "object" && !ourSide(x) ? TEXT_LEAF.map(t => x[t]).filter(t => typeof t === "string") : []);
        const inner = v.find(x => x && typeof x === "object" && !TEXT_LEAF.some(t => typeof x[t] === "string"));
        if (texts.length) out[`${key}.body`] = texts.join(" · "); else if (inner) flatten(inner, key, out, depth + 1); }
      continue; }
    if (typeof v === "object") { if (depth < 3) flatten(v, key, out, depth + 1); continue; }
    out[key] = v; }
  return out; };
// A text field must hold prose: skip ids, counts and flags that happen to live under "message_id", "comment_count".
const proseOf = v => typeof v === "string" && /\p{L}{2,}.*\s/u.test(v) ? htmlStrip(v) : null;
const Housekeeping = /^(channel_join|channel_leave|bot_message|group_join)$/;
// Roles are picked ONCE per export (batch), not per record: a support/survey export has one consistent
// schema, and deciding text/date/customer per record risked a different record in the same file landing on a
// different field if its own keys happened to differ (e.g. a record missing an optional key). Shape samples
// are pooled across every record for the same flattened key first; the legacy
// per-record header-based roleFindObject is still computed and used only as this batch's tie-break/fallback.
// `records`: [{ raw, line }] - line is the display line number (json: 1-based record order; jsonl: file line).
function recordsSignal(records, format) {
  const flat = records.map(({ raw }) => (!raw || typeof raw !== "object" || Housekeeping.test(raw.subtype || "")) ? null : flatten(raw));
  const idx = flat.map((o, i) => (o ? i : null)).filter(i => i != null);
  if (!idx.length) return [];
  const allKeys = [...new Set(idx.flatMap(i => Object.keys(flat[i])))];
  const headerRole = roleFindObject(allKeys);
  const samplesOf = k => idx.map(i => flat[i][k]).filter(v => typeof v === "string" || typeof v === "number");
  const roles = rolesFromShapes(allKeys.map(k => [k, samplesOf(k)]), headerRole, k => k.split(".").pop());
  if (!roles.textKeys.length) return { unrecognized: true, headers: allKeys, samples: idx.slice(0, 2).map(i => flat[i]) };
  const out = [];
  for (const i of idx) { const o = flat[i];
    const text = [...new Set(roles.textKeys.map(k => proseOf(o[k])).filter(Boolean))].join(" · ").trim(); if (!text) continue;
    out.push({ text, date: roles.dateKey ? dateParse(o[roles.dateKey]) : null, customerRaw: roles.customerKey ? o[roles.customerKey] : null, line: records[i].line, format }); }
  return out;
}
const jsonRead = file => { const v = JSON.parse(fs.readFileSync(file, "utf8")); const arr = unwrapRecords(v);
  return recordsSignal(arr.map((raw, i) => ({ raw, line: i + 1 })), "json"); };
const jsonlRead = file => { const records = fs.readFileSync(file, "utf8").split("\n").map((l, i) => ({ l: l.trim(), line: i + 1 })).filter(x => x.l)
    .map(x => { try { return { raw: JSON.parse(x.l), line: x.line }; } catch { return null; } }).filter(x => x != null);
  return recordsSignal(records, "jsonl"); };
const textRead = file => { const raw = fs.readFileSync(file, "utf8"); const format = path.extname(file).slice(1).toLowerCase() || "txt";
  const dateFile = dateParse((path.basename(file).match(/\d{4}-\d{2}-\d{2}/) || [null])[0]);
  const lines = raw.split("\n"); const items = []; let cur = null;
  lines.forEach((line, i) => { const md = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)/);
    if (md) { if (cur) items.push(cur); cur = { text: md[1], line: i + 1 }; }
    else if (cur && line.trim()) cur.text += " " + line.trim();
    else if (cur && !line.trim()) { items.push(cur); cur = null; } });
  if (cur) items.push(cur);
  if (!items.length) { let money = [], head = 1;
    lines.forEach((line, i) => { if (line.trim()) { if (!money.length) head = i + 1; money.push(line.trim()); }
      else if (money.length) { items.push({ text: money.join(" "), line: head }); money = []; } });
    if (money.length) items.push({ text: money.join(" "), line: head }); }
  return items.filter(m => m.text.trim().length > 3)
    .map(m => ({ text: m.text.trim(), date: dateFile, customerRaw: null, line: m.line, format })); };
const fileRead = file => { const ext = path.extname(file).toLowerCase();
  if (ext === ".csv") return csvRead(file); if (ext === ".json") return jsonRead(file);
  if (ext === ".jsonl") return jsonlRead(file); if (ext === ".md" || ext === ".txt") return textRead(file); return []; };

// --- find input files: argument > K.signal.path > <pm>/signal/ ---
const Extension = /\.(csv|json|jsonl|md|txt)$/i;
const expand = p => { if (!fs.existsSync(p)) return []; const st = fs.statSync(p);
  if (st.isFile()) return Extension.test(p) ? [p] : [];
  return fs.readdirSync(p, { recursive: true }).map(f => path.join(p, String(f))).filter(f => { try { return fs.statSync(f).isFile() && Extension.test(f); } catch { return false; } }); };
const inputPathsOf = paths.length ? paths : (K.signal?.path?.length ? K.signal.path : [path.join(pm, "signal")]);
const files = [...new Set(inputPathsOf.flatMap(expand))];

// Sample values for the "columns not recognized" warning below: at most 2 sample rows/records, at most 2
// values per column (never the whole export - this is a diagnostic line, not a data dump).
const sampleLine = (headers, samples) => headers.map((h, i) => {
  const vals = samples.map(s => Array.isArray(s) ? s[i] : s[h]).filter(v => v != null && String(v).trim()).slice(0, 2);
  return `${h || `col${i + 1}`}: ${vals.map(v => JSON.stringify(String(v).slice(0, 60))).join(", ") || "(empty)"}`;
}).join(" · ");

const warnings = [], sources = [], unrecognizedFiles = [];
let rawSignals = [];
for (const file of files) { let rows = [];
  try { const r = fileRead(file);
    if (r && !Array.isArray(r) && r.unrecognized) {
      unrecognizedFiles.push(file);
      warnings.push(`export ${file}: columns not recognized — agent, map them: ${sampleLine(r.headers, r.samples)}`);
      rows = [];
    } else rows = r || [];
  } catch (e) { warnings.push(`${file}: ${String(e.message).slice(0, 120)}`); }
  sources.push({ path: file, format: rows[0]?.format || path.extname(file).slice(1).toLowerCase(), signal: rows.length });
  rawSignals.push(...rows.map(r => ({ ...r, file }))); }

const GhLimit = 200;
let ghWindow = null;
// `team` in sources.json: GitHub logins of the people who build the product (an array, or one string; case
// and a leading @ don't matter). An issue they open is a work item (a task or a note to self), not a customer asking: it is kept
// out of the signals, so it never counts as demand or as a customer. It is still matched to targets and reported as `workItems`.
const teamLogins = teamLoginsOf(K); // the one reader (sources-file.mjs); lowhanging.mjs uses the same rule
const workItemsRaw = [];
if (GH && K.issue?.repo) { try {
    const js = JSON.parse(execFileSync("gh", ["issue", "list", "-R", K.issue.repo, "--state", "all", "--limit", String(GhLimit), "--json", "number,title,body,createdAt,author,labels"], { encoding: "utf8", maxBuffer: 64 << 20 }));
    const sourceNameOf = `gh:${K.issue.repo}`;
    for (const it of js) { const text = `${it.title} · ${(it.body || "").slice(0, 2000)}`;
      const row = { text, date: dateParse(it.createdAt), customerRaw: it.author?.login || null, file: sourceNameOf, line: `#${it.number}`, format: "github" };
      if (isTeamLogin(teamLogins, it.author?.login)) workItemsRaw.push(row); else rawSignals.push(row); }
    // The window is part of every count taken from these issues: it is the newest GhLimit issues (open and closed), so a
    // count moves when issues arrive. Recorded here so every place that prints a demand number can say what it was counted over.
    const stamps = js.map(it => Date.parse(it.createdAt)).filter(Number.isFinite);
    ghWindow = { kind: "github issues", limit: GhLimit, count: js.length, states: "open and closed", complete: js.length < GhLimit,
      oldest: stamps.length ? new Date(Math.min(...stamps)).toISOString().slice(0, 10) : null, newest: stamps.length ? new Date(Math.max(...stamps)).toISOString().slice(0, 10) : null,
      as_of: new Date().toISOString().slice(0, 10) };
    sources.push({ path: sourceNameOf, format: "github", signal: js.length - workItemsRaw.length, window: ghWindow });
  } catch (e) { warnings.push(`gh issue list could not be read: ${String(e.message).slice(0, 120)}`); } }
else if (GH) warnings.push("--gh was given but sources.json has no issue.repo");

// Privacy: masking rules live in mask.mjs (shared with interview-themes.mjs).

// A fixed order before anything is counted: the same input gives the same numbers whatever order `gh` or a file lists
// them in (the first copy of a duplicate is the one kept, and matching ties are broken by position).
rawSignals.sort((a, b) => (+(a.date || Infinity) - +(b.date || Infinity)) || String(a.file).localeCompare(String(b.file)) || String(a.line).localeCompare(String(b.line), "en", { numeric: true }));

const signalsRaw = rawSignals.filter(s => s.text && s.text.trim()).map(s => ({
  text: s.text.trim().replace(/\s+/g, " "), date: s.date || null, file: s.file, line: s.line, format: s.format,
  customerHash: s.customerRaw ? crypto.createHash("sha256").update(low(String(s.customerRaw).trim())).digest("hex").slice(0, 8) : null,
}));
// Identical text (e.g. a bot repeatedly opening "ai-benchmark: ..." issues) doesn't count as N signals from one
// person; the first one seen is kept, the rest don't count (seen in the first product's --gh trial: ~97 of 200 issues shared
// 5 repeated titles, and without dedup this produced misleading numbers like "58 signals").
// Near-duplicates: bot issues reopen the same text with a different number, date, hash, or
// link (the first product's "ai-benchmark" scan). Reduced to a text skeleton: numbers, 7+ char hashes, URLs, and extra
// whitespace are stripped; items with the same skeleton count as one signal.
const skeleton = t => low(t).replace(/https?:\/\/\S+/g, "u").replace(/\b[0-9a-f]{7,40}\b/g, "h").replace(/\d+/g, "#").replace(/[^\p{L}#]+/gu, " ").trim();
const wasSeenText = new Set(), wasSeenSkeleton = new Set(), duplicate = {}, nearDuplicate = {};
const signals = signalsRaw.filter(s => { const a = low(s.text), i = skeleton(s.text);
  if (wasSeenText.has(a)) { duplicate[s.format] = (duplicate[s.format] || 0) + 1; return false; }
  if (i.length > 20 && wasSeenSkeleton.has(i)) { nearDuplicate[s.format] = (nearDuplicate[s.format] || 0) + 1; return false; }
  wasSeenText.add(a); wasSeenSkeleton.add(i); return true; });
const duplicateN = Object.values(duplicate).reduce((a, b) => a + b, 0), nearDuplicateN = Object.values(nearDuplicate).reduce((a, b) => a + b, 0);
if (duplicateN) warnings.push(`${duplicateN} exact-duplicate texts counted as one signal (${Object.entries(duplicate).map(([k, v]) => `${k} ${v}`).join(", ")})`);
if (nearDuplicateN) warnings.push(`${nearDuplicateN} near-duplicates (only the number, date, hash, or link differs) counted as one signal (${Object.entries(nearDuplicate).map(([k, v]) => `${k} ${v}`).join(", ")})`);
signals.forEach(s => { s.order = tokenOrder(s.text); s.words = [...new Set(s.order)]; });
// Team-authored issues: same text clean-up, no duplicate rules (they are not counted), kept apart from every demand number.
const workItems = workItemsRaw.filter(s => s.text && s.text.trim()).map(s => ({ text: s.text.trim().replace(/\s+/g, " "), line: s.line, date: s.date || null }));
workItems.forEach(s => { s.order = tokenOrder(s.text); s.words = [...new Set(s.order)]; });

// --- targets: matrix rows + request-document items + decisions + psst (lowhanging.json) ---
const goals = [];
if (K.matrix && fs.existsSync(K.matrix)) { const M = matrixRead(K.matrix, { codes: K.matrixCodes }); // both matrix formats
  if (M) { const us = M.biz;
    for (const r of M.lines) { const code = us ? (r.codes?.[us] ?? null) : null;
      const ref = (r.not || "").match(refRe)?.[0]?.replace(/\s+/g, " ") || null;
      const text = `${r.feature} ${r.not || ""}`;
      goals.push({ type: "matrix", ref, title: r.feature, code, state: null, ready: code === "b", notDoing: r.decision === "notDoing", text }); } } }
if (K.request) { const doc = show(K.request.path), hRe = new RegExp(K.request.title, "gm"), sRe = new RegExp(K.request.state);
  const secs = []; let m; while ((m = hRe.exec(doc))) secs.push({ no: m[1], name: m[2], at: m.index });
  secs.forEach((s, i) => { s.body = doc.slice(s.at, secs[i + 1]?.at ?? doc.length); s.state = (s.body.match(sRe) || [, null])[1]; });
  for (const s of secs) { if (!/^\d+$/.test(s.no)) continue;
    goals.push({ type: "request", ref: `§${s.no}`, title: `§${s.no} ${s.name}`.slice(0, 140), code: null, state: s.state || null, ready: false, notDoing: false, text: `${s.name} ${s.body}` }); } }
if (K.preread?.decisions) { const src = show(K.preread.decisions);
  for (const b of blocks(src, "^## K\\d+")) { const ref = (b.match(/^##\s*(K\d+)/) || [, null])[1]; if (!ref) continue;
    const title = (b.match(/^##\s*(.+)$/m) || [, ref])[1].trim().slice(0, 140);
    goals.push({ type: "decision", ref, title, code: null, state: null, ready: false, notDoing: NotDoingRe.test(b), text: b }); } }
const lowPath = path.join(pm, "state", "lowhanging.json");
if (fs.existsSync(lowPath)) { const L = JSON.parse(fs.readFileSync(lowPath, "utf8"));
  for (const mad of (L.items || [])) { const text = `${mad.title} ${mad.evidence || ""} ${(mad.detail || []).join(" ")}`;
    goals.push({ type: "psst", ref: text.match(refRe)?.[0] || null, title: mad.title, code: null, state: null,
      ready: /^(Backend ready, not on screen|Served, no screen)/.test(mad.type || ""), notDoing: false, text }); } }
goals.forEach(h => h._low = smallAscii(h.text));

// --- matching: rarity-weighted (idf, over the target text), word-start, linear penalty for a long target ---
const vocab = [...new Set([...signals, ...workItems].flatMap(s => s.words))];
const N = goals.length || 1;
const idf = Object.fromEntries(vocab.map(w => { const df = goals.filter(h => reOf(w).test(h._low)).length; return [w, df ? Math.log((N + 1) / df) : 0]; }));
const avgLen = goals.reduce((s, h) => s + h._low.length, 0) / N || 1;
// Threshold tuned on the example data (52 CSV + 14 interview signals, against the first product's matrix/request/decisions;
// ~30 candidate pairs checked by hand): a LINEAR penalty for target length (a square root stayed too soft — a
// short decision block was falsely matching a few generic words) and a threshold of 16. At 16, in a full count
// 6 of 8 matches were correct (75%); lowering the threshold quickly raises the false-match rate. This is the
// ceiling of a rough bag-of-words approach; internal request (line 16, log.md).
// K.signal.threshold (the old, product-specific key) always takes priority; otherwise thresholds.mjs's
// signalThreshold (sources.json thresholds.signalThreshold, default 16 otherwise — both fall back to the same default).
const Threshold = K.signal?.threshold ?? ES.signalThreshold;

goals.forEach(h => h.signals = []);
const unmatchedOnes = [];
const candidatesOf = s => goals.map(h => { let sc = 0; for (const w of s.words) if (reOf(w).test(h._low)) sc += idf[w] || 0;
    return { h, sc: sc / Math.max(1, h._low.length / avgLen) }; })
    .filter(x => x.sc >= Threshold).sort((a, b) => b.sc - a.sc).slice(0, 2);
for (const s of signals) {
  const cand = candidatesOf(s);
  if (!cand.length) { unmatchedOnes.push(s); continue; }
  for (const { h, sc } of cand) h.signals.push({ s, sc });
}
// Work items go through the same matching, but only to be counted per target: they never enter h.signals, so no count, customer,
// trend or example above includes them.
const workByGoal = new Map(); let workMatched = 0;
for (const s of workItems) { const cand = candidatesOf(s); if (cand.length) workMatched++; for (const { h } of cand) workByGoal.set(h, (workByGoal.get(h) || 0) + 1); }
const workItemsOut = workItems.length ? { count: workItems.length, matched: workMatched,
  goals: [...workByGoal].map(([h, count]) => ({ type: h.type, ref: h.ref, title: h.title, count })).sort((a, b) => b.count - a.count).slice(0, 20) } : null;

// "Now" is the end of today (UTC), so the trend numbers do not move between two runs on the same day.
const DayMs = Day * 864e5, Now = new Date().setUTCHours(23, 59, 59, 999);
const summary = h => { const record = h.signals;
  const customerSet = new Set(record.map(x => x.s.customerHash).filter(Boolean));
  const sourceDistribution = {}; for (const { s } of record) sourceDistribution[s.format] = (sourceDistribution[s.format] || 0) + 1;
  const dated = record.filter(x => x.s.date).map(x => +x.s.date);
  const first = dated.length ? new Date(Math.min(...dated)).toISOString().slice(0, 10) : null;
  const lastValue = dated.length ? new Date(Math.max(...dated)).toISOString().slice(0, 10) : null;
  const last30 = record.filter(x => x.s.date && Now - x.s.date <= DayMs).length;
  const previous30 = record.filter(x => x.s.date && Now - x.s.date > DayMs && Now - x.s.date <= 2 * DayMs).length;
  const examples = Quote > 0 ? record.slice().sort((a, b) => b.sc - a.sc).slice(0, Quote).map(({ s }) => ({
    source: `${path.basename(String(s.file))}:${s.line}`, date: s.date ? s.date.toISOString().slice(0, 10) : null, text: mask(s.text).slice(0, 160) })) : [];
  return { count: record.length, customer: customerSet.size, source: sourceDistribution, first, last: lastValue, trend: { last30, previous30 }, examples }; };

const goalsOut = goals.filter(h => h.signals.length).map(h => { const stats = summary(h);
  return { type: h.type, ref: h.ref, title: h.title, code: h.code, state: h.state, count: stats.count, customer: stats.customer,
    source: stats.source, first: stats.first, last: stats.last, trend: stats.trend, ready: h.ready, notDoing: h.notDoing, examples: stats.examples }; })
  .sort((a, b) => b.count - a.count || (b.ready ? 1 : 0) - (a.ready ? 1 : 0));

// --- unmatched: simple deterministic theme clustering. Two-word phrases are more "distinctive" than single
// words (a request/demand verb like "istiyoruz" appears in nearly every signal and can't be a theme on its own),
// so pairs are tried first (adjacent, from tokenOrder — order matters, not a Set), then singles for what's left.
const claimed = new Set(); const themes = [];
const candidateSetup = (nameSec) => { const m = new Map();
  unmatchedOnes.forEach((s, ix) => { if (claimed.has(ix)) return; for (const g of new Set(nameSec(s))) { if (!m.has(g)) m.set(g, new Set()); m.get(g).add(ix); } });
  return [...m.entries()].filter(([, set]) => set.size >= 2).sort((a, b) => b[1].size - a[1].size); };
const aggregate = (candidates) => { for (const [key, set] of candidates) { if (themes.length >= 10) break;
    const members = [...set].filter(i => !claimed.has(i)); if (members.length < 2) continue;
    members.forEach(i => claimed.add(i));
    const exampleN = Math.min(2, Quote > 0 ? 2 : 0);
    themes.push({ key, count: members.length, examples: members.slice(0, exampleN).map(i => { const s = unmatchedOnes[i];
      return { source: `${path.basename(String(s.file))}:${s.line}`, date: s.date ? s.date.toISOString().slice(0, 10) : null, text: mask(s.text).slice(0, 160) }; }) }); } };
aggregate(candidateSetup(s => s.order.slice(0, -1).map((w, i) => `${w} ${s.order[i + 1]}`)));
if (themes.length < 10) aggregate(candidateSetup(s => s.words));

// --- report (stdout) ---
let o = `# Demand signal · ${new Date().toISOString().slice(0, 10)} · ${signals.length} signals (${files.length} files${GH ? " + gh" : ""}), ${goalsOut.length} targets matched, ${unmatchedOnes.length} unmatched\n\n`;
o += `Sources: ${sources.map(k => `${k.path} (${k.format}, ${k.signal})`).join(" · ") || "—"}\n\n`;
if (ghWindow) o += `GitHub window: ${windowText(ghWindow)}. A count from these issues is a topic cluster of related issues within this window, not the number of times one thing was asked.\n\n`;
if (workItemsOut) o += `Team-authored issues (sources.json \`team\`): ${workItemsOut.count} are work items, not demand: left out of every count above (${workItemsOut.matched} match a target).\n\n`;
if (warnings.length) o += `Warnings: ${warnings.join(" · ")}\n\n`;
const prepares = goalsOut.filter(h => h.ready);
if (prepares.length) { o += `## Demand + ready (${prepares.length})\n\nBackend is ready or the screen is missing, and the customer wants it — can be done now.\n\n| Target | Ref | Signals | Customers | Last${Day}d/previous |\n|---|---|---|---|---|\n`;
  prepares.forEach(h => o += `| ${h.title.replace(/\|/g, "/").slice(0, 70)} | ${h.ref || "—"} | ${h.count} | ${h.customer} | ${h.trend.last30}/${h.trend.previous30} |\n`); o += "\n"; }
o += `## Targets (${goalsOut.length})\n\n| Type | Ref | Title | Code | State | Signals | Customers | First–Last | Trend | Ready | Decision |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
goalsOut.forEach(h => o += `| ${h.type} | ${h.ref || "—"} | ${h.title.replace(/\|/g, "/").slice(0, 70)} | ${h.code || "—"} | ${h.state || "—"} | ${h.count} | ${h.customer} | ${h.first || "?"}–${h.last || "?"} | ${h.trend.last30}/${h.trend.previous30} | ${h.ready ? "yes" : ""} | ${h.notDoing ? "not doing ⚠" : ""} |\n`);
if (Quote > 0) { o += `\n## Examples\n\n`; goalsOut.slice(0, 15).forEach(h => { if (h.examples.length) o += `**${h.title}**\n${h.examples.map(e => `- ${e.source} (${e.date || "?"}): "${e.text}"`).join("\n")}\n\n`; }); }
o += `## Unmatched themes (${themes.length} themes, ${unmatchedOnes.length} unmatched signals)\n\nCould be a candidate for a new matrix row; a decision-maker decides, the tool doesn't write one.\n\n`;
themes.forEach((t, i) => { o += `${i + 1}. **${t.key}** — ${t.count} signals${t.examples.length ? "\n" + t.examples.map(e => `   - ${e.source}: "${e.text}"`).join("\n") : ""}\n`; });
o += `\nPrivacy: email, phone, national ID, IBAN, card number, and URL token/key are masked in quotes; the raw value is never printed. Customer count is tallied by the first 8 hex chars of a sha256 hash.\n`;
process.stdout.write(o);
if (jsonOut) fs.writeFileSync((fs.mkdirSync(path.dirname(jsonOut), { recursive: true }), jsonOut), JSON.stringify({ type: "signal", generated: new Date().toISOString(), sources,
  total: signals.length, matching: signals.length - unmatchedOnes.length, goals: goalsOut, themes, unmatched: unmatchedOnes.length,
  unrecognized: unrecognizedFiles, ...(workItemsOut ? { workItems: workItemsOut } : {}) }, null, 1));
// Exit contract (docs/CLI-CONTRACT.md): 2 = ran, found something that needs a look. An export whose columns
// couldn't be confidently mapped is exactly that - never a silent 0-signals pass.
process.exitCode = unrecognizedFiles.length ? 2 : 0;
