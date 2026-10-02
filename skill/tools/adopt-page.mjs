// adopt-page: keep a hand-built decision page up to date without rebuilding it. build-page.mjs only builds from
// scratch, so an owner who had drawn their own page (tables from JS arrays, tables in HTML) fixed 14+ rows by hand after every cycle.
// Usage: node adopt-page.mjs adopt   <pm> [--page <file>] [--dry-run] [--apply --yes]
//        node adopt-page.mjs refresh <pm> [--page <file>] [--dry-run]
//        node adopt-page.mjs undo    <pm> [--page <file>] [--force]
//   adopt    reads the page (default <pm>/page.html), finds its tables (HTML <table> elements, and `const NAME = [ {…}, … ]` arrays inside
//            <script>) and says, for each, which Nosy data could feed it: "your table -> Nosy source -> N rows match, M differ". It matches
//            by what is IN the table (an identity column whose cells are the step numbers / feature names / PR numbers / titles Nosy has,
//            then the other columns by their values), never by the words of the headers alone, so a page in any language works. A table it
//            can't match with confidence is reported "not matched" and left alone. Nothing is written without `--apply --yes`.
//   --apply  (needs --yes, the owner's go-ahead) puts a comment around exactly those tables: `<!-- pm:table <source> … -->` before,
//            `<!-- /pm:table -->` after (inside a <script> as `// <!-- … -->` lines), after copying the page to <pm>/.backup/page-<stamp>.html.
//   refresh  rewrites ONLY the marked tables from the current data: a row the owner has keeps its place and only its fed cells change;
//            rows Nosy has and the table lacks are appended at the end; rows Nosy no longer has get `data-gone` (a `gone: true` property
//            in an array) instead of being deleted. Every other byte of the page, the `<!-- pm:auto -->` block included, stays as it is.
//   undo     puts the newest page backup back (refuses when the page changed since, unless --force; the page as it is now is kept too).
// Sources (read only): matrix (pm/matrix.json: rows and one code column per product), status.groups / status.prs (pm/state/status.json),
//   lowhanging (pm/state/lowhanging.filtered.json, else lowhanging.json), waves (pm/state/waves.json tasks). Authors, branches and detail
//   lines are never offered as columns: what a table is fed with is what auto-section.mjs may show (shareable).
// Also: a cell (or array string) of an adopted OR unmarked table that says PR #N is open, when git (or gh) says it merged or closed, is
//   listed as stale wording. Report only; the owner's prose is never rewritten.
// No dependencies; git and gh only for that last check, and only when present.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { readSourcesSafe } from "./sources-file.mjs"; import { matrixRead } from "./read-matrix.mjs"; import { esc } from "./html-safe.mjs"; import { nosyCommand } from "./hints.mjs";

const BACKUP = ".backup";
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };

// ---------------------------------------------------------------------------------------------------------------------------------
// Text helpers. A cell is compared by its visible text: tags gone, entities decoded, case and spacing folded. A key cell is a number
// ("#7", "07", "7.") or text.
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", middot: "·", bull: "•" };
const plain = h => String(h ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ")
  .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(+(e[1].toLowerCase() === "x" ? `0x${e.slice(2)}` : e.slice(1)) || 32) : ENT[e.toLowerCase()] ?? " ");
const norm = s => plain(s).normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim().replace(/^[\s.:;,]+|[\s.:;,]+$/g, "");
const isNum = s => /^-?\d+(\.\d+)?$/.test(s);
const nkey = s => { const n = norm(s), m = n.match(/^#?\s*0*(\d+)$/); return m ? `n:${+m[1]}` : n ? `s:${n}` : ""; };
const numOf = s => { const m = String(s).match(/^#?(-?\d+(?:\.\d+)?)$/); return m ? +m[1] : null; };
const same = (a, b) => { const x = norm(a), y = norm(b); if (x === y) return true; const p = numOf(x), q = numOf(y); return p !== null && p === q; };
const enc = encodeURIComponent, dec = s => { try { return decodeURIComponent(s); } catch { return s; } };
const lineIndex = text => { const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1); return at => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= at) lo = m; else hi = m - 1; } return lo + 1; }; };

// ---------------------------------------------------------------------------------------------------------------------------------
// A small reader for JS data literals (no eval: the page is the owner's, but running it isn't this tool's job). Strings, numbers,
// true/false/null, bare names (kept as they are), arrays, objects with plain keys, comments. Anything that is code (calls, templates
// with ${}, spreads, computed keys, shorthand properties, operators) throws Bad, and the array is reported as unreadable. Every node
// remembers where it sits in the text, so a refresh edits the values and leaves the rest of the script alone.
class Bad extends Error {}
function readLiteral(src, at) {
  let i = at;
  const ws = () => { for (;;) { while (i < src.length && /\s/.test(src[i])) i++; if (src.startsWith("//", i)) { while (i < src.length && src[i] !== "\n") i++; } else if (src.startsWith("/*", i)) { const e = src.indexOf("*/", i + 2); if (e < 0) throw new Bad("an unterminated comment"); i = e + 2; } else return; } };
  const str = () => {
    const q = src[i], start = i++; let v = "";
    for (;;) {
      const c = src[i++];
      if (c === undefined) throw new Bad("an unterminated string");
      if (c === q) return { t: "str", v, q, start, end: i };
      if (c === "\n" && q !== "`") throw new Bad("a string that runs over a line");
      if (q === "`" && c === "$" && src[i] === "{") throw new Bad("a template with ${}");
      if (c !== "\\") { v += c; continue; }
      const e = src[i++];
      if (e === "n") v += "\n"; else if (e === "t") v += "\t"; else if (e === "r") v += "\r"; else if (e === "b") v += "\b"; else if (e === "f") v += "\f"; else if (e === "v") v += "\v"; else if (e === "0") v += "\0";
      else if (e === "x") { v += String.fromCharCode(parseInt(src.slice(i, i + 2), 16)); i += 2; }
      else if (e === "u" && src[i] === "{") { const j = src.indexOf("}", i); v += String.fromCodePoint(parseInt(src.slice(i + 1, j), 16)); i = j + 1; }
      else if (e === "u") { v += String.fromCharCode(parseInt(src.slice(i, i + 4), 16)); i += 4; }
      else if (e === "\n") { /* line continuation */ } else v += e;
    }
  };
  const value = depth => {
    if (depth > 40) throw new Bad("too deep"); ws();
    const c = src[i], start = i;
    if (c === '"' || c === "'" || c === "`") return str();
    if (c === "[") { i++; const items = []; for (;;) { ws(); if (src[i] === "]") { i++; break; } items.push(value(depth + 1)); ws(); if (src[i] === ",") { i++; continue; } if (src[i] === "]") { i++; break; } throw new Bad("code, not plain data (a call or an expression)"); } return { t: "arr", items, start, end: i }; }
    if (c === "{") {
      i++; const props = [];
      for (;;) {
        ws(); if (src[i] === "}") { i++; break; }
        let key, keyStart = i, kq = "";
        if (src[i] === '"' || src[i] === "'") { const k = str(); key = k.v; kq = k.q; }
        else { const m = src.slice(i).match(/^[A-Za-z_$][\w$]*|^\d+/); if (!m) throw new Bad("a computed or spread property"); key = m[0]; i += m[0].length; }
        const keyEnd = i; ws();
        if (src[i] !== ":") throw new Bad("a shorthand property or a method");
        i++; const node = value(depth + 1); props.push({ key, keyStart, keyEnd, kq, node }); ws();
        if (src[i] === ",") { i++; continue; } if (src[i] === "}") { i++; break; } throw new Bad("code, not plain data (a call or an expression)");
      }
      return { t: "obj", props, start, end: i };
    }
    let m = src.slice(i).match(/^[+-]?(?:0x[\da-f]+|\d[\d_]*(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+)/i);
    if (m) { i += m[0].length; return { t: "num", v: Number(m[0].replace(/_/g, "")), start, end: i }; }
    m = src.slice(i).match(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/);
    if (m) { i += m[0].length; return m[0] === "true" || m[0] === "false" ? { t: "bool", v: m[0] === "true", start, end: i } : m[0] === "null" ? { t: "null", start, end: i } : { t: "raw", v: m[0], start, end: i }; }
    throw new Bad("code the reader doesn't parse");
  };
  const node = value(0); ws();
  return node;
}
const jsText = n => n.t === "str" ? n.v : n.t === "num" || n.t === "bool" || n.t === "raw" ? String(n.v) : n.t === "null" ? "" : null; // null: nested, not a cell
const jsQuote = (s, q) => { const o = String(s).replace(/\\/g, "\\\\").replace(new RegExp(q === "`" ? "[`$]" : q, "g"), m => `\\${m}`).replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/</g, "\\u003c"); return `${q}${o}${q}`; };

// ---------------------------------------------------------------------------------------------------------------------------------
// Where the tables are. A table is { kind, name, start, end, cols: [{loc, header}], rows: [...], problem? }; a row's `cell(loc)` gives
// { text, edit: [from, to] } (the span a new value replaces). `loc` is the cell's column index in HTML, the property name in an array.
const spansOf = (html, re) => [...html.matchAll(re)].map(m => ({ start: m.index, end: m.index + m[0].length, m }));
const inside = (spans, at) => spans.some(s => at >= s.start && at < s.end);

function htmlTableAt(html, start) {
  // The matching </table>, counting inner <table>s: a nested table isn't read.
  let depth = 0, end = -1, nested = false;
  for (const m of html.slice(start).matchAll(/<(\/?)table\b[^>]*>/gi)) { if (m[1]) { depth--; if (!depth) { end = start + m.index + m[0].length; break; } } else { depth++; if (depth > 1) nested = true; } }
  const T = { kind: "html", name: "", start, end, cols: [], rows: [] };
  if (end < 0) return { ...T, end: start, problem: "the table is never closed" };
  const inner = html.slice(start, end);
  if (nested) return { ...T, problem: "it has a table inside it" };
  const open = c => (inner.match(new RegExp(`<${c}\\b`, "gi")) || []).length, close = c => (inner.match(new RegExp(`</${c}\\s*>`, "gi")) || []).length;
  if (open("tr") !== close("tr") || open("td") + open("th") !== close("td") + close("th")) return { ...T, problem: "it leaves out closing tags (</tr>, </td>), so the cells can't be told apart safely" };
  const sec = name => spansOf(inner, new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?</${name}\\s*>`, "gi"));
  const head = sec("thead"), foot = sec("tfoot");
  const rows = [];
  for (const m of inner.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr\s*>/gi)) {
    const rs = start + m.index, body = rs + m[0].indexOf(">") + 1, cells = [];
    for (const c of m[2].matchAll(/<(t[hd])\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)) {
      const from = body + c.index + c[0].indexOf(">") + 1;
      cells.push({ tag: c[1].toLowerCase(), attrs: c[2], start: body + c.index, from, to: from + c[3].length, html: c[3], text: plain(c[3]).replace(/\s+/g, " ").trim() });
    }
    rows.push({ start: rs, end: rs + m[0].length, openEnd: rs + m[0].indexOf(">") + 1, open: m[0].slice(0, m[0].indexOf(">") + 1), cells, head: inside(head, m.index), foot: inside(foot, m.index) });
  }
  if (rows.some(r => r.cells.some(c => /\b(?:colspan|rowspan)\s*=\s*["']?(?!1\b)\d/i.test(c.attrs)))) return { ...T, problem: "it merges cells (colspan/rowspan)" };
  const headRow = rows.filter(r => r.head).at(-1) || (rows.length && rows[0].cells.length && rows[0].cells.every(c => c.tag === "th") ? rows[0] : null);
  const data = rows.filter(r => !r.head && !r.foot && r !== headRow && r.cells.some(c => c.tag === "td"));
  const width = [...data.reduce((m, r) => m.set(r.cells.length, (m.get(r.cells.length) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
  const regular = data.filter(r => r.cells.length === width);
  if (data.length && regular.length < data.length * 0.8) return { ...T, problem: "its rows have different numbers of cells" };
  T.cols = Array.from({ length: width }, (_, i) => ({ loc: i, header: headRow?.cells[i]?.text || "" }));
  T.rows = regular.map(r => ({ ...r, cell: loc => { const c = r.cells[loc]; return c ? { text: c.text, html: c.html, tag: c.tag, attrs: c.attrs, start: c.start, edit: [c.from, c.to] } : null; } }));
  return T;
}

function jsArrayAt(js, at, abs) { // `at`: index of "[" in js; `abs`: offset of js in the page
  let node; try { node = readLiteral(js, at); } catch (e) { return { kind: "js", cols: [], rows: [], problem: e instanceof Bad ? `it holds ${e.message}` : "it can't be read" }; }
  if (node.t !== "arr" || !node.items.length || node.items.some(x => x.t !== "obj")) return null; // not an array of objects: not a table
  const T = { kind: "js", name: "", start: abs + at, end: abs + node.end, cols: [], rows: [] };
  const keys = [...new Set(node.items.flatMap(o => o.props.map(p => p.key)))];
  T.cols = keys.map(k => ({ loc: k, header: k }));
  T.rows = node.items.map(o => ({ start: abs + o.start, end: abs + o.end, obj: o, abs,
    cell: loc => { const p = o.props.find(q => q.key === loc); if (!p) return null; const text = jsText(p.node); return text === null ? null : { text, prop: p, edit: [abs + p.node.start, abs + p.node.end] }; } }));
  return T;
}

// The marked regions already on the page: [{ source, attrs, start, end (the comments included), from, to (what's between them) }].
function markedRegions(html) {
  const out = [];
  for (const m of html.matchAll(/<!-- pm:table ([^\s>]+)((?:\s[^>]*?)?)\s*-->/g)) {
    const close = html.indexOf("<!-- /pm:table -->", m.index + m[0].length);
    out.push({ source: m[1], attrs: m[2].trim(), start: m.index, from: m.index + m[0].length, to: close < 0 ? -1 : close, end: close < 0 ? -1 : close + "<!-- /pm:table -->".length });
  }
  return out;
}

// True when the first thing after `at` (comments skipped) is an object's "{".
function startsWithObject(js, at) { let i = at; for (;;) { while (/\s/.test(js[i] || "")) i++; if (js.startsWith("//", i)) { while (i < js.length && js[i] !== "\n") i++; } else if (js.startsWith("/*", i)) { const e = js.indexOf("*/", i + 2); if (e < 0) return false; i = e + 2; } else return js[i] === "{"; } }

// Every table on the page that isn't Nosy's own block and isn't marked yet.
function findTables(html) {
  const lines = lineIndex(html), skip = [...spansOf(html, /<!-- pm:auto -->[\s\S]*?<!-- \/pm:auto -->/g), ...markedRegions(html).filter(r => r.end > 0)];
  const scripts = spansOf(html, /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi).filter(x => { const ty = (x.m[1].match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1]; return !/\bsrc\s*=/i.test(x.m[1]) && (!ty || /^(?:text\/javascript|module|application\/javascript)$/i.test(ty)); });
  const dead = [...spansOf(html, /<!--[\s\S]*?-->/g), ...spansOf(html, /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi), ...spansOf(html, /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)];
  const tables = [];
  for (const m of html.matchAll(/<table\b[^>]*>/gi)) {
    if (inside(dead, m.index) || inside(skip, m.index) || tables.some(t => m.index < t.end)) continue;
    const T = htmlTableAt(html, m.index); T.line = lines(m.index); T.name = `table at line ${T.line}`; tables.push(T);
  }
  for (const sc of scripts) {
    const js = sc.m[2], base = sc.start + sc.m[0].indexOf(">") + 1;
    for (const m of js.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?=\[)/g)) {
      if (inside(skip, base + m.index)) continue;
      const at = m.index + m[0].length;
      if (!startsWithObject(js, at + 1)) continue; // an array of something else is not a table
      const T = jsArrayAt(js, at, base); if (!T) continue;
      // Where the statement starts and ends (the `;` after the array, if any): the markers go around all of it.
      const semi = js.slice(T.end - base).match(/^\s*;/);
      Object.assign(T, { name: `const ${m[1]}`, array: m[1], stmtStart: base + m.index, stmtEnd: T.end + (semi ? semi[0].length : 0), line: lines(base + m.index) });
      tables.push(T);
    }
  }
  return tables.sort((a, b) => (a.stmtStart ?? a.start) - (b.stmtStart ?? b.start));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Nosy's data, as tables of rows { f: { field: text } }. A source says which fields can identify a row (`keys`), whether it is a ranked
// list that changes every run (`ranked`: a page table keeps its own length, so Nosy's newest rows don't pile up), and its product code
// columns (matrix).
function datasets(pm, K) {
  const st = f => readJson(path.join(pm, "state", f)), out = {};
  const add = (id, label, file, keys, rows, extra = {}) => { if (rows.length) out[id] = { id, label, file, keys: keys.filter(k => rows.some(r => (r.f[k] ?? "") !== "")), rows, ...extra }; };
  const mpath = [path.join(pm, "matrix.json"), K?.matrix].find(p => p && fs.existsSync(p));
  const M = mpath ? matrixRead(mpath, { codes: K?.matrixCodes }) : null;
  if (M?.lines?.length) add("matrix", "matrix", "pm/matrix.json", ["no", "feature"], M.lines.map(l => ({ f: { ...(l.no != null ? { no: String(l.no) } : {}), feature: l.feature ?? "", ...(l.group ? { group: l.group } : {}), not: l.not ?? "", ...Object.fromEntries(Object.entries(l.codes || {}).map(([p, c]) => [`code:${p}`, c ?? ""])) } })), { products: M.products || [] });
  const S = st("status.json");
  if (S?.groups?.length) add("status.groups", "status.groups", "pm/state/status.json", ["ref"], S.groups.filter(g => g.ref && g.ref !== "(no ref)").map(g => ({ f: { ref: g.ref, n: String(g.n), topic: g.topic ?? "", last: g.last ?? "", where: (g.where || []).join(", ") } })), { ranked: true });
  if (S?.prs?.length) add("status.prs", "status.prs", "pm/state/status.json", ["n", "title"], S.prs.map(p => ({ f: { n: String(p.n), title: p.t ?? "", count: String(p.count ?? ""), draft: p.draft ? "draft" : "", last: p.last ?? "" } })), { ranked: true });
  const L = st("lowhanging.filtered.json") || st("lowhanging.json");
  // The evidence of an issue is its reporter's login: not offered (auto-section.mjs doesn't show it either).
  if (L?.items?.length) add("lowhanging", "lowhanging", fs.existsSync(path.join(pm, "state", "lowhanging.filtered.json")) ? "pm/state/lowhanging.filtered.json" : "pm/state/lowhanging.json", ["title", "ref"], L.items.filter(m => m.type !== "Warning").map(m => ({ f: { title: m.title ?? "", ref: m.ref ?? "", score: String(m.score ?? ""), effort: m.effort || "?", type: m.type ?? "", evidence: m.type === "Issue opened against us" ? "" : String(m.evidence ?? "") } })), { ranked: true });
  const W = st("waves.json");
  const tasks = (W?.waves || []).flatMap(w => (w.tasks || []).map(t => ({ f: { title: t.title ?? "", ref: t.ref ?? "", wave: w.name ?? "", effort: t.effort ?? "", score: String(t.score ?? ""), type: t.type ?? "" } })));
  if (tasks.length) add("waves", "waves", "pm/state/waves.json", ["title", "ref"], tasks, { ranked: true });
  for (const D of Object.values(out)) { // the first row wins when two share a key
    D.fields = Object.keys(D.rows[0].f);
    D.index = new Map(D.keys.map(k => { const m = new Map(); for (const r of D.rows) { const x = nkey(r.f[k]); if (x && !m.has(x)) m.set(x, r); } return [k, m]; }));
  }
  return out;
}

// Header words that, with the same values, make a column the better pick when two fit (a tie-breaker only: the values decide).
const ALIAS = { no: ["no", "step", "#", "number", "num"], feature: ["feature", "name", "capability", "step"], not: ["not", "note", "notes", "gap"], ref: ["ref", "id", "reference"], n: ["n", "pr", "#", "number"], topic: ["topic", "latest topic"], title: ["title", "work", "item", "name"], score: ["score", "points"], effort: ["effort", "size"], type: ["type", "kind"], evidence: ["evidence"], wave: ["wave"], last: ["last", "updated"], count: ["count", "commits"] };
const CODE_WORDS = { y: ["y", "yes", "exists", "done", "shipped", "✓", "✔", "✅", "☑"], p: ["p", "partial", "part", "~", "◐", "◑", "½", "△"], n: ["n", "no", "missing", "✗", "✕", "✘", "✖", "❌"], u: ["u", "?", "unknown", "notfound", "not found"], d: ["d", "announced", "soon", "beta"] };
const decoder = K => text => { const n = norm(text); for (const [code, words] of Object.entries(CODE_WORDS)) if (words.includes(n)) return code; const own = K?.matrixCodes && Object.prototype.hasOwnProperty.call(K.matrixCodes, n) ? K.matrixCodes[n] : null; return own && CODE_WORDS[own] ? own : null; };
const headerIs = (header, name) => { const h = norm(header), p = norm(name); return !!h && !!p && (h === p || (h.length >= 3 && (p.startsWith(h) || h.startsWith(p)))); };

// Which Nosy source feeds this table, with how much confidence. Returns { match } or { reason }.
function analyze(T, DS, K) {
  if (T.problem) return { reason: T.problem };
  if (T.rows.length < 3) return { reason: `only ${T.rows.length} data row${T.rows.length === 1 ? "" : "s"}: too few to match with confidence` };
  const decode = decoder(K), cands = [];
  for (const D of Object.values(DS)) for (const kf of D.keys) for (const kc of T.cols) {
    const cells = T.rows.map(r => ({ r, k: nkey(r.cell(kc.loc)?.text) })).filter(x => x.k);
    if (cells.length < 3 || new Set(cells.map(x => x.k)).size < cells.length * 0.8) continue;
    const hit = cells.filter(x => D.index.get(kf).has(x.k));
    if (hit.length < 3 || hit.length / cells.length < 0.6) continue;
    const bound = bind(T, D, kf, kc, hit, decode);
    if (hit.every(x => x.k.startsWith("n:")) && !bound.length) continue; // a column of small numbers matches any numbered list
    const want = D.ranked ? Math.max(T.rows.length, 1) : Infinity, pageKeys = new Set(cells.map(x => x.k));
    const rowsSame = hit.filter(x => bound.every(b => b.same(x.r, D.index.get(kf).get(x.k)))).length;
    const alias = (ALIAS[kf] || []).some(a => norm(kc.header) === a) ? 1 : 0;
    cands.push({ D, kf, kc, bound, hit: hit.length, cells: cells.length, same: rowsSame, differ: hit.length - rowsSame, onlyPage: cells.length - hit.length,
      onlyNosy: D.rows.slice(0, want).filter(r => nkey(r.f[kf]) && !pageKeys.has(nkey(r.f[kf]))).length, top: D.ranked ? T.rows.length : null, score: [hit.length, hit.length / cells.length, bound.length, rowsSame, alias] });
  }
  if (!cands.length) return { reason: "no column holds the step numbers, feature names, PR numbers or titles Nosy has (3 or more, 60% of the rows)" };
  const cmp = (a, b) => { for (let i = 0; i < 5; i++) if (a.score[i] !== b.score[i]) return b.score[i] - a.score[i]; return 0; };
  cands.sort(cmp);
  const rival = cands.find(c => c.D !== cands[0].D && !cmp(c, cands[0]));
  if (rival) return { reason: `equally close to ${cands[0].D.label} and ${rival.D.label}; say which by hand` };
  return { match: cands[0] };
}

// The columns of the table that Nosy data can feed once the identity column is known: product code columns by their header,
// the other fields by their values (half or more of the matched rows say the same thing).
function bind(T, D, kf, kc, hit, decode) {
  const out = [], used = new Set([kc.loc]), rowOf = x => D.index.get(kf).get(x.k);
  const code = D.fields.filter(f => f.startsWith("code:"));
  for (const f of code) {
    const prod = f.slice(5), cols = T.cols.filter(c => !used.has(c.loc) && headerIs(c.header, prod));
    if (cols.length !== 1 || code.filter(g => headerIs(cols[0].header, g.slice(5))).length !== 1) continue;
    const texts = hit.map(x => x.r.cell(cols[0].loc)?.text).filter(t => t);
    if (texts.length < 3 || texts.filter(t => decode(t)).length < texts.length * 0.8) continue;
    used.add(cols[0].loc);
    out.push({ loc: cols[0].loc, header: cols[0].header, field: f, code: true, same: (row, nrow) => decode(row.cell(cols[0].loc)?.text ?? "") === nrow.f[f] });
  }
  const pairs = [];
  for (const c of T.cols) if (!used.has(c.loc)) for (const f of D.fields) if (f !== kf && !f.startsWith("code:")) {
    let n = 0, ok = 0;
    for (const x of hit) { const a = x.r.cell(c.loc)?.text ?? "", b = rowOf(x).f[f]; if (a === "" && b === "") continue; n++; if (same(a, b)) ok++; }
    if (n >= 3 && ok / n >= 0.5) pairs.push({ c, f, a: ok / n, alias: (ALIAS[f] || []).includes(norm(c.header)) ? 1 : 0 });
  }
  const usedF = new Set();
  for (const p of pairs.sort((a, b) => b.a - a.a || b.alias - a.alias)) {
    if (used.has(p.c.loc) || usedF.has(p.f)) continue; used.add(p.c.loc); usedF.add(p.f);
    out.push({ loc: p.c.loc, header: p.c.header, field: p.f, same: (row, nrow) => same(row.cell(p.c.loc)?.text ?? "", nrow.f[p.f]) });
  }
  return out;
}

const markerOf = m => `${m.D.id} key=${enc(m.kf)}@${enc(m.kc.loc)} cols=${m.bound.map(b => `${enc(b.loc)}=${b.field.startsWith("code:") ? `code:${enc(b.field.slice(5))}` : enc(b.field)}`).join(",") || "-"}${m.top ? ` top=${m.top}` : ""}`;
function parseMarker(r, T) { // the binding written by adopt, back from the comment; locs are numbers in an HTML table
  const g = k => (r.attrs.match(new RegExp(`(?:^|\\s)${k}=(\\S+)`)) || [])[1], loc = s => T.kind === "html" ? +dec(s) : dec(s);
  const key = g("key"); if (!key || !key.includes("@")) return null;
  const at = key.lastIndexOf("@"), cols = (g("cols") || "-") === "-" ? [] : g("cols").split(",").map(x => { const e = x.indexOf("="); const f = x.slice(e + 1); return { loc: loc(x.slice(0, e)), field: f.startsWith("code:") ? `code:${dec(f.slice(5))}` : dec(f) }; });
  return { kf: dec(key.slice(0, at)), keyLoc: loc(key.slice(at + 1)), cols, top: +g("top") || null };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Page I/O: the backup, the undo.
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const sha = text => { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0; return `${text.length}-${h.toString(16)}`; };
function backup(pm, page, text) { // `text`: what the page will hold afterwards (undo refuses when the page no longer is that)
  const dir = path.join(pm, BACKUP); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".gitignore"), "*\n"); // the copies never show up in git status or a commit
  const id = `page-${stamp()}`;
  fs.writeFileSync(path.join(dir, `${id}.html`), fs.readFileSync(page));
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ page: path.resolve(page), after: sha(text), at: new Date().toISOString() }));
  return id;
}
const undoLine = pm => `To put the page back: \`${nosyCommand(`page-adopt undo${pm === "pm" ? "" : ` --pm ${pm}`}`)}\`.`;

// ---------------------------------------------------------------------------------------------------------------------------------
// Stale wording: a cell that calls PR #N open when git (or gh) says it merged or closed. The Open/Closed words are find-stale.mjs's own
// (English plus skill/data/lang/tr/find-stale.json); the nearest one to the number decides. Report only.
const LangStale = readJson(fileURLToPath(new URL("../data/lang/tr/find-stale.json", import.meta.url))) || { open: [], closed: [] };
const group = words => words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['’]")).join("|");
const OpenRe = new RegExp(`${group(LangStale.open)}|\\bPR\\b|CI (running|queued)|open PR|in review`, "gi"), ClosedRe = new RegExp(`${group(LangStale.closed)}|\\bmerged\\b|\\bshipped\\b|on main`, "gi");
function staleWording(cells, K) {
  const prs = new Map();
  for (const c of cells) for (const m of c.text.matchAll(/#(\d{2,5})('(?:de|da|te|ta|e|a)\b)?/g)) {
    let open = !!m[2];
    if (!open) { const near = re => Math.min(...[...c.text.matchAll(re)].map(x => Math.abs(x.index - m.index)), Infinity); const a = near(OpenRe), k = near(ClosedRe); open = a < 70 && a < k; }
    if (open) { if (!prs.has(m[1])) prs.set(m[1], []); prs.get(m[1]).push(c); }
  }
  const out = [], git = (...a) => { try { return execFileSync("git", ["-C", K.repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 }); } catch { return ""; } };
  for (const [n, where] of prs) {
    let state = null;
    // git first: a squash-merge subject ends "(#N)", a merge commit starts "Merge pull request #N"
    if (K?.repo) { const hit = git("log", "-F", "--grep", `#${n}`, "-n", "20", "--format=%aI%x1f%s", K.ref || "HEAD").split("\n").map(l => l.split("\x1f")).find(([, s]) => s && (new RegExp(`\\(#${n}\\)\\s*$`).test(s) || new RegExp(`^Merge pull request #${n}\\b`).test(s))); if (hit) state = { s: "merged", at: hit[0].slice(0, 10), title: hit[1] }; }
    if (!state && K?.issue?.repo) { try { const p = JSON.parse(execFileSync("gh", ["pr", "view", n, "-R", K.issue.repo, "--json", "state,mergedAt,closedAt,title"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); if (p.state === "MERGED") state = { s: "merged", at: String(p.mergedAt).slice(0, 10), title: p.title }; else if (p.state === "CLOSED") state = { s: "closed, not merged", at: String(p.closedAt).slice(0, 10), title: p.title }; } catch {} }
    if (state) for (const c of where) out.push({ pr: n, line: c.line, where: c.where, ...state });
  }
  return out;
}
// Every cell text on the page's tables, wherever it sits (marked or not), with its line.
function pageCells(html, tables, lines) {
  const out = [];
  for (const T of tables) { if (T.problem) continue; T.rows.forEach((r, i) => { for (const c of T.cols) { const x = r.cell(c.loc); if (x?.text) out.push({ text: x.text, line: lines(x.edit[0]), where: `${T.name}, row ${i + 1}${c.header ? `, "${c.header}"` : ""}` }); } }); }
  return out;
}
const staleReport = (list, K) => !list.length ? "" : `\nStale wording (the page says a PR is open; git says otherwise; the page was not touched):\n${list.map(s => `  line ${s.line} · #${s.pr} ${s.s} (${s.at}) · ${s.where}`).join("\n")}\n`;

// ---------------------------------------------------------------------------------------------------------------------------------
const row = (...c) => `| ${c.join(" | ")} |`;
const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const headers = T => !T.cols.length ? "…" : T.kind === "js" ? `{ ${T.cols.slice(0, 5).map(c => c.header).join(", ")}${T.cols.length > 5 ? ", …" : ""} }` : T.cols.slice(0, 5).map(c => clip(c.header || `col ${c.loc + 1}`, 18)).join(", ");
function adopt(pm, page, { apply, dryRun, yes }) {
  const html = fs.readFileSync(page, "utf8"), K = readSourcesSafe(pm), DS = datasets(pm, K), lines = lineIndex(html), tables = findTables(html), adopted = markedRegions(html);
  const results = tables.map(T => ({ T, ...analyze(T, DS, K) }));
  const matched = results.filter(r => r.match);
  let o = `# Adopting ${path.basename(page)}: ${tables.length + adopted.length} table${tables.length + adopted.length === 1 ? "" : "s"} found${adopted.length ? ` (${adopted.length} already adopted)` : ""}, ${matched.length} can be fed from Nosy data\n\n`;
  if (!Object.keys(DS).length) o += `Nosy has no data to feed a table yet (pm/matrix.json, pm/state/status.json, lowhanging.json, waves.json): run \`${nosyCommand("peek")}\` and \`${nosyCommand("psst")}\` first.\n\n`;
  if (tables.length) {
    o += `${row("your table", "-> Nosy source", "-> rows")}\n${row("---", "---", "---")}\n`;
    for (const r of results) {
      const T = r.T;
      if (r.match) { const m = r.match; o += `${row(`${T.name} (${headers(T)})`, `${m.D.label} (${m.D.file}), key ${m.kc.header ? `"${m.kc.header}"` : `col ${m.kc.loc}`} = ${m.kf}`, `${m.same} match, ${m.differ} differ${m.onlyPage || m.onlyNosy ? ` (${m.onlyPage} only on your page, ${m.onlyNosy} new in Nosy)` : ""}`)}\n`; }
      else o += `${row(`${T.name} (${headers(T)})`, "not matched", r.reason)}\n`;
    }
    for (const r of matched) { const m = r.match, left = r.T.cols.filter(c => c.loc !== m.kc.loc && !m.bound.some(b => b.loc === c.loc)); o += `\n${r.T.name}: fed columns ${m.bound.map(b => `${b.header || `col ${b.loc + 1}`} (${b.field.replace(/^code:/, "")})`).join(", ") || "none besides the key"}${left.length ? `; left alone: ${left.map(c => c.header || `col ${c.loc + 1}`).join(", ")}` : ""}`; }
    o += "\n";
  } else if (!adopted.length) o += "No tables on the page.\n";
  const cells = pageCells(html, [...tables, ...adopted.map(a => regionTable(html, a, lines).T).filter(T => T && !T.problem)], lines);
  const stale = K ? staleWording(cells, K) : [];
  o += staleReport(stale, K);
  if (!K) o += `\n(No readable ${path.join(pm, "sources.json")}: the stale-wording check was skipped.)\n`;
  if (!matched.length) { process.stdout.write(`${o}\nNothing to adopt.\n`); return 0; }
  if (!apply || dryRun) { process.stdout.write(`${o}\nNothing was changed. To mark the ${matched.length} matched table${matched.length === 1 ? "" : "s"} so \`refresh\` can keep them current: \`${nosyCommand(`page-adopt adopt --apply --yes`)}\` (the page is copied to ${path.join(pm, BACKUP)} first${dryRun && apply ? "; --dry-run writes nothing" : ""}).\n`); return 0; }
  if (!yes) { process.stderr.write(`${o}\n\`adopt --apply\` changes your page: it adds a comment before and after each of the ${matched.length} matched table${matched.length === 1 ? "" : "s"}, nothing else. Nothing was changed. Say yes with --yes to go ahead.\n`); return 1; }
  const edits = matched.flatMap(r => { const T = r.T, a = T.kind === "js" ? T.stmtStart : T.start, b = T.kind === "js" ? T.stmtEnd : T.end, tag = `<!-- pm:table ${markerOf(r.match)} -->`, close = "<!-- /pm:table -->"; return T.kind === "js" ? [{ start: a, end: a, text: `// ${tag}\n` }, { start: b, end: b, text: `\n// ${close}` }] : [{ start: a, end: a, text: tag }, { start: b, end: b, text: close }]; });
  const next = applyEdits(html, edits), id = backup(pm, page, next);
  fs.writeFileSync(page, next);
  process.stdout.write(`${o}\nMarked ${matched.length} table${matched.length === 1 ? "" : "s"} in ${page}. Backed up first: ${path.join(pm, BACKUP, `${id}.html`)}. ${undoLine(pm)}\nNext: \`${nosyCommand("page-adopt refresh")}\` keeps them current.\n`);
  return 0;
}

// Edits from the end of the text to the start, so every offset is still the original's. Overlap is a bug, not a case.
function applyEdits(text, edits) {
  const e = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  for (let i = 1; i < e.length; i++) if (e[i].end > e[i - 1].start) throw new Error("adopt-page: two edits overlap");
  let out = text; for (const x of e) out = out.slice(0, x.start) + x.text + out.slice(x.end);
  return out;
}

// The table a marker wraps: { T, binding } or { problem }. Whichever comes first between the comments, a <table> or a `const NAME = [`.
function regionTable(html, r, lines) {
  if (r.end < 0) return { problem: "the opening comment has no closing `<!-- /pm:table -->`" };
  const body = html.slice(r.from, r.to), tm = body.match(/<table\b[^>]*>/i), am = body.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?=\[)/);
  let T;
  if (tm && (!am || tm.index < am.index)) T = htmlTableAt(html, r.from + tm.index);
  else if (am) { T = jsArrayAt(html, r.from + am.index + am[0].length, 0); if (!T) return { problem: "the array isn't a list of objects" }; Object.assign(T, { array: am[1], stmtStart: r.from + am.index }); }
  else return { problem: "between the comments there is neither a table nor a `const NAME = [ … ]` array" };
  T.line = lines(r.start); T.name = T.kind === "js" ? `const ${T.array}` : `table at line ${T.line}`;
  if (T.problem) return { problem: T.problem, T };
  const binding = parseMarker(r, T); if (!binding) return { problem: "the comment doesn't say which column is the key (write it with `adopt --apply`)", T };
  return { T, binding };
}

const cell0 = (x, loc) => x.cell(loc)?.text ?? "";
const GONE = /\sdata-gone(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/;
function refresh(pm, page, { dryRun }) {
  const html = fs.readFileSync(page, "utf8"), K = readSourcesSafe(pm), DS = datasets(pm, K), lines = lineIndex(html), regions = markedRegions(html);
  if (!regions.length) { process.stderr.write(`No table in ${page} is adopted yet (no \`<!-- pm:table … -->\`). Run \`${nosyCommand("page-adopt adopt")}\` first.\n`); return 1; }
  const decode = decoder(K), edits = [], notes = [], seenTables = [];
  let o = `# Refreshing ${path.basename(page)}: ${regions.length} adopted table${regions.length === 1 ? "" : "s"}\n\n`;
  for (const r of regions) {
    const R = regionTable(html, r, lines), D = DS[r.source], at = R.T?.name || `marker at line ${lines(r.start)}`;
    if (R.T && !R.T.problem) seenTables.push(R.T);
    if (R.problem) { notes.push(`${at}: left alone, ${R.problem}`); continue; }
    if (!D) { notes.push(`${at}: left alone, Nosy has no data for "${r.source}" right now`); continue; }
    const { T, binding: B } = R, kf = B.kf, idx = D.index.get(kf);
    if (!idx) { notes.push(`${at}: left alone, "${kf}" isn't a field of ${D.label}`); continue; }
    const rows = T.rows.map(x => ({ x, k: nkey(x.cell(B.keyLoc)?.text) })), keyed = rows.filter(y => y.k);
    if (keyed.length && keyed.filter(y => idx.has(y.k)).length < keyed.length * 0.4) { notes.push(`${at}: left alone, its key column no longer holds ${D.label}'s keys (was a column added or moved? run \`adopt\` again)`); continue; }
    const want = B.top ? D.rows.slice(0, B.top) : D.rows, wantMap = new Map();
    for (const w of want) { const k = nkey(w.f[kf]); if (k && !wantMap.has(k)) wantMap.set(k, w); }
    const isJs = T.kind === "js", codeCol = b => b.field.startsWith("code:");
    // How the owner draws each code: a cell that already holds it (their ✓, their badge and its class, their letter), taken from the
    // same column, else from any other code column, so a changed or new cell looks like theirs.
    const sample = new Map(), see = (key, v) => { const m = sample.get(key) || new Map(); m.set(v, (m.get(v) || 0) + 1); sample.set(key, m); };
    for (const b of B.cols.filter(codeCol)) for (const y of rows) { const c = y.x.cell(b.loc), code = c && decode(c.text); if (!code) continue; const v = isJs ? c.text : JSON.stringify([c.attrs, c.html]); see(`${b.loc}:${code}`, v); see(`*:${code}`, v); }
    // A column the owner writes "#7" in gets "#8" for a new row.
    const hashed = loc => { const t = rows.map(y => y.x.cell(loc)?.text).filter(Boolean); return t.length > 0 && t.filter(x => /^#\d/.test(x)).length >= t.length * 0.6; };
    const draw = (b, w) => {
      const v = w.f[b.field] ?? "";
      if (!codeCol(b)) return /^\d+$/.test(v) && hashed(b.loc) ? `#${v}` : v;
      const m = sample.get(`${b.loc}:${v}`) || sample.get(`*:${v}`), best = m && [...m].sort((p, q) => q[1] - p[1])[0][0];
      if (best !== undefined && best !== null) return isJs ? best : JSON.parse(best);
      return isJs ? (rows.some(y => y.x.cell(b.loc) && /^[ypnud]$/.test(y.x.cell(b.loc).text)) ? v : null) : null; // an array of plain letters
    };
    const keyText = w => /^\d+$/.test(w.f[kf]) && hashed(B.keyLoc) ? `#${w.f[kf]}` : w.f[kf];
    let changed = 0, added = 0, gone = 0, back = 0, undrawn = 0; const seen = new Set(), shown = [];
    for (const { x, k } of rows) {
      if (!k) continue; seen.add(k);
      const w = wantMap.get(k);
      if (!isJs) {
        const g = x.open.match(GONE);
        if (!w) { if (!g) { edits.push({ start: x.openEnd - 1, end: x.openEnd - 1, text: " data-gone" }); gone++; } continue; }
        if (g) { edits.push({ start: x.start + g.index, end: x.start + g.index + g[0].length, text: "" }); back++; }
      } else {
        const g = x.obj.props.find(q => q.key === "gone"), last = x.obj.props.at(-1);
        if (!w) { if (!g) { edits.push({ start: x.abs + last.node.end, end: x.abs + last.node.end, text: ", gone: true" }); gone++; } else if (g.node.v !== true) { edits.push({ start: x.abs + g.node.start, end: x.abs + g.node.end, text: "true" }); gone++; } continue; }
        if (g && g.node.v === true) { edits.push({ start: x.abs + g.node.start, end: x.abs + g.node.end, text: "false" }); back++; }
      }
      for (const b of B.cols) {
        const cell = x.cell(b.loc), nv = draw(b, w);
        if (!cell) continue;
        if (nv === null) { undrawn++; continue; }
        if (codeCol(b) ? decode(cell.text) === w.f[b.field] : same(cell.text, nv)) continue;
        if (!isJs) edits.push(codeCol(b) ? { start: cell.start, end: cell.edit[1], text: `<${cell.tag}${nv[0]}>${nv[1]}` } : { start: cell.edit[0], end: cell.edit[1], text: esc(nv) });
        else { const q = cell.prop.node, markup = /<[a-z!/]|&[#\w]+;/i.test(cell.text); edits.push({ start: cell.edit[0], end: cell.edit[1], text: q.t === "str" ? jsQuote(markup ? esc(nv) : nv, q.q) : q.t === "num" && isNum(String(nv)) ? String(nv) : jsQuote(nv, '"') }); }
        changed++; shown.push(`  ${clip(cell0(x, B.keyLoc), 28)} · ${T.cols.find(c => c.loc === b.loc)?.header || b.loc}: "${clip(cell.text, 30)}" -> "${clip(codeCol(b) ? w.f[b.field] : nv, 30)}"`);
      }
    }
    // New rows go after the last one, built like it: its markup, its quotes, its indentation.
    const fresh = [...wantMap].filter(([k]) => !seen.has(k)).map(([, w]) => w), last = rows.at(-1)?.x;
    if (fresh.length && last) {
      const lineStart = html.lastIndexOf("\n", last.start - 1) + 1, lead = /^\s*$/.test(html.slice(lineStart, last.start)) ? html.slice(lineStart, last.start) : "";
      if (!isJs) {
        edits.push({ start: last.end, end: last.end, text: fresh.map(w => {
          let src = html.slice(last.start, last.end);
          for (const [i, c] of [...last.cells.entries()].reverse()) {
            const b = B.cols.find(q => q.loc === i), d = b ? draw(b, w) : "";
            if (b && codeCol(b)) src = src.slice(0, c.start - last.start) + (d === null ? `<${c.tag}>${esc(w.f[b.field])}` : `<${c.tag}${d[0]}>${d[1]}`) + src.slice(c.to - last.start); // an undrawable code: the plain letter, without the template's look
            else src = src.slice(0, c.from - last.start) + (i === B.keyLoc ? esc(keyText(w)) : b ? esc(d) : "") + src.slice(c.to - last.start);
          }
          return `\n${lead}${src.replace(/^(<tr\b[^>]*?)\sdata-gone(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/i, "$1")}`;
        }).join("") });
      } else {
        const props = last.obj.props, q = props.find(x => x.node.t === "str")?.node.q || '"', kq = props[0].kq, text0 = html.slice(last.start, last.end);
        const multi = /^\s*$/.test(html.slice(lineStart, last.start)) && lineStart > 0, bare = text0.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, ""), pad = /^\{\s/.test(text0) ? " " : "", sep = /,\S/.test(bare) ? "," : ", ";
        const lit = (loc, v) => { const ex = props.find(x => x.key === loc), val = ex?.node.t === "num" && isNum(String(v)) ? String(v) : jsQuote(v, q), key = kq || !/^[A-Za-z_$][\w$]*$/.test(loc) ? jsQuote(loc, kq || '"') : loc; return `${key}: ${val}`; };
        // Written like the last row: its keys in its order, its brace spacing and quotes.
        const obj = w => { const vals = new Map([[B.keyLoc, keyText(w)], ...B.cols.map(b => [b.loc, draw(b, w)])]); return `{${pad}${[...props.map(x => x.key), ...vals.keys()].filter((k, n, all) => all.indexOf(k) === n && vals.has(k) && vals.get(k) !== null).map(k => lit(k, vals.get(k))).join(sep)}${pad}}`; };
        // Multi-line array: the rows go on their own lines after the last row's line, so its trailing comma and the comment after it stay with it.
        const lineEnd = html.indexOf("\n", last.end), rest = lineEnd < 0 ? "" : html.slice(last.end, lineEnd), tail = rest.match(/^[ \t]*(,)?[ \t]*(\/\/.*)?$/);
        if (multi && tail && lineEnd >= 0) {
          const rows = fresh.map((w, n) => `\n${lead}${obj(w)}${tail[1] || n < fresh.length - 1 ? "," : ""}`).join(""), comma = tail[1] ? "" : ",";
          if (lineEnd === last.end) edits.push({ start: lineEnd, end: lineEnd, text: comma + rows }); // one insert: two at the same spot would land in the wrong order
          else edits.push(...(comma ? [{ start: last.end, end: last.end, text: comma }] : []), { start: lineEnd, end: lineEnd, text: rows });
        } else edits.push({ start: last.end, end: last.end, text: fresh.map(w => `,${multi ? `\n${lead}` : " "}${obj(w)}`).join("") });
      }
      added = fresh.length;
    }
    o += `${at} (${r.source}${B.top ? `, top ${B.top}` : ""}): ${changed} cell${changed === 1 ? "" : "s"} updated, ${added} row${added === 1 ? "" : "s"} added, ${gone} marked gone${back ? `, ${back} back` : ""}${undrawn ? `; ${undrawn} cell${undrawn === 1 ? "" : "s"} left as they are (no example of how you draw that code)` : ""}\n${shown.slice(0, 8).join("\n")}${shown.length ? `${shown.length > 8 ? `\n  … and ${shown.length - 8} more` : ""}\n` : ""}`;
  }
  if (notes.length) o += `\n${notes.map(n => `- ${n}`).join("\n")}\n`;
  const stale = K ? staleWording(pageCells(html, [...findTables(html), ...seenTables], lines), K) : [];
  o += staleReport(stale, K);
  if (!edits.length) { process.stdout.write(`${o}\nAlready up to date: nothing in the marked tables changed.\n`); return 0; }
  const next = applyEdits(html, edits);
  if (dryRun) { process.stdout.write(`${o}\n--dry-run: the page was not changed.\n`); return 0; }
  const id = backup(pm, page, next); fs.writeFileSync(page, next);
  process.stdout.write(`${o}\nWritten: ${page}. Text outside the marked tables is exactly as it was. Backed up first: ${path.join(pm, BACKUP, `${id}.html`)}. ${undoLine(pm)}\n`);
  return 0;
}

function undo(pm, page, { force }) {
  const dir = path.join(pm, BACKUP), list = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^page-[\dTZ-]+\.html$/.test(f)).sort() : [];
  if (!list.length) { process.stderr.write(`No page backup in ${dir}: nothing to put back.\n`); return 1; }
  const file = list.at(-1), id = file.replace(/\.html$/, ""), meta = readJson(path.join(dir, `${id}.json`)) || {}, target = page || meta.page;
  if (!target) { process.stderr.write(`The backup ${file} doesn't say which page it was; pass --page <file>.\n`); return 1; }
  const now = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (now !== null && meta.after && sha(now) !== meta.after && !force) { process.stderr.write(`${target} changed after that backup (${file}); putting it back would drop those edits. Nothing was changed. Add --force to restore anyway (the page as it is now is kept first).\n`); return 1; }
  const kept = path.join(dir, `undone-${stamp()}.html`);
  if (now !== null) fs.writeFileSync(kept, now);
  fs.copyFileSync(path.join(dir, file), target);
  // A backup is used once: the next undo goes one step further back.
  fs.renameSync(path.join(dir, file), path.join(dir, `used-${file}`)); if (fs.existsSync(path.join(dir, `${id}.json`))) fs.renameSync(path.join(dir, `${id}.json`), path.join(dir, `used-${id}.json`));
  process.stdout.write(`Put back ${target} from ${path.join(dir, file)}.${now !== null ? ` The page as it was a moment ago is kept as ${kept}.` : ""}${list.length > 1 ? ` Run undo again to go one step further back (${list.length - 1} more).` : ""}\n`);
  return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), flag = n => { const i = argv.indexOf(n); if (i < 0) return false; argv.splice(i, 1); return true; }, opt = n => { const i = argv.indexOf(n); return i < 0 ? null : argv.splice(i, 2)[1] ?? ""; };
  const dryRun = flag("--dry-run"), apply = flag("--apply"), yes = flag("--yes"), force = flag("--force"), pageArg = opt("--page"), [sub, pm = "pm"] = argv;
  const usage = () => { console.error("Usage: node adopt-page.mjs adopt|refresh|undo <pm folder> [--page <file>] [--dry-run] [--apply --yes] [--force]"); process.exit(1); };
  if (!["adopt", "refresh", "undo"].includes(sub) || pageArg === "") usage();
  const page = pageArg || path.join(pm, "page.html");
  if (sub !== "undo" && !fs.existsSync(page)) { console.error(`No page at ${page}; pass --page <file>.`); process.exit(1); }
  if (!fs.existsSync(pm)) { console.error(`No pm folder at ${pm}.`); process.exit(1); }
  process.exitCode = sub === "adopt" ? adopt(pm, page, { apply, dryRun, yes }) : sub === "refresh" ? refresh(pm, page, { dryRun }) : undo(pm, pageArg, { force });
}
