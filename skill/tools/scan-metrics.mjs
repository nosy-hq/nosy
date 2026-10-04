// Metrics scan: does the product's main steps fire an analytics event in the code?
// Inspiration: Speedinvest "Ultimate Guide to Startup Metrics" (North Star + AARRR funnel: acquisition, activation, revenue, referral,
// churn). Nosy only reads code: event names and which steps the product offers. It doesn't look at event DATA (who did what).
// Usage: node scan-metrics.mjs <pm folder> [--json <file>]   (reads pm/sources.json)
// Reads: <pm>/sources.json → repo, ref, metrics?: { call: "<extra ERE>", northStar: { name, pattern }, excluded: [glob] }.
// Evidence that a step exists in the product: an endpoint in <pm>/state/inventory.json (if present), otherwise a file path in the repo.
// Retention is measured from cohorts, not events; not looked for here.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { readSources } from "./sources-file.mjs";

// Turkish-language support (see skill/data/lang/tr/scan-metrics.json): a product's event names and routes may
// be in Turkish. Kept as data and merged into the patterns below at runtime, since this is a language feature
// of the product Nosy analyzes, not Nosy's own language.
const TrWords = JSON.parse(fs.readFileSync(new URL("../data/lang/tr/scan-metrics.json", import.meta.url), "utf8"));

const Source = /\.((m|c)?[jt]sx?|py|go|rb|php|java|kt|swift|dart|cs|rs|vue|svelte|ex|exs)$/i;
const withTest = f => /(^|\/)(tests?|__tests__|testdata|fixtures?|e2e|cypress|playwright|mocks?)\//i.test(f) || /\.(test|spec|stories|story)\.[a-z]+$/i.test(f) || /_test\.go$/.test(f) || /(^|\/)test_[^/]+\.py$/.test(f);
const noise = f => /(^|\/)(node_modules|dist|build|vendor|\.next|coverage)\//.test(f) || /\.(min\.js|map|d\.ts)$/i.test(f);
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Analytics calls. git grep -E (POSIX ERE) doesn't recognize \b or \s everywhere: pick loosely with ERE, tighten in JS.
const CALL_ERE = "capture|track|logevent|trackevent|gtag|plausible|umami|fathom|analytics";
const Call = /\.(capture|track|logEvent|trackEvent|record)\s*\(|\bgtag\s*\(\s*["']event["']|\bplausible\s*\(|\bumami\.track\s*\(|\bfathom\.trackEvent\s*\(|(^|[^.\w])(logEvent|trackEvent|track|capture)\s*\(\s*["'`\w]|analytics\.Track\s*\{/;
const Tools = [["PostHog", /posthog/i], ["Segment", /segment|analytics-node|@segment/i], ["Mixpanel", /mixpanel/i], ["Amplitude", /amplitude/i],
  ["Firebase/GA", /firebase|gtag|google-analytics|logEvent/i], ["Plausible", /plausible/i], ["Umami", /umami/i], ["Fathom", /fathom/i], ["RudderStack", /rudder/i], ["Heap", /\bheap\b/i]];

// Match a full path segment in a file/endpoint path: "register" shouldn't catch `serviceWorkerRegistration.js`.
// What follows must only be "/", "." or the end: `register_push_token` isn't a signup.
const part = w => new RegExp(`(^|[\\/_.\\-])(${w})([-_]?(page|form|screen|view|modal|flow|route|controller|handler|service|s))?(?=[\\/.]|$)`, "i");
// Paths the team sees, not the customer (admin panel, internal endpoints, webhooks, scheduled jobs) don't count as a product step.
const Team = /(^|[\/(])(admin|staff|internal|webhooks?|ops|backoffice|cron|worker|jobs)([\/)]|-frontend|$)/i;
// AARRR steps. `event`: matches the event name or the event constant's name; `product`: looks at the endpoint path or file path.
//
// Product-sourced metrics glossary (internal request 107, the language audit §1 "scan-metrics.mjs:28-40
// Steps"): a product whose routes/events are named in a third language (not English/Turkish) was invisible
// to every step check - "no trace" reported for steps that actually exist. Structural signals (the Call
// regex that finds an analytics SDK call at all - .capture(/.track(/logEvent(/gtag(.../etc - and the Tools/
// Package lists of SDK names) are code shape, already language-independent, untouched here. Only the
// MAPPING of an event/route NAME to an AARRR step is language-dependent, same shape as read-decisions.mjs's
// glossary.notDoing/glossary.measurement and read-design.mjs's glossary.design
//: sources.json's `glossary.metrics` stays a FLAT array of strings, like those -
// K.glossary is read generically (as a plain {word: [translations]} map) by half a dozen other tools
// (gather-evidence/canwe/build-waves/collect-signals/ledger/measure-size), and validated that way by
// verify-setup.mjs; a nested object here would make every one of those throw on `for (const en of ens)`.
// Each entry is "<field>:<word>" where field is one of signup/activation/revenue/referral/churn (the
// familiar AARRR names move-in.md's glossary example uses - see STEP_GLOSSARY_KEY below for the mapping to
// this module's internal step ids record/activation/revenue/invite/cancel); an entry with no recognized
// field prefix is ignored (there's no document-wide gate to feed here, unlike glossary.design's `_general`).
export const STEP_GLOSSARY_KEY = { record: "signup", activation: "activation", revenue: "revenue", invite: "referral", cancel: "churn" };
const METRICS_FIELDS = new Set(Object.values(STEP_GLOSSARY_KEY));
const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Parses sources.json's flat `glossary.metrics` array into { signup: [...], activation: [...], ... }.
export function metricsGlossaryMap(list) {
  const map = {};
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const m = raw.match(/^(\w+):(.+)$/);
    if (!m || !METRICS_FIELDS.has(m[1])) continue;
    (map[m[1]] ??= []).push(m[2].trim());
  }
  return map;
}
function glossaryWords(glossaryMap, id) {
  const key = STEP_GLOSSARY_KEY[id];
  return (glossaryMap[key] || []).map(escRe);
}
// `part2` is "event" or "product" - not every step id has a TR word list for both (e.g. activation has no
// TR "event" words, its English regex is already broad); the product glossary applies to both regardless.
const wordsFor = (id, part2, glossaryMap) => [...((TrWords[id] && TrWords[id][part2]) || []), ...glossaryWords(glossaryMap, id)];
const joinWords = (base, id, part2, glossaryMap) => [base, ...wordsFor(id, part2, glossaryMap)].join("|");
const evRe = (base, id, glossaryMap) => new RegExp(joinWords(base, id, "event", glossaryMap), "i");

// `buildSteps(glossaryList)`: builds the Steps array, optionally extended with sources.json's raw
// `glossary.metrics` array (used by works() below, per-product). `Steps` (no glossary) keeps the exact
// EN+TR-only behavior every existing caller/test already relies on.
export function buildSteps(glossaryList = null) {
  const glossaryMap = metricsGlossaryMap(glossaryList);
  return [
    { id: "record", name: "Acquisition", event: evRe("sign(ed|s|ing)?.?up|regist|account.?creat|user.?creat|created.?account|\\bjoin", "record", glossaryMap), product: part(joinWords("sign-?up|signup|register", "record", "product", glossaryMap)), value: 2 },
    { id: "activation", name: "Activation", event: new RegExp(joinWords("onboard|activat|first.?[a-z]|setup.?(complet|done|finish)|tutorial.?(complet|done)|welcome.?(complet|done)", "activation", "event", glossaryMap), "i"), product: part(joinWords("onboarding|onboard|getting-?started|welcome", "activation", "product", glossaryMap)), value: 3 },
    { id: "revenue", name: "Revenue", event: evRe("checkout|purchas|(?<!un)subscri|payment|paid|upgrad|order.?(complet|placed)", "revenue", glossaryMap), product: part(joinWords("checkout|subscribe|subscription|billing|payments?|paywall", "revenue", "product", glossaryMap)), value: 3 },
    { id: "invite", name: "Referral", event: evRe("invit|referr|shar", "invite", glossaryMap), product: part(joinWords("invite|invites|invitation|referral|referrals", "invite", "product", glossaryMap)), value: 2 },
    // Churn: subscription/account context only; "cancel" alone (cancelling an upload, a sync) is not customer churn.
    { id: "cancel", name: "Churn", event: evRe("(cancel|end|stop).?(subscri|plan|trial|account|membership)|churn|unsubscri|downgrad|(delete|close).?account", "cancel", glossaryMap), product: part(joinWords("cancel-?(subscription|plan|membership|account)|cancellation|unsubscribe|downgrade|(delete|close)-?account", "cancel", "product", glossaryMap)), value: 2 },
  ];
}
export const Steps = buildSteps(null);

// Extract the event name from the call line (and the next two lines): first string, `event: "x"`, gtag's second string, or the constant name.
export function eventNameOf(text) {
  const t = text.replace(/\s+/g, " ");
  let m = t.match(/gtag\s*\(\s*["']event["']\s*,\s*["'`]([^"'`]+)["'`]/); if (m) return m[1];
  m = t.match(/\bevent\s*[:=]\s*["'`]([^"'`]+)["'`]/i); if (m) return m[1];
  m = t.match(/(?:capture|track|logEvent|trackEvent|record|plausible|umami\.track|fathom\.trackEvent)\s*\(\s*(?:[\w.]+\s*,\s*)?["'`]([^"'`]+)["'`]/); if (m) return m[1];
  m = t.match(/(?:capture|track|logEvent|trackEvent|record)\s*\(\s*(?:\{\s*event\s*:\s*)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)/); if (m) return m[1];
  return null;
}

function works(pm) {
  const K = readSources(pm);
  const O = K.metrics || {};
  const tryGit = (...a) => { try { return execFileSync("git", ["-C", K.repo, ...a], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
  const excluded = (O.excluded || []).map(g => new RegExp("^" + g.split("**").map(p => p.split("*").map(esc).join("[^/]*")).join(".*") + "$"));
  const exclude = f => !Source.test(f) || withTest(f) || noise(f) || excluded.some(r => r.test(f));
  const extraCall = O.call ? new RegExp(O.call, "i") : null;

  // -A2: the call opening and the event name are often on separate lines (posthog.capture(\n  "signed_up", …)).
  const raw = tryGit("grep", "-n", "-I", "-i", "-A2", "-E", O.call ? `${CALL_ERE}|${O.call}` : CALL_ERE, K.ref);
  const lines = [];
  for (const l of raw.split("\n")) {
    if (!l || l === "--") continue;
    const m = l.match(/^[^:]+:([^:]+?)([:-])(\d+)[:-](.*)$/); if (!m) continue;
    lines.push({ file: m[1], matched: m[2] === ":", line: +m[3], text: m[4] });
  }
  const events = [], tools = new Set();
  lines.forEach((s, i) => {
    if (!s.matched || exclude(s.file) || /^\s*(\/\/|#|\*)/.test(s.text)) return;
    if (!Call.test(s.text) && !(extraCall && extraCall.test(s.text))) return;
    const window = [s, ...lines.slice(i + 1, i + 3).filter(n => n.file === s.file && n.line <= s.line + 2)].map(n => n.text).join(" ");
    const name = eventNameOf(window); if (!name || name.length > 80) return;
    const tool = Tools.find(([, re]) => re.test(window) || re.test(s.file))?.[0] || "own wrapper";
    tools.add(tool);
    events.push({ name, file: s.file, line: s.line, tool });
  });
  // Also reported when a tool is in the dependency list but never called ("installed, unused"). Analytics PACKAGE
  // names only: "firebase" alone can be push notifications (FCM), "segment" is an ordinary word (both gave false
  // "installed" positives in the first product).
  const Package = [["PostHog", /["'](posthog-js|posthog-node|posthog-react-native|posthog)["']|posthog/i], ["Segment", /@segment\/analytics|analytics-node|analytics-react-native/i],
    ["Mixpanel", /["']mixpanel(-browser|-react-native)?["']|mixpanel/i], ["Amplitude", /@amplitude\/|amplitude-js/i], ["Firebase Analytics", /firebase\/analytics|@react-native-firebase\/analytics|firebase_analytics/i],
    ["Google Analytics", /react-ga4?|["']ga-4|@next\/third-parties|gtag/i], ["Plausible", /plausible-tracker|next-plausible/i], ["Umami", /umami/i], ["Fathom", /fathom-client/i], ["RudderStack", /@rudderstack\//i], ["Heap", /["']heap(-api)?["']|@heap\//i]];
  const allFiles = tryGit("ls-tree", "-r", "--name-only", K.ref).split("\n").filter(Boolean);
  const packages = allFiles.filter(p => /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|go\.mod|Gemfile|pubspec\.yaml|Podfile)$/.test(p) && !/node_modules/.test(p))
    .slice(0, 20).map(f => tryGit("show", `${K.ref}:${f}`)).join("\n");
  const installed = Package.filter(([, re]) => re.test(packages)).map(([name]) => name);

  // Evidence that the step exists in the product.
  const envPath = path.join(pm, "state", "inventory.json");
  const endpoints = fs.existsSync(envPath) ? (() => { try { return JSON.parse(fs.readFileSync(envPath, "utf8")).endpoints || []; } catch { return []; } })() : [];
  const files = allFiles.filter(f => !exclude(f));
  const productEvidenceOf = re => {
    const u = endpoints.find(e => !e.infrastructure && re.test(e.path || "") && !Team.test(e.path || "") && !Team.test(e.file || "")); if (u) return `${u.method} ${u.path} — ${u.file}:${u.line}`;
    const f = files.find(d => re.test(d) && !Team.test(d)); return f || null;
  };
  const eventMatch = re => [...new Set(events.filter(o => re.test(o.name)).map(o => o.name))];

  // Product-sourced metrics glossary + language: sources.json's `language` (BCP-47,
  // same field text.mjs's langOfLoad reads) and `glossary.metrics` - see buildSteps()'s comment above. When
  // the product's language is en/tr (or unset, Nosy's original assumption), the EN+TR core alone is treated
  // as confident, same as before this fix - byte-identical output for every existing caller/test. For any
  // other language, a step is only "confidently" readable once sources.json gives it glossary words.
  const glossaryList = K.glossary?.metrics || null;
  const glossaryMap = metricsGlossaryMap(glossaryList);
  const lang = typeof K.language === "string" && K.language.trim() ? K.language.trim().toLowerCase() : null;
  const languageKnown = !lang || lang === "en" || lang === "tr";
  const StepsForProduct = buildSteps(glossaryList);
  const steps = StepsForProduct.map(A => {
    const inProduct = productEvidenceOf(A.product), matching = eventMatch(A.event);
    const example = matching.length ? events.find(o => o.name === matching[0]) : null;
    let status = !inProduct ? "in_product_missing" : matching.length ? "measured" : "notMeasured";
    const out = { id: A.id, name: A.name, value: A.value, inProduct, events: matching.slice(0, 5), evidence: example ? `${example.file}:${example.line}` : null, status };
    // Never silent (the language audit, "say so instead of going silent"): a step that reads as missing
    // or unmeasured in a language Nosy has no confident coverage for (not en/tr, and no glossary.metrics
    // entry for THIS step) is not the same claim as "genuinely not measured" - the product's own events may
    // simply be named in a language this script doesn't recognize yet. Only fires when there's something to
    // point the agent at (events exist SOMEWHERE in the code); an empty product (events.length === 0
    // overall) is already covered by the top-of-report "No product event found" message.
    const glossKey = STEP_GLOSSARY_KEY[A.id];
    const hasGlossary = Array.isArray(glossaryMap[glossKey]) && glossaryMap[glossKey].length > 0;
    const confident = languageKnown || hasGlossary;
    if (!confident && status !== "measured" && events.length) {
      out.status = "unknown";
      out.note = `${events.length} event${events.length === 1 ? "" : "s"} found, none mapped to a step in ${lang} — agent, map them`;
      out.candidateEvents = events.slice(0, 5).map(e => ({ name: e.name, file: e.file, line: e.line }));
    }
    return out;
  });
  let northStar = { defined: false };
  if (O.northStar?.pattern) {
    const e = eventMatch(new RegExp(O.northStar.pattern, "i")), example = e.length ? events.find(o => o.name === e[0]) : null;
    northStar = { defined: true, name: O.northStar.name || O.northStar.pattern, measured: e.length > 0, events: e.slice(0, 5), evidence: example ? `${example.file}:${example.line}` : null };
  }
  return { type: "metrics", generated: new Date().toISOString(), ref: K.ref, language: lang, tools: [...tools], installed, event_count: new Set(events.map(o => o.name)).size,
    events: events.slice(0, 300), steps, northStar, unmeasured: steps.filter(a => a.status === "notMeasured").length };
}

function formatMd(R) {
  let o = `# Metrics${R.ref ? ` · ${R.ref}` : ""}\n\n`;
  o += R.event_count ? `${R.event_count} distinct product events (${R.tools.join(", ")}).` : `No product event found in the code${R.installed.length ? ` (installed in dependencies: ${R.installed.join(", ")}; installed but not called)` : ""}.`;
  o += ` ${R.unmeasured} key steps exist in the product but don't fire an event.\n\n`;
  o += R.northStar.defined ? `**North Star (${R.northStar.name}):** ${R.northStar.measured ? `measured — ${R.northStar.events.join(", ")} (${R.northStar.evidence})` : "**no event in the code feeds this metric.**"}\n\n`
    : "**No North Star defined.** Adding `metrics.northStar: { name, pattern }` to `sources.json` will also search for the event that feeds this metric (ask the owner: which single number best shows the value the product gives customers?).\n\n";
  o += "| Step | In product | Event | Status |\n|---|---|---|---|\n";
  const STATUS_LABEL = { measured: "measured", notMeasured: "**not measured**", in_product_missing: "not in product", unknown: "**? — agent, check**" };
  for (const a of R.steps) o += `| ${a.name} | ${a.inProduct ? a.inProduct.replace(/\|/g, "/").slice(0, 70) : "—"} | ${a.events.join(", ") || "—"}${a.evidence ? ` (${a.evidence})` : ""} | ${STATUS_LABEL[a.status]} |\n`;
  const unknownSteps = R.steps.filter(a => a.status === "unknown");
  if (unknownSteps.length) o += "\n" + unknownSteps.map(a => `**${a.name}:** ${a.note} (${(a.candidateEvents || []).map(e => `\`${e.name}\` ${e.file}:${e.line}`).join(", ")}).`).join("\n") + "\n";
  o += "\nRetention (D1/D7/D30) is measured from cohorts, not events; not searched for here.\n";
  return o;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), ji = argv.indexOf("--json"), jsonOut = ji >= 0 ? argv.splice(ji, 2)[1] : null;
  const R = works(argv[0] || "pm");
  process.stdout.write(formatMd(R));
  if (jsonOut) fs.writeFileSync((fs.mkdirSync(path.dirname(jsonOut), { recursive: true }), jsonOut), JSON.stringify(R, null, 1));
}

export { works as compute };
