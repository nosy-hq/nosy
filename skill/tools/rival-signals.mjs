#!/usr/bin/env node
// rival-signals: "did this rival grow?", answered from PUBLIC, LEGAL numbers with a history, never from a guess.
// A rival's pages say what it shipped (watch, sweep); they don't say whether anyone cares. A few public counters do, as proxies:
// stars and release pace on GitHub, weekly npm downloads, an app's rating count in the App Store, how many roles a company has open.
// They are not revenue and not users; the report says "proxy", gives each number with the date it is compared with, and never
// turns a number into a verdict. Each is read once per run, from the source's own public API, and kept in a log so next month's
// run can say "+134 since 2026-09-05" instead of "1,234".
// Per rival, sources.json `rivals.<slug>.signals` (all parts optional):
//   { "github": "owner/repo", "npm": "pkg" or "@scope/pkg", "appStore": "<numeric id or an apps.apple.com url>", "country": "tr",
//     "careers": { "greenhouse": "token" } | { "lever": "company" } | { "ashby": "company" } | { "page": "https://…/careers" } }
// How each is read (a plain GET, User-Agent `nosy-rival-signals (+https://github.com/nosy-hq/nosy)`, 10 s timeout, one request per
// address per run, no cookies, no key):
//   github     the owner's own `gh api` (their sign-in, 5,000 calls an hour), else the unauthenticated api.github.com (60 an hour):
//              repos/<r> (stars, forks) · repos/<r>/releases (published in the last 30 days, drafts left out) · repos/<r>/commits?since=…&per_page=1
//              (the default branch; the count is the last page number of the Link header, so one commit is fetched, not a month of them).
//              A repo's open-issue count includes pull requests, so it is not offered.
//   npm        api.npmjs.org/downloads/point/last-week/<pkg>
//   appStore   itunes.apple.com/lookup (the same helper rival-sweep uses): rating and rating count of the CURRENT version
//   careers    the public job-board APIs: boards-api.greenhouse.io/v1/boards/<t>/jobs · api.lever.co/v0/postings/<c>?mode=json ·
//              api.ashbyhq.com/posting-api/job-board/<c>; or, for a page, the JSON-LD `JobPosting` objects in it (structure only;
//              a page with none says "can't count from this page", it is never guessed from words).
// A 403 or 429 stops that host for the rest of the run ("rate limited, not read"); nothing is retried. A source that can't be read is
// named under `unread`, never left out silently and never filled with a zero.
// NO scraping of LinkedIn, or of any page behind a login, ever. Careers pages are read only when the company itself published them.
// History: pm/history/rival-signals.jsonl, one line a run { at, rivals: { slug: { key: value } } }; a second run on the same (UTC) day
// replaces that day's line. A signal's `previous` is its value on the oldest line from the last 28 days (that line's date is `since`);
// without one there is no change to show and the output says "first reading".
// Output: pm/state/rival-signals.json { type: "rivalSignals", generated, rivals: [ { slug, name, signals: [ { key, label, value, previous,
// since, source } ], unread: [ { key, why } ] } ] } and a readable table.
// Notes (`note`, `notes`): what the owner read in public and wants kept next to the numbers (a founder's post, a funding round, a hire),
// in pm/signal/rival-notes.jsonl, one line each, only with an http(s) source (a signal without a source is a rumour). Notes are never
// fetched and never published: `publish` sends a fixed list of files and this one is not on it. A linkedin.com address is accepted as a
// link the owner pasted; Nosy never opens it.
// Usage: node rival-signals.mjs run <pm> [--json <file>]
//        node rival-signals.mjs init <pm>                       proposes the `signals` blocks from the rival files; writes nothing
//        node rival-signals.mjs note <pm> <slug> "<text>" --source <url> [--date YYYY-MM-DD]
//        node rival-signals.mjs notes <pm> [<slug>] [--json]
// Exit: 0 read · 2 something couldn't be read (the table still prints) · 1 nothing configured / no sources.json / refused note.
import fs from "node:fs"; import path from "node:path"; import { execFile } from "node:child_process"; import { fileURLToPath } from "node:url";
import { sourcesProblem } from "./hints.mjs";
import { readSources, rivalsDir, rivalFiles } from "./sources-file.mjs";
import { appStoreOf } from "./rival-sweep.mjs";
import { reposIn } from "./rival-demand.mjs";

export const USER_AGENT = "nosy-rival-signals (+https://github.com/nosy-hq/nosy)";
export const TIMEOUT = 10000, HISTORY_DAYS = 28, RECENT_DAYS = 30;
export const LABEL = { githubStars: "GitHub stars", githubForks: "GitHub forks", githubReleases30d: "GitHub releases (30 days)", githubCommits30d: "GitHub commits (30 days)",
  npmWeeklyDownloads: "npm downloads (last week)", appStoreRating: "App Store rating", appStoreRatings: "App Store ratings", openRoles: "Open roles" };
const KEYS = Object.keys(LABEL), DAY = 864e5, RATE = "rate limited, not read";
const GITHUB_KEYS = ["githubStars", "githubForks", "githubReleases30d", "githubCommits30d"], APP_KEYS = ["appStoreRating", "appStoreRatings"];
const fmt = n => Number.isInteger(n) ? n.toLocaleString("en-US") : String(n);
const isoDay = d => d.toISOString().slice(0, 10);
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return String(u); } };
const httpUrl = u => { try { const x = new URL(String(u).trim()); return /^https?:$/.test(x.protocol) ? x : null; } catch { return null; } };
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const NPM = /^(?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/i;

// ---- transport (injectable: the suite never touches the network) ----
// A plain GET. Never throws: a failure is { status: 0, error }.
async function httpGet(url, { fetchImpl, timeout, accept }) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetchImpl(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": USER_AGENT, accept } });
    const text = await r.text();
    return { status: r.status, headers: { link: (r.headers && r.headers.get && r.headers.get("link")) || "" }, text };
  } catch (e) { return { status: 0, error: e && e.name === "AbortError" ? `timed out after ${timeout / 1000} s` : `couldn't connect (${String((e && e.message) || e).slice(0, 80)})` }; }
  finally { clearTimeout(t); }
}
// `gh api -i` prints the status line, the headers, a blank line, then the body.
export function parseInclude(out) {
  const t = String(out || "").replace(/^\s+/, ""), status = /^HTTP\/[\d.]+ (\d{3})/.exec(t); if (!status) return null;
  const cut = /\r?\n\r?\n/.exec(t), head = cut ? t.slice(0, cut.index) : t;
  return { status: +status[1], headers: { link: ((/^link:\s*(.+)$/im.exec(head) || [])[1] || "").trim() }, text: cut ? t.slice(cut.index + cut[0].length) : "" };
}
// The owner's own gh. { unavailable } when gh isn't installed or signed in (the caller falls back to the plain API for the rest of the run).
export function ghApi(p, { timeout = TIMEOUT } = {}) {
  return new Promise(resolve => execFile("gh", ["api", "-i", p], { encoding: "utf8", timeout, maxBuffer: 16 << 20 }, (err, stdout, stderr) => {
    if (err && err.code === "ENOENT") return resolve({ unavailable: "gh isn't installed" });
    const r = parseInclude(stdout); if (r) return resolve(r);
    if (/auth|login|GH_TOKEN/i.test(String(stderr))) return resolve({ unavailable: "gh isn't signed in" });
    const code = /HTTP (\d{3})/.exec(String(stderr));
    if (code) return resolve({ status: +code[1], headers: { link: "" }, text: "" });
    resolve({ status: 0, error: err && err.killed ? `timed out after ${timeout / 1000} s` : String((err && err.message) || "gh failed").split("\n")[0].slice(0, 80) });
  }));
}

// One run's requests: each address once, a host that said 403/429 not asked again.
export function makeContext({ fetchImpl = globalThis.fetch, gh = ghApi, timeout = TIMEOUT, now = new Date() } = {}) {
  const limited = new Set(), memo = new Map(); let useGh = true;
  const ask = async (host, key, thunk) => {
    if (limited.has(host)) return { status: 429, skipped: true };
    if (memo.has(key)) return memo.get(key);
    const r = (await thunk()) || { status: 0, error: "no answer" };
    if (r.status === 403 || r.status === 429) limited.add(host);
    memo.set(key, r); return r;
  };
  return {
    now, limited, usedGh: () => useGh,
    web: (url, accept = "application/json") => ask(hostOf(url), url, () => httpGet(url, { fetchImpl, timeout, accept })),
    github: p => ask("api.github.com", `gh:${p}`, async () => {
      if (useGh) { const r = await gh(p, { timeout }); if (!r || !r.unavailable) return r; useGh = false; }
      return httpGet(`https://api.github.com/${p}`, { fetchImpl, timeout, accept: "application/vnd.github+json" });
    }),
  };
}
// Why a request gave nothing, in words for the owner.
const whyNot = r => r.status === 403 || r.status === 429 ? RATE : r.status === 404 ? "not found (HTTP 404)" : r.error ? r.error : `HTTP ${r.status}`;
const okStatus = r => r.status >= 200 && r.status < 300;
const jsonOf = r => { try { return JSON.parse(r.text); } catch { return undefined; } };

// ---- the readers: each adds what it read and names what it couldn't ----
async function readGithub(value, ctx, add, miss) {
  const raw = String(value ?? "").trim().replace(/^https?:\/\/(?:www\.)?github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  const m = /^([A-Za-z0-9][\w-]{0,38})\/([\w.-]{1,100})$/.exec(raw);
  if (!m) return miss(GITHUB_KEYS, "not an owner/repo");
  const repo = `${m[1]}/${m[2]}`, source = `https://github.com/${repo}`;
  const meta = await ctx.github(`repos/${repo}`);
  if (!okStatus(meta)) return miss(GITHUB_KEYS, whyNot(meta));
  const J = jsonOf(meta);
  if (!J || typeof J !== "object") miss(["githubStars", "githubForks"], "the answer isn't JSON");
  else for (const [key, field] of [["githubStars", "stargazers_count"], ["githubForks", "forks_count"]]) typeof J[field] === "number" ? add(key, J[field], source) : miss([key], `no ${field} in the answer`);
  const since = new Date(ctx.now.getTime() - RECENT_DAYS * DAY);
  const rel = await ctx.github(`repos/${repo}/releases?per_page=100`);
  if (!okStatus(rel)) miss(["githubReleases30d"], whyNot(rel));
  else { const L = jsonOf(rel); Array.isArray(L) ? add("githubReleases30d", L.filter(x => x && !x.draft && Date.parse(x.published_at) >= since.getTime()).length, `${source}/releases`) : miss(["githubReleases30d"], "the answer isn't a list"); }
  const com = await ctx.github(`repos/${repo}/commits?since=${encodeURIComponent(since.toISOString())}&per_page=1`);
  if (com.status === 409) add("githubCommits30d", 0, `${source}/commits`); // an empty repository
  else if (!okStatus(com)) miss(["githubCommits30d"], whyNot(com));
  else { const L = jsonOf(com); if (!Array.isArray(L)) miss(["githubCommits30d"], "the answer isn't a list"); else { const last = /<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(com.headers.link || ""); add("githubCommits30d", last ? +last[1] : L.length, `${source}/commits`); } }
}
async function readNpm(value, ctx, add, miss) {
  const name = String(value ?? "").trim();
  if (!NPM.test(name)) return miss(["npmWeeklyDownloads"], "not an npm package name");
  const r = await ctx.web(`https://api.npmjs.org/downloads/point/last-week/${name}`);
  if (!okStatus(r)) return miss(["npmWeeklyDownloads"], whyNot(r));
  const J = jsonOf(r);
  typeof (J && J.downloads) === "number" ? add("npmWeeklyDownloads", J.downloads, `https://www.npmjs.com/package/${name}`) : miss(["npmWeeklyDownloads"], "the answer has no download count");
}
async function readAppStore(S, ctx, add, miss) {
  const app = appStoreOf({ appStore: S.appStore, country: S.country });
  if (!app) return miss(APP_KEYS, "no App Store id in that value (use the number from the app's address, id123456789)");
  const r = await ctx.web(app.url);
  if (!okStatus(r)) return miss(APP_KEYS, whyNot(r));
  const J = jsonOf(r), a = J && Array.isArray(J.results) ? J.results[0] : null;
  if (!a) return miss(APP_KEYS, "no app under that id and country");
  const source = String(a.trackViewUrl || "").split("?")[0] || `https://apps.apple.com/${app.country}/app/id${app.id}`;
  // The current version's own numbers: the all-time ones would hide a bad release.
  const rating = a.averageUserRatingForCurrentVersion, count = a.userRatingCountForCurrentVersion;
  if (typeof rating === "number") add("appStoreRating", Math.round(rating * 100) / 100, source); else miss(["appStoreRating"], "no rating for the current version yet");
  if (typeof count === "number") add("appStoreRatings", count, source); else miss(["appStoreRatings"], "no rating count for the current version yet");
}

// JSON-LD `JobPosting` objects in a page: by their @type, not by words.
export function jobPostingsIn(html) {
  const found = new Map(); let blocks = 0;
  const walk = (n, depth = 0) => {
    if (depth > 20 || !n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(x => walk(x, depth + 1));
    if ([].concat(n["@type"] || []).includes("JobPosting")) found.set(JSON.stringify(n), true);
    for (const v of Object.values(n)) walk(v, depth + 1);
  };
  for (const m of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi)) { try { walk(JSON.parse(m[1])); blocks++; } catch {} }
  return { count: found.size, blocks };
}
const BOARDS = {
  greenhouse: { api: t => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`, page: t => `https://boards.greenhouse.io/${t}`, count: J => typeof (J && J.meta && J.meta.total) === "number" ? J.meta.total : Array.isArray(J && J.jobs) ? J.jobs.length : null },
  lever: { api: t => `https://api.lever.co/v0/postings/${t}?mode=json`, page: t => `https://jobs.lever.co/${t}`, count: J => Array.isArray(J) ? J.length : null },
  ashby: { api: t => `https://api.ashbyhq.com/posting-api/job-board/${t}`, page: t => `https://jobs.ashbyhq.com/${t}`, count: J => Array.isArray(J && J.jobs) ? J.jobs.filter(x => x && x.isListed !== false).length : null },
};
async function readCareers(C, ctx, add, miss) {
  const named = [...Object.keys(BOARDS), "page"].filter(k => C && C[k] != null && C[k] !== "");
  if (named.length !== 1) return miss(["openRoles"], named.length ? "careers names more than one board: keep one" : "careers names no board (greenhouse, lever, ashby or page)");
  const kind = named[0], value = String(C[kind]).trim();
  if (kind === "page") {
    const u = httpUrl(value); if (!u) return miss(["openRoles"], "careers.page isn't an http(s) address");
    if (/(^|\.)linkedin\.com$/.test(hostOf(u.href))) return miss(["openRoles"], "LinkedIn is never read by Nosy");
    const r = await ctx.web(u.href, "text/html,*/*");
    if (!okStatus(r)) return miss(["openRoles"], whyNot(r));
    const P = jobPostingsIn(r.text);
    return P.count ? add("openRoles", P.count, u.href) : miss(["openRoles"], "can't count from this page (no JobPosting data in it)");
  }
  if (!NAME.test(value)) return miss(["openRoles"], `not a ${kind} board name`);
  const B = BOARDS[kind], r = await ctx.web(B.api(value));
  if (!okStatus(r)) return miss(["openRoles"], whyNot(r));
  const n = B.count(jsonOf(r));
  n === null ? miss(["openRoles"], "the answer isn't a job list") : add("openRoles", n, B.page(value));
}

// Everything configured, read. rivals: sources.json `rivals`. Rivals with no `signals` are left out.
export async function readSignals(rivals, deps = {}) {
  const ctx = deps.ctx || makeContext(deps), out = [], warnings = [];
  for (const [slug, R] of Object.entries(rivals || {})) {
    const S = R && R.signals; if (S == null) continue;
    if (typeof S !== "object" || Array.isArray(S)) { warnings.push(`${slug}: \`signals\` must be an object`); continue; }
    for (const k of Object.keys(S)) if (!["github", "npm", "appStore", "country", "careers"].includes(k)) warnings.push(`${slug}: unknown signals source \`${k}\` (known: github, npm, appStore, careers)`);
    const signals = [], unread = [];
    const add = (key, value, source) => signals.push({ key, label: LABEL[key], value, source });
    const miss = (keys, why) => keys.forEach(key => unread.push({ key, why }));
    if (S.github != null) await readGithub(S.github, ctx, add, miss);
    if (S.npm != null) await readNpm(S.npm, ctx, add, miss);
    if (S.appStore != null && String(S.appStore).trim()) await readAppStore(S, ctx, add, miss);
    if (S.careers != null) await readCareers(S.careers, ctx, add, miss);
    const order = (a, b) => KEYS.indexOf(a.key) - KEYS.indexOf(b.key);
    out.push({ slug, name: (R && R.name) || slug, signals: signals.sort(order), unread: unread.sort(order) });
  }
  return { rivals: out, warnings, limited: [...ctx.limited], viaGh: ctx.usedGh() };
}

// ---- history ----
export const historyFile = pm => path.join(pm, "history", "rival-signals.jsonl");
const parseLines = text => String(text || "").split("\n").filter(l => l.trim()).map(raw => { try { const x = JSON.parse(raw); return x && typeof x.at === "string" && x.rivals && typeof x.rivals === "object" ? { raw, at: x.at, rivals: x.rivals } : { raw }; } catch { return { raw }; } });
export function readHistory(pm) { try { return parseLines(fs.readFileSync(historyFile(pm), "utf8")).filter(x => x.at); } catch { return []; } }
// The value on the oldest line from the last 28 days that has this signal (today's own line, which this run replaces, doesn't count).
export function previousOf(history, today, slug, key) {
  const from = isoDay(new Date(Date.parse(today + "T00:00:00Z") - HISTORY_DAYS * DAY));
  const rows = history.map(h => ({ day: h.at.slice(0, 10), v: h.rivals[slug] && h.rivals[slug][key] })).filter(x => x.day < today && x.day >= from && typeof x.v === "number").sort((a, b) => (a.day < b.day ? -1 : 1));
  return rows.length ? { previous: rows[0].v, since: rows[0].day } : { previous: null, since: null };
}
// Appends this run's values as one line; the line already written for the same day is replaced, every other line is kept as it is.
export function saveHistory(pm, result, now) {
  const today = isoDay(now), rivals = {};
  for (const R of result) if (R.signals.length) rivals[R.slug] = Object.fromEntries(R.signals.map(s => [s.key, s.value]));
  const f = historyFile(pm); let kept = []; try { kept = parseLines(fs.readFileSync(f, "utf8")).filter(x => !(x.at && x.at.slice(0, 10) === today)).map(x => x.raw); } catch {}
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp`; fs.writeFileSync(tmp, [...kept, JSON.stringify({ at: now.toISOString(), rivals })].join("\n") + "\n"); fs.renameSync(tmp, f);
}

// ---- state + table ----
export function buildState(result, history, now) {
  const today = isoDay(now);
  return { type: "rivalSignals", generated: now.toISOString(), rivals: result.map(R => ({ slug: R.slug, name: R.name,
    signals: R.signals.map(s => ({ key: s.key, label: s.label, value: s.value, ...previousOf(history, today, R.slug, s.key), source: s.source })),
    unread: R.unread.map(u => ({ key: u.key, why: u.why })) })) };
}
const sign = d => (d > 0 ? "+" : d < 0 ? "-" : "") + fmt(Math.abs(d));
const deltaOf = s => s.previous === null ? null : Math.round((s.value - s.previous) * 100) / 100;
export function render(state, { missing = [], warnings = [], limited = [], viaGh = true } = {}) {
  const L = [`# Rival signals · ${state.generated.slice(0, 10)}`, "", "Public numbers as proxies for interest, not revenue and not users. Each is compared with the oldest reading from the last 28 days.", ""];
  let first = 0, moved = [];
  for (const R of state.rivals) {
    L.push(`## ${R.name}`);
    for (const s of R.signals) {
      const d = deltaOf(s);
      if (d === null) { first++; L.push(`- ${s.label} ${fmt(s.value)} (first reading)`); continue; }
      L.push(`- ${s.label} ${fmt(s.value)} (${d === 0 ? `no change since ${s.since}` : `${sign(d)} since ${s.since}`})`);
      if (d !== 0) moved.push({ R, s, d, score: Math.abs(d) / (s.key === "appStoreRating" ? 5 : Math.max(s.previous, 10)) });
    }
    for (const u of R.unread) L.push(`- not read: ${LABEL[u.key]} — ${u.why}`);
    if (!R.signals.length && !R.unread.length) L.push("- nothing configured");
    L.push("");
  }
  if (missing.length) L.push(`No signals configured for: ${missing.join(", ")} (\`nosy rival-signals init\` proposes them from the rival files).`, "");
  for (const w of warnings) L.push(`Note: ${w}`);
  if (limited.length) L.push(`Rate limited, so not asked again this run: ${limited.join(", ")}.${limited.includes("api.github.com") && !viaGh ? " Sign in with `gh auth login` for a higher GitHub limit." : ""}`);
  moved.sort((a, b) => b.score - a.score);
  const top = moved[0];
  L.push(top ? `Changed most: ${top.R.name}, ${top.s.label} ${sign(top.d)} since ${top.s.since}.` : first && first === state.rivals.reduce((n, R) => n + R.signals.length, 0) ? "First readings saved: changes show from the next run." : "Nothing moved since the earlier readings.");
  return L.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// `run`: read, compare, save history, write the state file. deps are the injectable fetch / gh / clock.
export async function runSignals(pm, { json = null, now = new Date(), offline = false, ...deps } = {}) {
  let K; try { K = readSources(pm); } catch { return { code: 1, text: `Psst… ${sourcesProblem(pm) || `Couldn't read ${path.join(pm, "sources.json")}.`}` }; }
  const rivals = K.rivals || {}, configured = Object.entries(rivals).filter(([, R]) => R && R.signals != null);
  if (!configured.length) return { code: 1, text: "No rival has `signals` yet. `nosy rival-signals init` proposes them from the rival files (it writes nothing); add what is right under `rivals.<slug>.signals` in pm/sources.json." };
  if (offline) return { code: 0, text: "NOSY_OFFLINE=1: rival signals not read." };
  const R = await readSignals(rivals, { now, ...deps }), history = readHistory(pm), state = buildState(R.rivals, history, now);
  saveHistory(pm, R.rivals, now);
  const out = json || path.join(pm, "state", "rival-signals.json");
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(state, null, 1));
  const missing = Object.keys(rivals).filter(s => !(rivals[s] && rivals[s].signals != null));
  return { code: R.rivals.some(x => x.unread.length) ? 2 : 0, text: render(state, { missing, warnings: R.warnings, limited: R.limited, viaGh: R.viaGh }), state };
}

// ---- init: a proposal from what the rival files already link to ----
const ATS = [
  { kind: "greenhouse", hosts: ["boards.greenhouse.io", "job-boards.greenhouse.io"], token: u => { const a = u.pathname.split("/").filter(Boolean)[0]; return a === "embed" ? u.searchParams.get("for") : a; } },
  { kind: "greenhouse", hosts: ["boards-api.greenhouse.io"], token: u => (/^\/v1\/boards\/([^/]+)/.exec(u.pathname) || [])[1] },
  { kind: "lever", hosts: ["jobs.lever.co"], token: u => u.pathname.split("/").filter(Boolean)[0] },
  { kind: "lever", hosts: ["api.lever.co"], token: u => (/^\/v0\/postings\/([^/]+)/.exec(u.pathname) || [])[1] },
  { kind: "ashby", hosts: ["jobs.ashbyhq.com"], token: u => u.pathname.split("/").filter(Boolean)[0] },
  { kind: "ashby", hosts: ["api.ashbyhq.com"], token: u => (/^\/posting-api\/job-board\/([^/]+)/.exec(u.pathname) || [])[1] },
];
// Every address in some text, read as an address (host and path), not as prose.
export function signalsIn(text) {
  const github = new Map(), npm = new Set(), apps = new Map(), careers = [];
  const hit = (map, k) => { const key = k.toLowerCase(); map.set(key, { name: map.get(key)?.name || k, n: (map.get(key)?.n || 0) + 1 }); };
  for (const m of String(text).matchAll(/https?:\/\/[^\s)>\]"'`,<]+/g)) {
    let u; try { u = new URL(m[0].replace(/[.;:]+$/, "")); } catch { continue; }
    const host = u.hostname.replace(/^www\./, "").toLowerCase(), seg = u.pathname.split("/").filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
    if (host === "github.com") { const r = reposIn(`github.com/${seg[0] || ""}/${seg[1] || ""}`)[0]; if (r) hit(github, r); }
    else if (host === "api.github.com" && seg[0] === "repos" && seg[1] && seg[2]) { const r = reposIn(`github.com/${seg[1]}/${seg[2]}`)[0]; if (r) hit(github, r); }
    else if (host === "npmjs.com" && seg[0] === "package" && seg[1]) { const n = seg[1].startsWith("@") ? `${seg[1]}/${seg[2] || ""}` : seg[1]; if (NPM.test(n)) npm.add(n); }
    else if (host === "registry.npmjs.org" && seg[0]) { const n = seg[0].startsWith("@") && seg[1] ? `${seg[0]}/${seg[1]}` : seg[0]; if (NPM.test(n)) npm.add(n); }
    else if (host === "apps.apple.com" || host === "itunes.apple.com") { const a = appStoreOf({ appStore: u.href }); if (a) apps.set(a.id, a); }
    else { const t = ATS.find(x => x.hosts.includes(host)); const tok = t && t.token(u); if (tok && NAME.test(tok) && !careers.some(c => c[t.kind] === tok)) careers.push({ [t.kind]: tok }); }
  }
  return { github: [...github.values()].sort((a, b) => b.n - a.n).map(x => x.name), npm: [...npm], apps: [...apps.values()], careers };
}
export function initProposal(pm, K) {
  const dir = rivalsDir(pm, K), nested = dir !== path.join(pm, "rivals"), rivals = (K && K.rivals) || {}, texts = new Map();
  for (const rel of rivalFiles(dir, { nested })) { const slug = path.basename(rel).replace(/\.md$/i, ""); try { texts.set(slug, fs.readFileSync(path.join(dir, rel), "utf8")); } catch {} }
  for (const slug of Object.keys(rivals)) if (!texts.has(slug)) texts.set(slug, "");
  const block = {}, notes = [];
  for (const slug of [...texts.keys()].sort()) {
    const R = rivals[slug] || {};
    if (R.signals != null) { notes.push(`${slug}: already has \`signals\`, left alone`); continue; }
    const registry = [R.site, ...[].concat(R.releases || [], R.news || [], R.blog || [], R.pricing || [])].filter(x => typeof x === "string").join("\n");
    const S = signalsIn(`${texts.get(slug)}\n${registry}`), signals = {};
    if (S.github.length) { signals.github = S.github[0]; if (S.github.length > 1) notes.push(`${slug}: also links ${S.github.slice(1, 4).join(", ")}; check which GitHub repo is the rival's own`); }
    if (S.npm.length) { signals.npm = S.npm[0]; if (S.npm.length > 1) notes.push(`${slug}: also links the npm packages ${S.npm.slice(1, 4).join(", ")}`); }
    const app = S.apps[0] || appStoreOf(R.stores);
    if (app) { signals.appStore = app.id; if (app.country !== "us") signals.country = app.country; }
    if (S.careers.length) { signals.careers = S.careers[0]; if (S.careers.length > 1) notes.push(`${slug}: also links the job boards ${S.careers.slice(1, 3).map(c => Object.entries(c)[0].join(" ")).join(", ")}`); }
    if (Object.keys(signals).length) block[slug] = { signals }; else notes.push(`${slug}: nothing found (no GitHub, npm, App Store or job-board link in its file or its registry pages)`);
  }
  return { block, notes };
}
export function renderInit({ block, notes }) {
  const L = ["# Rival signals · proposed (nothing was written)", ""];
  if (Object.keys(block).length) L.push("Check each one, then merge what is right into `rivals` in pm/sources.json:", "", JSON.stringify({ rivals: block }, null, 2), "");
  else L.push("No GitHub, npm, App Store or job-board link found in the rival files.", "");
  for (const n of notes) L.push(`- ${n}`);
  L.push("- a careers `page` can't be guessed: add `careers: { \"page\": \"https://…\" }` by hand where the company publishes JobPosting data");
  return L.join("\n");
}

// ---- notes: what the owner read in public, kept next to the numbers ----
export const notesFile = pm => path.join(pm, "signal", "rival-notes.jsonl");
const MAX_NOTE = 600;
export function readNotes(pm) { try { return fs.readFileSync(notesFile(pm), "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(n => n && n.slug && n.text && n.source); } catch { return []; } }
const knownSlugs = (pm, K) => { const dir = rivalsDir(pm, K); return new Set([...Object.keys((K && K.rivals) || {}), ...rivalFiles(dir, { nested: dir !== path.join(pm, "rivals") }).map(f => path.basename(f).replace(/\.md$/i, ""))]); };
export function addNote(pm, { slug, text, source, date }, { now = new Date() } = {}) {
  const day = isoDay(now), S = httpUrl(source);
  if (!S) return { code: 1, text: "A note needs a source: pass --source <http(s) address> of where it was published. A signal without a source is a rumour, so nothing was saved." };
  const body = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!body) return { code: 1, text: "A note needs text: nosy rival-signals note <slug> \"<what you saw>\" --source <url>." };
  if (body.length > MAX_NOTE) return { code: 1, text: `Keep a note to ${MAX_NOTE} characters (this one is ${body.length}): one observation, with its source. Nothing was saved.` };
  if (date != null && !(/^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date + "T00:00:00Z")) && isoDay(new Date(date + "T00:00:00Z")) === date)) return { code: 1, text: `--date must be a real day as YYYY-MM-DD (got "${date}"). Nothing was saved.` };
  if (date && date > day) return { code: 1, text: `--date ${date} is in the future: a note records something already public. Nothing was saved.` };
  let K = null; try { K = readSources(pm); } catch {}
  const known = knownSlugs(pm, K);
  if (!NAME.test(String(slug ?? ""))) return { code: 1, text: "A note needs the rival's slug (the name of its file in pm/rivals/ without .md)." };
  if (known.size && !known.has(slug)) return { code: 1, text: `No rival called "${slug}". Known: ${[...known].sort().join(", ")}. Nothing was saved.` };
  const note = { at: date || day, slug, text: body, source: S.href, added: now.toISOString() };
  if (readNotes(pm).some(n => n.slug === slug && n.text === body && n.source === note.source)) return { code: 0, text: "Already saved." };
  fs.mkdirSync(path.dirname(notesFile(pm)), { recursive: true }); fs.appendFileSync(notesFile(pm), JSON.stringify(note) + "\n");
  return { code: 0, text: `Saved to ${notesFile(pm)}: ${note.at} · ${slug} · ${body}${hostOf(note.source) === "linkedin.com" ? "\n(a LinkedIn address is kept as a link you pasted; Nosy never opens it)" : ""}\nNotes stay on this machine: they are never fetched and never published.` };
}
export function renderNotes(notes, slug) {
  const list = notes.filter(n => !slug || n.slug === slug).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  if (!list.length) return slug ? `No notes for ${slug} yet.` : "No notes yet: `nosy rival-signals note <slug> \"<text>\" --source <url>`.";
  return list.map(n => `${n.at} · ${n.slug} · ${n.text} (${n.source})`).join("\n");
}

// ---- command line ----
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; }, has = k => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true; };
  const sub = argv[0] && !argv[0].startsWith("--") ? argv.shift() : "run"; // `nosy rival-signals --json f` is `run`
  const asJson = sub === "notes" && has("--json"), jsonFile = sub === "run" ? take("--json") : null, source = take("--source"), date = take("--date");
  const [pm = "pm", ...rest] = argv;
  const say = r => { (r.code === 1 ? console.error : console.log)(r.text); process.exitCode = r.code; };
  if (sub === "run") {
    say(await runSignals(pm, { json: jsonFile, offline: process.env.NOSY_OFFLINE === "1" }));
  } else if (sub === "init") {
    let K = null; try { K = readSources(pm); } catch {}
    say(K ? { code: 0, text: renderInit(initProposal(pm, K)) } : { code: 1, text: `Psst… ${sourcesProblem(pm) || `Couldn't read ${path.join(pm, "sources.json")}.`}` });
  } else if (sub === "note") say(addNote(pm, { slug: rest[0], text: rest[1], source, date }));
  else if (sub === "notes") say({ code: 0, text: asJson ? JSON.stringify(readNotes(pm).filter(n => !rest[0] || n.slug === rest[0]), null, 1) : renderNotes(readNotes(pm), rest[0]) });
  else say({ code: 1, text: `Unknown subcommand "${sub}". Use run, init, note or notes.` });
}
