// Plan gate scan: are the features shipped in the last N days behind any plan/subscription gate?
// Inspired by BVP's "Startup Pricing Journey" — a team ships feature after feature, and the value given quickly
// outgrows the price ("surplus innovation"); packaging is the fastest way to turn that surplus into money. Nosy
// sees this from the code; it never touches customer data.
// Usage: node plan-gates.mjs <pm folder> [--json <file>] [--day 90]   (reads pm/sources.json)
// Reads: <pm>/sources.json → repo, ref, money?: { gate: "<extra regex>", billing: "<extra regex>", day: 90, excluded: [glob] }.
// Files are read via git grep/log through <ref>; no checkout. If there's no billing trace (the product isn't
// charging money yet) no signal is produced: "no pricing yet" can be a decision (like Nosy itself), not treated as a gap.
// A feature field counts as "gated": either a plan-gate line is in that field's files, or the field's name shows up
// in a gate line / a plan config file (the central `plans.ts: pro: ["export", ...]` pattern).
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { readSources } from "./sources-file.mjs";

const Source = /\.((m|c)?[jt]sx?|py|go|rb|php|java|kt|swift|dart|cs|rs|vue|svelte|ex|exs)$/i;
const Setting = /\.(json|ya?ml|toml)$/i;
const withTest = f => /(^|\/)(tests?|__tests__|testdata|fixtures?|e2e|cypress|playwright)\//i.test(f) || /\.(test|spec|stories|story)\.[a-z]+$/i.test(f) || /_test\.go$/.test(f) || /(^|\/)test_[^/]+\.py$/.test(f);
const noise = f => /(^|\/)(node_modules|dist|build|vendor|\.next|coverage)\//.test(f) || /(package-lock|yarn\.lock|pnpm-lock|composer\.lock|Gemfile\.lock|go\.sum|Cargo\.lock)/.test(f) || /\.(md|mdx|txt|lock|snap|map|min\.js)$/i.test(f);

// git grep -E (POSIX ERE) doesn't recognize \\b and \\s on every platform; a loose ERE picks the lines first, the
// exact match happens in JS.
// Billing trace: a payment provider, a subscription, or in-app purchase code.
const BILLING_ERE = "stripe|paddle|lemon_?squeezy|chargebee|revenuecat|recurly|braintree|iyzico|storekit|purchase|billing|subscription|checkout|price_";
const Billing = /\b(stripe|paddle|lemon_?squeezy|chargebee|revenuecat|recurly|braintree|iyzico|storekit)|in_?app_?purchase|\bbilling|\bsubscriptions?\b(?=.{0,60}(?:plan|price|pricing|invoice|payment|trial|tier|renew|cancel|seat))|checkout[._]?session|\bprice_[A-Za-z0-9]{8,}/i;
// The word alone isn't enough: real usage is what's searched for (an SDK import, a billing API call, or code
// inside a billing folder).
// Nosy's own privacy scanner contains the "stripe" keyword pattern, so it looked like it "had billing" too.
const FAT_ICE = /(\bimport\b|\brequire\s*\(|\bfrom\b|\buse\b)[^\n]*["'`(]?(stripe(?![a-z])|@stripe\/|paddle(?![a-z])|@paddle\/|@lemonsqueezy|chargebee|react-native-purchases|revenuecat|purchases_flutter|recurly|braintree|iyzipay|storekit|github\.com\/stripe)/i; // a word boundary after the provider: "paddleboard" is not Paddle
const FAT_API = /checkout\.sessions\.create|billing_?portal|subscriptions\.(create|update|cancel)|Purchases\.(configure|shared)|SKPaymentQueue|Product\.purchase|new\s+Stripe\s*\(|stripe\.\w+\.(create|retrieve)/i;
// "subscriptions" and "payments" folders are as often a realtime handler or a ledger as billing: only the unambiguous names count on their own.
const FAT_DIRECTORY = /(^|\/)(billing|paywall|checkout)(\/)/i;
// Product-sourced billing glossary (internal request 108, the language audit §1 "plan-gates.mjs:21-46
// Billing/Gate/Infrastructure"): the billing SDK imports/API calls above (FAT_ICE/FAT_API) are code shape -
// library names like "stripe"/"iyzico" stay the same regardless of the product's own language, so they're
// left untouched. What IS language-dependent is the MAPPING of a folder/file NAME to the concept "billing"
// (FAT_DIRECTORY, and the plan-file-name pattern below) - a German product's `abrechnung/` folder or
// `preise.ts` plan file isn't recognized by the English word list alone. Same shape as read-decisions.mjs's
// glossary.notDoing/glossary.measurement and read-design.mjs's glossary.design
//: sources.json's `glossary.billing` stays a FLAT array of "billing:<word>" strings
// (the product's own folder/field words, any language) - K.glossary is read generically (as a plain
// {word: [translations]} map) by half a dozen other tools; a nested object here would break that. Merged
// with (never replacing) the English core.
const BILLING_FIELDS = new Set(["billing"]);
function billingGlossaryMap(list) {
  const map = {};
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== "string") continue;
    const m = raw.match(/^(\w+):(.+)$/);
    if (m && BILLING_FIELDS.has(m[1]) && m[2].trim()) (map[m[1]] ??= []).push(m[2].trim());
  }
  return map;
}
function billingWordsFrom(glossary) {
  const map = billingGlossaryMap(glossary?.billing);
  return (map.billing || []).map(s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}
function fatDirectoryFor(glossary) {
  const extra = billingWordsFrom(glossary);
  if (!extra.length) return FAT_DIRECTORY;
  return new RegExp(`(^|/)(billing|subscriptions?|payments?|paywall|checkout|${extra.join("|")})(/)`, "i");
}
function planFileRegexFor(glossary) {
  const extra = billingWordsFrom(glossary);
  const base = "plans?|pricing|tiers?|entitlements?|paywall|features?[-_.]?(matrix|map|gates?)";
  const alt = extra.length ? `${base}|${extra.join("|")}` : base;
  return new RegExp(`(^|/)[^/]*(${alt})[^/]*\\.[a-z]+$`, "i");
}
// Plan gate: a plan/tier comparison, an entitlement function, an "isPro" flag, a paywall.
// Only a real gate USE counts: an entitlement call, a comparison to a known plan name, a paywall. Not just any
// line that has "plan" or "tier" in it (in a previous product, `plan.kind === "fresh"` was an agent's plan,
// `j.Tier` was a job scheduler, "feature_gate_misconfigured" was an error code — all three looked like a gate).
const GATE_ERE = "plan|tier|subscri|entitle|paywall|upgrade|is_?(pro|premium|paid|enterprise|subscribed|business)|(has|can|require|check)_?(feature|access|plan)";
const PLAN_NAME_OF = "free|pro|premium|business|enterprise|team|starter|basic|plus|trial|growth|scale";
const Gate = new RegExp([
  "\\b(has|can|require|requires|check|is|ensure|assert)_?(feature|plan|entitlement|access|subscription|tier|gate)[A-Za-z]*\\s*\\(",
  `\\b(plan|tier)(\\.|_)?(id|name|type|level|key|slug|code)?\\s*(===|==|!==|!=)\\s*["'\`](${PLAN_NAME_OF})["'\`]`,
  `["'\`](${PLAN_NAME_OF})["'\`]\\s*(===|==|!==|!=)\\s*[\\w.]*\\b(plan|tier)`,
  "\\bis_?(pro|premium|paid|enterprise|subscribed|business)\\b(?!\\s*[:=]\\s*(true|false))",
  "\\bentitlements?\\s*[.(\\[]", "<Paywall\\b|\\bshow_?paywall\\s*\\(", "\\bupgrade_?(required|prompt|modal|wall|gate)\\b",
].join("|"), "i");
// A gate DEFINITION (a feature registry): `GateAnalyze FeatureGate = "analyze"`, `FEATURES = { export: ["pro"] }`.
// Feature names are collected from these; a field is "gated" if its name is one of them.
const GATE_DEFINITION = /\b(Gate|Feature|Entitlement)[A-Z]\w*\b[^\n]*=\s*["'`][\w-]+["'`]|\b(FeatureGate|Entitlement|PlanFeature)s?\b/;
// Fields that are pricing infrastructure themselves, or add no value on screen: no gate is expected.
const Infrastructure = /^(auth|login|logout|signup|sign-up|register|session|billing|payment|payments|stripe|checkout|subscription|subscriptions|pricing|plans?|paywall|entitlements?|admin|settings|config|ci|cd|deps|docs?|tests?|infra|health|liveness|readiness|i18n|locales?|migrations?|schema|db|scripts?|types?|utils?|lib|shared|common|core|ui|styles?|theme|themes|dark-?mode|tokens?|design|assets?|public|deploy|release|build|sandbox\w*|docker|k8s|helm|telemetry|logging|observability|monitoring|frontend|backend|web|api|be|fe|panel)$/i;
// A user-facing feature: at least one of its commits must touch a screen file. A backend/infrastructure-only
// change doesn't count as a "packageable feature" (in a previous product, sandboxd, deploy, and liveness alone
// inflated most of the 93 gateless fields).
const Screen = /\.(jsx|tsx|vue|svelte|html|swift|dart|kt)$/i;
// Boilerplate folders at the start of the path: the field name is the first meaningful part after them.
const Pattern = /^(apps?|packages?|src|app|pages|components?|features?|modules?|lib|backend|frontend|web|api|server|client|internal|pkg|cmd|routes?|handlers?|services?|controllers?|views?|screens?|domain|v\d+|\(.*\))$/i;

const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/(es|s)$/, "");

// a scope that's itself an app/package name (feat(web-frontend): ...) isn't a feature
// area — it's the whole app. When `appNames` is given and the scope matches one of its entries, the scope is
// ignored and the area is instead derived from the touched files (the first meaningful feature folder, same
// as the no-scope path), with the app's own directory name also stripped from the candidate folders.
export function areaFind(files, scope, appNames) {
  if (scope && !(appNames && appNames.has(scope.toLowerCase()))) return scope.toLowerCase();
  const counter = new Map();
  for (const f of files.filter(f => Source.test(f) && !withTest(f) && !noise(f))) {
    const part = f.split("/"), name = part.pop().replace(/\.[^.]+$/, "").replace(/^(index|page|route|layout|main|mod)$/i, "");
    const meaningful = part.filter(p => !Pattern.test(p) && !(appNames && appNames.has(p.toLowerCase())));
    const a = (meaningful[0] || name || "").toLowerCase();
    if (a) counter.set(a, (counter.get(a) || 0) + 1);
  }
  return [...counter].sort((x, y) => y[1] - x[1])[0]?.[0] || null;
}

// a gate call's word alone can't be traced to the area it guards (`ai_enabled` shares no
// stem with `agent-chat`). Tracing follows the call site to what it actually guards: a route on the same
// line, a route registered nearby in the same file, or — for a Next.js-style app router — the route implied
// by the gated file's own path segments. Traced areas are kept apart from word-matched ones so the report can
// say which is which.
// Express/Koa (.get/.post(...)), Go net/http-style (.HandleFunc/.Handle/.Group(...)) and a declarative
// registrar (.Register("POST", "/path", policy, handler) — the first product's authz.Policy{Feature: ...} pattern, where
// the route string is the registrar call's 2nd argument, not the 1st).
const ROUTE_ON_LINE = /\.(?:get|post|put|patch|delete|all)\(\s*["'`](\/[^"'`]*)["'`]|\.(?:HandleFunc|Handle)\(\s*["'`](\/[^"'`]*)["'`]|\.Group\(\s*["'`](\/[^"'`]*)["'`]|\.Register\(\s*["'`][A-Za-z]+["'`]\s*,\s*["'`](\/[^"'`]*)["'`]/i;
const NextRouteFile = /(^|\/)app\/.+\/(page|route|layout)\.(tsx?|jsx?)$/;
// A `GateX = "x"` / `GateX FeatureGate = "x"` definition line — the identifier's origin, not a place it guards
// anything. Mirrors GATE_DEFINITION's first alternative so the same line is recognized both places.
const GateDefLine = /\b(Gate|Feature|Entitlement)[A-Z]\w*\b[^\n]*=\s*["'`][\w-]+["'`]/;
const routeOnLine = text => { const m = text.match(ROUTE_ON_LINE); return m ? (m[1] || m[2] || m[3] || m[4]) : null; };
const urlToArea = u => { const m = u.match(/^\/api\/v\d+\/([^/]+)/) || u.match(/^\/v\d+\/([^/]+)/) || u.match(/^\/([^/]+)/); return m ? m[1].toLowerCase() : null; };

// `gateSites` are candidate gate call/use lines (from the plan-gate word scan, plus any other `GateX`
// identifier use the caller wants traced — a declarative `Feature: authz.GateAIEnabled` struct field is a use,
// not a call, but still names what it guards). For each one: a route on the same line wins; otherwise the
// nearest route registration within a small window either side of it in the same file (a route can be
// registered right after — e.g. a shared `policy` built a few lines above several `.Register(...)` calls — or
// right before it); a Next.js app-router file falls back to the route implied by its own path.
export function traceGates(gateSites, showFile, appNames, window = 20) {
  const traced = new Map(); // norm(area) -> { area, gate, route, via }
  for (const s of gateSites) {
    if (GateDefLine.test(s.text)) continue; // a `GateX = "x"` definition, not a use that guards anything
    const lines = showFile(s.file);
    let route = routeOnLine(s.text), via = route ? "same-line" : null;
    for (let d = 1; !route && d <= window; d++) {
      const back = lines[s.line - 1 - d], forward = lines[s.line - 1 + d];
      const rb = back != null ? routeOnLine(back) : null;
      if (rb) { route = rb; via = `nearby-line:${s.line - d}`; break; }
      const rf = forward != null ? routeOnLine(forward) : null;
      if (rf) { route = rf; via = `nearby-line:${s.line + d}`; break; }
    }
    let area = null;
    if (route) area = urlToArea(route);
    else if (NextRouteFile.test(s.file)) { area = areaFind([s.file], null, appNames); route = s.file; via = "next-route-file"; }
    if (!area) continue;
    const key = norm(area);
    if (key.length >= 3 && !traced.has(key)) traced.set(key, { area, gate: `${s.file}:${s.line}`, route, via });
  }
  return traced;
}

function works(pm, dayArg) {
  const K = readSources(pm);
  const P = K.money || {}, day = +(dayArg || P.day || 90);
  const git = (...a) => execFileSync("git", ["-C", K.repo, ...a], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] });
  const tryGit = (...a) => { try { return git(...a); } catch { return ""; } };
  const excluded = (P.excluded || []).map(g => new RegExp("^" + g.split("**").map(p => p.split("*").map(esc).join("[^/]*")).join(".*") + "$"));
  const exclude = f => withTest(f) || noise(f) || excluded.some(r => r.test(f));
  const grepLine = (ere, re) => tryGit("grep", "-n", "-I", "-i", "-E", ere, K.ref).split("\n").map(l => l.match(/^[^:]+:([^:]+):(\d+):(.*)$/)).filter(Boolean)
    .map(([, file, line, text]) => ({ file, line: +line, text: text.trim() })).filter(s => Source.test(s.file) && !exclude(s.file) && re.test(s.text));

  // Product-sourced billing glossary + language: sources.json's `language` (BCP-47,
  // same field text.mjs's langOfLoad reads) and `glossary.billing` (folder/field words) - see the comment on
  // billingWordsFrom/fatDirectoryFor/planFileRegexFor above. en/tr/unset is treated as confident (Nosy's
  // original assumption, unchanged output for every existing caller/test); any other language is only
  // confident once sources.json gives it glossary.billing words.
  const glossary = K.glossary || null;
  const lang = typeof K.language === "string" && K.language.trim() ? K.language.trim().toLowerCase() : null;
  const languageKnown = !lang || lang === "en" || lang === "tr";
  const hasBillingGlossary = Array.isArray(billingGlossaryMap(glossary?.billing).billing);
  const confidentLanguage = languageKnown || hasBillingGlossary;
  const fatDirectory = fatDirectoryFor(glossary);

  const empty = { type: "plan-gate-of", generated: new Date().toISOString(), ref: K.ref, day, language: lang };
  const fat = grepLine(P.billing ? `${BILLING_ERE}|${P.billing}` : BILLING_ERE, P.billing ? new RegExp(`${Billing.source}|${P.billing}`, "i") : Billing).filter(s => !/^\s*(\/\/|#|\*)/.test(s.text) && (FAT_ICE.test(s.text) || FAT_API.test(s.text) || fatDirectory.test(s.file)));
  if (!fat.length) return { ...empty, billing_missing: true, gate_count: 0, fields: [], gateless: 0 };
  const invoiceFile = [...new Set(fat.map(s => s.file))];

  const gates = grepLine(P.gate ? `${GATE_ERE}|${P.gate}` : GATE_ERE, P.gate ? new RegExp(`${Gate.source}|${P.gate}`, "i") : Gate).filter(s => !/^\s*(\/\/|#|\*)/.test(s.text));
  // Plan config files: a source or settings file whose name has plan/pricing/tier/entitlement in it (or one
  // of the product's own glossary.billing words, for a plan/pricing file named in another language).
  const planFile = tryGit("ls-tree", "-r", "--name-only", K.ref).split("\n")
    .filter(f => planFileRegexFor(glossary).test(f) && (Source.test(f) || Setting.test(f)) && !exclude(f));
  const gatedWord = new Map(); // norm(word) → evidence
  // Feature names in a plan file can be short ("sso"); a 4-letter floor on strings from gate lines cuts noise.
  const wordAdd = (text, evidence, enAz = 4) => {
    for (const m of text.matchAll(/["'`]([A-Za-z][\w-]{2,40})["'`]/g)) { const k = norm(m[1]); if (k.length >= enAz && !new RegExp(`^(${PLAN_NAME_OF})$`).test(k) && !gatedWord.has(k)) gatedWord.set(k, evidence); }
    for (const m of text.matchAll(/\bGate([A-Z]\w+)/g)) { const k = norm(m[1]); if (k.length >= 4 && !gatedWord.has(k)) gatedWord.set(k, evidence); }
  };
  for (const s of gates) wordAdd(s.text, `${s.file}:${s.line}`);
  for (const s of grepLine("gate|feature|entitlement", GATE_DEFINITION)) wordAdd(s.text, `${s.file}:${s.line}`);
  for (const f of planFile) { const content = tryGit("show", `${K.ref}:${f}`); content.split("\n").forEach((l, i) => wordAdd(l, `${f}:${i + 1}`, 3)); }
  const gateFile = new Set(gates.map(s => s.file));

  // Never silent (the language audit "say so instead of going silent"): billing
  // code clearly exists (the fat.length check above already passed), but if literally no gate/plan-file
  // signal was found ANYWHERE in the repo, and the product's language isn't one Nosy confidently reads
  // (not en/tr, no glossary.billing given) - that's not the same claim as "genuinely no plan gate" (the
  // confident branch below, still produced unchanged for en/tr/glossary-covered products). It may just mean
  // the gate/plan folder or file is named in a language this script doesn't recognize yet.
  const gatesUnknown = !confidentLanguage && !gates.length && !planFile.length;
  const gatesNote = gatesUnknown ? `billing code found (${fat[0].file}:${fat[0].line}) but no gate/plan folder recognized in ${lang} — agent, check` : null;

  // A scope that's actually an app/package name (feat(web-frontend), feat(backend)) isn't a feature area by
  // itself — it's the whole app. Collected up front so both area detection and the final
  // app/broad-touch fallback can use it.
  const appNameOf = new Set(tryGit("ls-tree", "-d", "--name-only", K.ref, "apps/", "packages/", "services/").split("\n").filter(Boolean).map(d => d.split("/").pop().toLowerCase()));

  // trace each gate call to the route/screen it actually guards, not just its wording.
  // `gates` (the strict Gate-regex matches) misses a declarative registry like the first product's `authz.Policy{Feature:
  // authz.GateAIEnabled}` — a struct field, not a call the Gate regex recognizes — so a second, looser pass
  // over any `GateX` identifier USE (not its own definition) is added as tracing candidates too.
  const gateIdUse = grepLine("Gate[A-Za-z]", /\bGate[A-Z]\w*\b/).filter(s => !/^\s*(\/\/|#|\*)/.test(s.text));
  const traceCandidates = [...gates, ...gateIdUse].filter((s, i, all) => all.findIndex(x => x.file === s.file && x.line === s.line) === i);
  const fileCache = new Map();
  const showFile = f => { if (!fileCache.has(f)) fileCache.set(f, tryGit("show", `${K.ref}:${f}`).split("\n")); return fileCache.get(f); };
  const traced = traceGates(traceCandidates, showFile, appNameOf);

  // Features shipped in the last N days (feat: / feature: commits), with the files they touched.
  const log = tryGit("log", "--no-merges", `--since=${day}.days`, "--date=short", "--name-only", "--format=@@%h%x09%ad%x09%s", K.ref);
  const commits = [];
  for (const block of log.split("@@").filter(Boolean)) {
    const [head, ...files] = block.split("\n"), [h, date, ...topic] = head.split("\t"), title = topic.join("\t");
    const m = title.match(/^(feat|feature)(\(([^)]*)\))?!?:\s*/i);
    if (!m) continue; // only feat:/feature: — "add …" titles were also picking up test and chore commits
    const clean = files.map(d => d.trim()).filter(Boolean);
    commits.push({ h, date, title, files: clean, scope: m?.[3]?.split(/[,/]/)[0].trim() || null });
  }
  const fields = new Map();
  let appScopeCommits = 0, appScopeRecovered = 0;
  for (const c of commits) {
    const isAppScope = !!(c.scope && appNameOf.has(c.scope.toLowerCase()));
    const area = areaFind(c.files, c.scope, appNameOf);
    if (isAppScope) { appScopeCommits++; if (area && area.length >= 3 && !appNameOf.has(area)) appScopeRecovered++; }
    if (!area || area.length < 3) continue; // feat(J), feat(W): a one-letter scope isn't a field
    if (!fields.has(area)) fields.set(area, { area, commits: [], files: new Set(), screen: false });
    const A = fields.get(area); A.commits.push({ h: c.h, date: c.date, title: c.title.slice(0, 120) }); c.files.forEach(d => A.files.add(d)); if (c.files.some(d => Screen.test(d) && !withTest(d))) A.screen = true;
  }
  // A field whose area still equals an app name, or that still touches too broad a set of directories, wasn't
  // recoverable into a real feature folder — it's reported as the app, not left silently as a "field".
  const output = [];
  for (const A of fields.values()) {
    const upperDirectory = new Set([...A.files].map(d => d.split("/").slice(0, 3).join("/")));
    if (appNameOf.has(A.area) || upperDirectory.size > 8) { output.push({ area: A.area, commit_count: A.commits.length, commits: A.commits.slice(0, 5), gated: false, evidence: null, app: true }); continue; }
    const n = norm(A.area), infrastructure = Infrastructure.test(A.area), noScreen = !A.screen;
    let evidence = null, gateKind = null;
    const inFileGate = [...A.files].find(d => gateFile.has(d));
    if (inFileGate) { const s = gates.find(k => k.file === inFileGate); evidence = `${s.file}:${s.line}`; gateKind = "file"; }
    // Same fuzzy overlap rule as the word match below: a frontend feature folder ("agent-chat") is often a
    // sub-area of the backend route its gate actually traces to ("agent"), not an exact name match.
    if (!evidence && n.length >= 3) for (const [k, t] of traced) if (k === n || (n.length >= 5 && k.includes(n)) || (k.length >= 5 && n.includes(k))) { evidence = t.gate; gateKind = "traced"; break; }
    if (!evidence && n.length >= 3) for (const [k, kan] of gatedWord) if (k === n || (n.length >= 5 && k.includes(n)) || (k.length >= 5 && n.includes(k))) { evidence = kan; gateKind = "word"; break; }
    // Never silent: a field that would otherwise read as confidently "not tied to
    // any plan" is instead marked "unknown" when the WHOLE repo's gate/plan naming wasn't recognized in
    // this language (gatesUnknown, computed above) - the field might well be gated, just under a folder/
    // file name this script doesn't read yet, not genuinely open to everyone.
    const unknown = gatesUnknown && !evidence && !infrastructure && !noScreen;
    output.push({ area: A.area, commit_count: A.commits.length, commits: A.commits.slice(0, 5), gated: !!evidence, evidence, ...(gateKind ? { gateKind } : {}), ...(infrastructure ? { infrastructure: true } : {}), ...(noScreen ? { noScreen: true } : {}), ...(unknown ? { unknown: true } : {}) });
  }
  output.sort((a, b) => a.gated - b.gated || b.commit_count - a.commit_count);
  const gateless = output.filter(a => !a.gated && !a.infrastructure && !a.noScreen && !a.unknown && !a.app).length;
  return { ...empty, billing_missing: false, billing: invoiceFile.slice(0, 5), gate_count: gates.length,
    gate_example: gates.slice(0, 3).map(s => `${s.file}:${s.line}`), plan_files_of: planFile.slice(0, 5),
    traces: [...traced.values()], feature_commit: commits.length, fields: output, gateless,
    ...(gatesUnknown ? { gatesUnknown: true, gatesNote } : {}),
    app_scope_commits: appScopeCommits, app_scope_recovered: appScopeRecovered };
}

function formatMd(R) {
  let o = `# Plan gate · ${R.ref ? `${R.ref} · ` : ""}last ${R.day} days\n\n`;
  if (R.billing_missing) return o + "No billing trace in the code (payment provider, subscription, purchase). If the product isn't charging money yet, that's not a gap, it can be a decision; no signal was produced.\n";
  o += `Billing: ${R.billing.join(", ")}. Plan gate: ${R.gate_count} lines${R.gate_example.length ? ` (e.g. ${R.gate_example.join(", ")})` : ""}${R.plan_files_of.length ? `; plan files: ${R.plan_files_of.join(", ")}` : ""}.\n\n`;
  if (R.gatesUnknown) o += `**${R.gatesNote}.** This isn't the same as "no plan gate" (below) - the language isn't recognized yet, not confirmed absent; add \`glossary.billing\` words for this product's language to sources.json (see move-in.md step 5) and rerun.\n\n`;
  else if (!R.gate_count && !R.plan_files_of.length) o += "**Billing exists but no plan gate was found in the code:** either everyone gets everything, or the gate is written in a form this script doesn't recognize (a pattern can be given in sources.json under `money.gate`).\n\n";
  o += `${R.feature_commit} feature commits, ${R.fields.length} fields in the last ${R.day} days. **${R.gateless} fields aren't tied to any plan.** This isn't a defect, it's a question: which package should this feature belong to, or should it stay open to everyone?\n\n| Field | Feature | Tied to a plan | Evidence |\n|---|---|---|---|\n`;
  const wait = a => a.infrastructure ? "not expected (infrastructure)" : a.noScreen ? "not expected (no screen)" : a.unknown ? "**? — agent, check**" : "**no**";
  const kindOf = a => a.gateKind === "traced" ? "yes (traced)" : a.gateKind === "word" ? "yes (word match)" : a.gated ? "yes" : wait(a);
  for (const a of R.fields.filter(a => !a.app && (a.gated || (!a.infrastructure && !a.noScreen)))) o += `| ${a.area} | ${a.commit_count} · ${a.commits[0].h} ${a.commits[0].title.replace(/\|/g, "/").slice(0, 70)} | ${kindOf(a)} | ${a.evidence || "—"} |\n`;
  const other = R.fields.filter(a => !a.app && !a.gated && (a.infrastructure || a.noScreen)), applied = R.fields.filter(a => a.app);
  if (other.length) o += `\n${other.length} fields with no gate expected (infrastructure or no screen): ${other.slice(0, 20).map(a => a.area).join(", ")}${other.length > 20 ? "…" : ""}.\n`;
  if (applied.length) o += `\n${applied.reduce((t, a) => t + a.commit_count, 0)} feature commits written under an app name (${applied.map(a => a.area).join(", ")}) weren't counted as fields; scoping by feature name would break them out.\n`;
  if (R.app_scope_commits) o += `\n${R.app_scope_recovered}/${R.app_scope_commits} commits filed under an app-name scope were recovered into a real feature area from their touched files; the rest stayed unassigned.\n`;
  if (R.traces?.length) o += `\nGate traces (call site → route/area): ${R.traces.map(t => `\`${t.gate}\` → ${t.route ? `\`${t.route}\` → ` : ""}${t.area}`).join("; ")}.\n`;
  return o;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), ji = argv.indexOf("--json"), jsonOut = ji >= 0 ? argv.splice(ji, 2)[1] : null;
  const gi = argv.indexOf("--day"), day = gi >= 0 ? argv.splice(gi, 2)[1] : null;
  const R = works(argv[0] || "pm", day);
  process.stdout.write(formatMd(R));
  if (jsonOut) fs.writeFileSync((fs.mkdirSync(path.dirname(jsonOut), { recursive: true }), jsonOut), JSON.stringify(R, null, 1));
}

export { works as compute };
