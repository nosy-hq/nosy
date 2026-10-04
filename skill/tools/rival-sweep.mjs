// rival-sweep: "what did the rivals put out in the last N days?", started from the same list every time.
// The owner's 20-question test (29 Sep): three runs answered it from whatever each agent happened to find, one
// couldn't find a rival's address at all (tried .com, the product is .ai), and all three missed news that isn't
// in release notes (a launch on the newsroom, a funding round in the press). Here each rival's pages come from
// one registry, `sources.json` `rivals`, typed by what they say:
//   releases  release notes / changelog: what shipped           news   newsroom / press page: announcements
//   blog      blog / product posts: announcements or content    site   the landing page (claims, no dates)
// Every page is fetched (plain public GET, no login, no paid scraper), its text cut into dated entries, and the
// entries inside the window listed with their date, the page and the words around the date. That list is a
// lead, not a verdict: the agent opens each entry, decides shipped / announced / movement (funding, hires),
// and runs one web search per rival for press the rival's own pages don't carry. Pages that fail (login wall,
// 404, JavaScript-only, no dates) are listed too, so "nothing new" is never confused with "couldn't read".
// Registry shape: "rivals": { "<slug>": { "name": "RivalOne", "site": "https://…", "releases": ["https://…"],
//   "news": ["…"], "blog": ["…"], "login": ["a page that needs a login, not fetched"],
//   "browser": ["a page that opens in a browser but blocks scripts (403, an error page), not fetched"] } }
// A registry entry may also carry `stores: { "appStore": "<numeric id or an apps.apple.com url>", "country": "tr" }`: the
// sweep then asks https://itunes.apple.com/lookup?id=<id>&country=<cc> (Apple's public JSON API, no key) and lists the app's CURRENT version,
// its release date and its release notes as one entry, grade primary, labelled with the version they belong to. The lookup answers only for the
// current version, so those notes are never attached to any other version (release notes of 1.3.3 had been matched to 1.3.4 once): a version a
// registry page mentions is kept as that page's own entry. A failed or empty lookup is a quiet "store lookup failed" in the unreadable list: it
// never stops the sweep and doesn't change the exit code. The Chrome Web Store has no stable public API and is not scraped.
// A site that answers 429 is not asked again for the rest of the run: its other pages are listed as "rate limited, not read".
// Dates without a year ("Sep 23") take the window's year (the year before when that falls after the window).
// Usage: node rival-sweep.mjs <pm> [--days 30] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--only slug,…] [--json <file>]
// Exit: 0 swept · 2 a page in the registry couldn't be read (the list still prints; a failed store lookup doesn't count) · 1 no registry / no sources.json.
import { localDay } from "./today.mjs";
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { sourcesProblem } from "./hints.mjs";
import { readSources } from "./sources-file.mjs";

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6, temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12 };
const fold = s => String(s).replace(/[İI]/g, "i").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
const pad = n => String(n).padStart(2, "0");
const iso = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31) ? `${y}-${pad(m)}-${pad(d)}` : null;

// Page HTML → readable text (scripts, styles and markup dropped, block ends kept as line breaks).
export function textOf(html) {
  // Closing tags may carry whitespace ("</style\n>"): matching "</style>" only swallowed a whole changelog.
  // A <time datetime="2026-09-23…">Sep 23</time> keeps its full date.
  return String(html).replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<time\b[^>]*datetime="(\d{4}-\d{2}-\d{2})[^"]*"[^>]*>[\s\S]*?<\/time\s*>/gi, " $1 ")
    .replace(/<\/(p|div|li|h[1-6]|article|section|tr|br)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&hellip;/g, "…").replace(/&rsquo;|&lsquo;/g, "'").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

// Every date written in the text: "Sep 16, 2026", "16 September 2026", "16 Eylül 2026", "2026-09-16", "16.09.2026".
export function datesIn(text, { to = null } = {}) {
  const t = fold(text), out = [], taken = [];
  const add = (m, date) => { if (!date) return; out.push({ at: m.index, end: m.index + m[0].length, date }); taken.push([m.index, m.index + m[0].length]); };
  const mon = w => MONTHS[w] || MONTHS[w.slice(0, 3)];
  for (const m of t.matchAll(/\b([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (20\d\d)\b/g)) add(m, mon(m[1]) ? iso(+m[3], mon(m[1]), +m[2]) : null);
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\.? ([a-z]{3,9})\.?,? (20\d\d)\b/g)) add(m, mon(m[2]) ? iso(+m[3], mon(m[2]), +m[1]) : null);
  for (const m of t.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)) add(m, iso(+m[1], +m[2], +m[3]));
  for (const m of t.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](20\d\d)\b/g)) add(m, iso(+m[3], +m[2], +m[1]));
  // "Sep 23" / "23 Sep" with no year (Attio's changelog): the year is the window's, or the one before when that
  // would put the date after the window's end. Only when a window is given, and never inside a dated match.
  if (to) {
    const Y = +to.slice(0, 4), free = (a, b) => !taken.some(([x, y]) => a < y && b > x);
    const yearless = (m, mo, d) => { if (!mon(mo) || !free(m.index, m.index + m[0].length)) return; let dt = iso(Y, mon(mo), +d); if (dt && dt > to) dt = iso(Y - 1, mon(mo), +d); add(m, dt); };
    for (const m of t.matchAll(/\b([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?\b(?!,? ?20\d\d|[.:/]\d)/g)) yearless(m, m[1], m[2]);
    for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\.? ([a-z]{3,9})\b(?!\.?,? ?20\d\d)/g)) yearless(m, m[2], m[1]);
  }
  return out.sort((a, b) => a.at - b.at);
}

// Dated entries inside [from, to]: the words from each date up to the next date (an entry's own text), trimmed.
// `fold` keeps offsets for these alphabets (one char in, one out), so positions map back onto the original text.
export function entriesIn(text, from, to) {
  const ds = datesIn(text, { to }), out = [], seen = new Set();
  ds.forEach((d, i) => {
    if (d.date < from || d.date > to) return;
    const next = ds.slice(i + 1).find(x => x.at > d.end + 20);
    // "Title\nSep 16, 2026\nWhat it does\nNext title\nSep 9, 2026": the entry is the title line before its
    // date plus the lines after it, minus the last line when that is the next entry's title.
    const lines = text.slice(d.end, next ? next.at : d.end + 400).split("\n").map(x => x.trim()).filter(Boolean);
    if (next && lines.length > 1 && lines[lines.length - 1].length <= 120) lines.pop();
    const title = text.slice(Math.max(0, d.at - 240), d.at).split("\n").map(x => x.trim()).filter(Boolean).pop() || "";
    const lead = title && title.length <= 140 && !datesIn(title, { to }).length ? `${title.replace(/[\s·|,:–-]+$/, "")} · ` : "";
    const words = (lead + lines.join(" ")).replace(/^[\s·|,:–-]+/, "").replace(/\s+/g, " ").slice(0, 300);
    const key = d.date + fold(words).slice(0, 60);
    if (!words || seen.has(key)) return; seen.add(key);
    out.push({ date: d.date, text: words });
  });
  return out;
}

async function fetchText(url, timeout = 20000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (Nosy rival-sweep; public pages only)", accept: "text/html,*/*" } });
    const body = await r.text();
    return { status: r.status, url: r.url, text: textOf(body), raw: body }; // raw: the store lookup is JSON, which textOf would mangle
  } catch (e) { return { status: 0, error: e.name === "AbortError" ? "timeout" : String(e.message || e) }; }
  finally { clearTimeout(t); }
}

// The numeric App Store id and country from `stores`: "6446", "id6446", or an apps.apple.com / itunes.apple.com url (its /tr/ path is the country).
export function appStoreOf(stores) {
  const raw = stores && stores.appStore != null ? String(stores.appStore).trim() : ""; if (!raw) return null;
  const id = (raw.match(/(?:\/id|[?&]id=|^id)(\d{3,})/) || raw.match(/^(\d{3,})$/) || [])[1]; if (!id) return null;
  const want = String(stores.country || (raw.match(/[?&]country=([a-z]{2})\b/i) || raw.match(/apple\.com\/([a-z]{2})\//i) || [])[1] || "us").trim().toLowerCase();
  const cc = /^[a-z]{2}$/.test(want) ? want : "us"; // two letters or "us": whatever else the registry says never reaches the query string
  return { id, country: cc, url: `https://itunes.apple.com/lookup?id=${id}&country=${cc}` };
}
// One lookup answer → the current version's entry, or the reason there isn't one. Never throws.
export function storeEntryOf(raw, { from, to }) {
  let J; try { J = JSON.parse(raw); } catch { return { problem: "store lookup failed (the answer isn't JSON)" }; }
  const a = J && Array.isArray(J.results) ? J.results[0] : null;
  if (!a) return { problem: "store lookup failed (no app under that id and country)" };
  const version = String(a.version ?? "").trim();
  // Notes without the version they belong to would be matched to whichever version the reader has in mind: not offered at all.
  if (!version) return { problem: "store lookup failed (the answer names no version)" };
  const date = /^\d{4}-\d{2}-\d{2}/.test(String(a.currentVersionReleaseDate || "")) ? String(a.currentVersionReleaseDate).slice(0, 10) : null;
  const notes = String(a.releaseNotes || "").replace(/\s+/g, " ").trim();
  const store = { name: a.trackName || null, version, date, notes: notes.slice(0, 600), grade: "primary", url: a.trackViewUrl || null };
  const inWindow = !!date && date >= from && date <= to;
  return { store, entries: inWindow ? [{ date, version, grade: "primary", source: "appStore", text: `v${version} (App Store, current version)${notes ? `: ${notes.slice(0, 280)}` : ": no release notes given"}` }] : [] };
}

const hostKey = u => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return String(u); } };
export async function sweep(rivals, { from, to, fetcher = fetchText, only = [] } = {}) {
  const out = [], limited = new Set(); // hosts that said 429: not asked again in this run
  const get = async url => {
    const host = hostKey(url);
    if (limited.has(host)) return { status: 429, skipped: true };
    const r = await fetcher(url);
    if (r && r.status === 429) limited.add(host);
    return r || { status: 0, error: "no answer" };
  };
  for (const [slug, R] of Object.entries(rivals)) {
    if (only.length && !only.includes(slug)) continue;
    const pages = [];
    for (const kind of ["releases", "news", "blog"]) for (const url of [].concat(R[kind] || [])) {
      const r = await get(url);
      const ok = r.status >= 200 && r.status < 300 && r.text && r.text.split(/\s+/).length > 60;
      const all = ok ? datesIn(r.text, { to }).length : 0, entries = ok ? entriesIn(r.text, from, to) : [];
      pages.push({ kind, url, status: r.status, ok, datesOnPage: all, entries,
        problem: r.status === 429 ? "rate limited, not read" : !ok ? (r.error || (r.status >= 400 ? `HTTP ${r.status}` : "almost no text (JavaScript-only page?)")) : !all ? "no dates on the page: read it by hand" : null });
    }
    const app = appStoreOf(R.stores);
    if (app) {
      let r; try { r = await get(app.url); } catch (e) { r = { status: 0, error: String(e.message || e) }; }
      const page = { kind: "appStore", url: app.url, status: r.status, ok: false, quiet: true, datesOnPage: 0, entries: [], country: app.country, problem: null };
      if (r.status === 429) page.problem = "rate limited, not read";
      else if (!(r.status >= 200 && r.status < 300)) page.problem = `store lookup failed (${r.error || `HTTP ${r.status}`})`;
      else { const E = storeEntryOf(r.raw ?? r.text ?? "", { from, to }); if (E.problem) page.problem = E.problem; else { page.ok = true; page.store = E.store; page.entries = E.entries; page.datesOnPage = E.store.date ? 1 : 0; } }
      pages.push(page);
    } else if (R.stores && R.stores.appStore != null && String(R.stores.appStore).trim()) pages.push({ kind: "appStore", url: String(R.stores.appStore), status: 0, ok: false, quiet: true, datesOnPage: 0, entries: [], country: null, problem: "store lookup failed (no App Store id in that value: use the number from the app's address, id123456789)" });
    out.push({ slug, name: R.name || slug, site: R.site || null, login: [].concat(R.login || []), browser: [].concat(R.browser || []), pages });
  }
  return out;
}

const KIND = { releases: "release notes → shipped if listed there", news: "newsroom → announced unless it says available", blog: "blog → announced, or content", appStore: "App Store lookup, primary → shipped: the current version only" };
export function render(S, { from, to }) {
  const L = [`# Rival sweep · ${from} – ${to}`, "",
    "Leads, not verdicts: open each entry, then decide shipped / announced / movement (funding, hires, partnerships). Then one web search per rival for press its own pages don't carry (\"<name> <month> <year>\"), and say which pages couldn't be read.", ""];
  for (const R of S) {
    const n = R.pages.reduce((s, p) => s + p.entries.length, 0);
    L.push(`## ${R.name}: ${n} dated entr${n === 1 ? "y" : "ies"} in the window${R.site ? ` · ${R.site}` : ""}`);
    for (const p of R.pages) {
      if (p.kind === "appStore") {
        // The version, its date and its notes travel together: notes of the current version are never read as another version's.
        L.push(`- appStore (${p.country}): ${p.url}${p.problem ? ` — ${p.quiet ? "not read" : "**not read**"}: ${p.problem}` : ` (${KIND.appStore}) · ${p.store.name || "app"} v${p.store.version}, released ${p.store.date || "(date not given)"}${p.entries.length ? "" : " (outside the window)"}`}`);
        if (p.store && !p.entries.length && p.store.notes) L.push(`  - v${p.store.version} · ${p.store.notes.slice(0, 200)}`);
      } else L.push(`- ${p.kind}: ${p.url}${p.problem ? ` — **not read: ${p.problem}**` : ` (${KIND[p.kind]}; ${p.datesOnPage} dates on the page)`}`);
      for (const e of p.entries.slice(0, 25)) L.push(`  - ${e.date} · ${e.text}`);
      if (p.entries.length > 25) L.push(`  - … ${p.entries.length - 25} more in the JSON`);
    }
    for (const u of R.login) L.push(`- needs a login, not fetched: ${u}`);
    for (const u of R.browser || []) L.push(`- opens in a browser but blocks scripts, not fetched: ${u} (read it by hand if it matters)`);
    if (!R.pages.length) L.push("- no pages in the registry: add releases/news/blog URLs to sources.json `rivals`");
    L.push("");
  }
  return L.join("\n").trim();
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const days = +(take("--days") || 30), sinceArg = take("--since"), untilArg = take("--until"), jsonOut = take("--json");
  const only = (take("--only") || "").split(",").filter(Boolean), [pm = "pm"] = argv;
  let K; try { K = readSources(pm); } catch { console.error(`Psst… ${sourcesProblem(pm) || `Couldn't read ${path.join(pm, "sources.json")}.`}`); process.exit(1); }
  if (!K.rivals || !Object.keys(K.rivals).length) { console.error("No rival registry yet: run /nosy:neighbors (it proposes one), or add `rivals` to pm/sources.json (neighbors step 0)."); process.exit(1); }
  const to = untilArg || localDay();
  const from = sinceArg || new Date(new Date(to + "T00:00:00Z").getTime() - days * 864e5).toISOString().slice(0, 10);
  const S = await sweep(K.rivals, { from, to, only });
  const out = jsonOut || path.join(pm, "state", "rival-sweep.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), from, to, rivals: S }, null, 1));
  console.log(render(S, { from, to }));
  process.exitCode = S.some(R => R.pages.some(p => !p.ok && !p.quiet)) ? 2 : 0; // a store lookup that failed is a note, not a page the registry couldn't read
}
