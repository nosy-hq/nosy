// A quick evidence pack for a PRD: looks up a topic in decisions, the request doc, rival files, the
// matrix, and recent commits.
// Usage: node gather-evidence.mjs <pm folder> "<topic>" [extra keywords...]
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { matrixRead } from "./read-matrix.mjs"; import { small, smallAscii, root, matchRe, words as tokenize, langOfLoad } from "./text.mjs"; import { decisionsOfRead } from "./read-decisions.mjs";
import { readSources } from "./sources-file.mjs";
const [pm = "pm", topic = "", ...extra] = process.argv.slice(2);
const K = readSources(pm);
langOfLoad(K); // sources.json's `language`, read once so words()/root() below pick the product's language
const low = small; // text.mjs: gets I/i right + faster than toLocaleLowerCase("tr-TR") on large text
// Two-way glossary expansion: sources.json's `glossary` = {"<TR word>": ["stage", ...]}.
// Given a Turkish key, its English match is also added; given an English term, its Turkish key is also added.
// Expansion happens BEFORE stemming, on the raw (original) words; glossary keys are also unstemmed.
const glossary = K.glossary || {};
const reverseGlossary = {}; for (const [tr, ens] of Object.entries(glossary)) for (const en of ens || []) (reverseGlossary[low(en)] ??= []).push(tr);
const expand = raw => { const added = new Set(); for (const w of raw) { const lw = low(w); for (const e of glossary[lw] || []) added.add(e); for (const t of reverseGlossary[lw] || []) added.add(t); } return [...added]; };
// Topic split: text.mjs's words() instead of a hand-rolled ".split(/[\s,]+/).filter(w
// => w.length > 2)" - the same minLength=2 default (identical output for Latin-script topics: every existing
// English/Turkish caller sees the same words), but now script-aware for a CJK/Hangul/Thai topic (a Japanese
// two-character query like "配送 移動" used to be silently dropped by the length filter before anything could
// ever be searched for - the language audit's "gather-evidence Japanese returns 0 keywords" finding).
const raw = tokenize([topic, ...extra].join(" "), 2);
const wide = expand(raw); // raw words added from the glossary (shown separately in the report header)
const fresh = new Set([...new Set(wide.map(root))].filter(w => !new Set(raw.map(root)).has(w))); // stems that only came from the glossary
const words = [...new Set([...raw, ...wide].map(root))];
// Matches from a word start (can take a suffix, e.g. a Turkish inflected form), a short root doesn't snag on
// an unrelated longer word; ASCII-folded (text.mjs matchRe): text typed on an ASCII
// keyboard is found when searching the correctly-accented spelling, and vice versa. Target text must be
// prepared with smallAscii() so the ASCII branch works.
const wre = Object.fromEntries(words.map(w => [w, matchRe(w)]));
// Rarity: a word that shows up everywhere counts less than a rare word.
// idf is set up later, once all candidates are gathered.
let idf = Object.fromEntries(words.map(w => [w, 1]));
const hit = t => { const l = smallAscii(t); return +words.reduce((s, w) => s + (wre[w].test(l) ? idf[w] : 0), 0).toFixed(2); };
const setupIdf = docs => { const N = docs.length || 1, L = docs.map(smallAscii);
  idf = Object.fromEntries(words.map(w => { const df = L.filter(d => wre[w].test(d)).length; return [w, df ? Math.log((N + 1) / df) : 0]; })); };
const show = f => { try { return execFileSync("git", ["-C", K.repo, "show", `${K.ref}:${f}`], { encoding: "utf8", maxBuffer: 64 << 20 }); } catch { return ""; } };
const blocks = (src, re) => { const out = []; let m, last = null; const r = new RegExp(re, "gm");
  while ((m = r.exec(src))) { if (last) out.push(src.slice(last.i, m.index)); last = { i: m.index }; } if (last) out.push(src.slice(last.i)); return out; };
// A long block contains every word by chance: if it's longer than average, its score drops by the square-root ratio.
const top = (arr, n) => { const avg = arr.reduce((s, t) => s + t.length, 0) / (arr.length || 1);
  return arr.map(t => ({ t, s: hit(t) / Math.sqrt(Math.max(1, t.length / avg)) })).filter(x => x.s).sort((a, b) => b.s - a.s).slice(0, n); };
// read-decisions.mjs: K.preread.decisions can be a single file/directory/glob; only consumed here.
let decisionB = []; try { decisionB = decisionsOfRead({ ...K, preread: { ...K.preread, decisions: K.preread?.decisions || "DECISIONS.md" } }).map(k => k.text); } catch {}
const requestB = K.request ? blocks(show(K.request.path), K.request.title) : [];
const rivalDir = path.join(pm, "..", "references");
const rivalFiles = [path.join(pm, "rivals"), rivalDir].filter(d => fs.existsSync(d)).flatMap(d => fs.readdirSync(d, { recursive: true }).filter(f => String(f).endsWith(".md")).map(f => path.join(d, String(f))));
const money = rivalFiles.flatMap(f => fs.readFileSync(f, "utf8").split(/\n\s*\n/).map(p => ({ f, p })));
const M = K.matrix ? matrixRead(K.matrix) : null; // either matrix shape
const log = execFileSync("git", ["-C", K.repo, "log", "--no-merges", "--since=30.days", "--format=%h %ad %an | %s", "--date=short", K.ref], { encoding: "utf8" }).split("\n").filter(Boolean);
setupIdf([...decisionB, ...requestB, ...money.map(x => x.p), ...(M?.lines || []).map(r => r.feature + " " + r.not), ...log]);
// internal request 72 (kill criterion 1: word/title similarity checked against real GitHub history was only
// 9% correct as a "shipped/exists" signal — see pm/log.md, "kill criterion 1, second run"): every block below
// is picked by word-overlap scoring (hit()/top()), not an explicit reference. That's fine as raw evidence for
// a human/agent to read, but a caller must never restate a block's wording (e.g. "ships this sprint") as a
// confirmed shipped/exists/done/in-main fact on its own — it's a candidate to confirm, same as any T3-style match.
let o = `# Evidence pack: ${topic}\n\nKeywords (rarity weight): ${words.map(w => `${w}${fresh.has(w) ? "†" : ""} ${idf[w].toFixed(1)}`).join(", ")}${wide.length ? ` · † expanded from the glossary: ${wide.join(", ")}` : ""} · ${K.ref}\n\nCandidates — confirm: every section below is chosen by word/title overlap, not an explicit reference (issue/PR/commit link). Treat a match as a lead, not proof something shipped, exists, or is in main.\n\n`;
o += `## Decisions\n\n${top(decisionB, 4).map(x => x.t.trim().slice(0, 1500)).join("\n\n---\n\n") || "—"}\n\n`;
if (K.request) o += `## Request doc\n\n${top(requestB, 4).map(x => x.t.trim().slice(0, 1500)).join("\n\n---\n\n") || "—"}\n\n`;
o += `## Rivals\n\n${money.map(x => ({ ...x, s: hit(x.p) })).filter(x => x.s).sort((a, b) => b.s - a.s).slice(0, 8).map(x => `- **${path.relative(path.join(pm, ".."), x.f)}:** ${x.p.replace(/\s+/g, " ").slice(0, 400)}`).join("\n") || "—"}\n\n`;
if (M?.lines) {
  o += `## Matrix\n\n${M.lines.filter(r => hit(r.feature + " " + r.not)).map(r => `- ${r.feature}: ${Object.entries(r.codes).map(([p, v]) => `${p} ${v}`).join(", ")} — ${r.not}`).join("\n") || "—"}\n\n`; }
o += `## Commits from the last 30 days\n\n${log.map(l => ({ l, s: hit(l) })).filter(x => x.s).sort((a, b) => b.s - a.s).map(x => x.l).slice(0, 15).map(l => `- ${l}`).join("\n") || "—"}\n`;
process.stdout.write(o);
