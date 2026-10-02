// Low-hanging-fruit finder: lists cheap, valuable work with its evidence.
// Usage: node lowhanging.mjs <pm folder> [--json <file>]   (reads pm/sources.json)
// Signals: (1) backend field not used on screen, (2) "exists" but has no screen,
// (3) item whose status may be stale, (4) matrix says "backend ready" / common among rivals,
// (5) issue opened against us, (6) inventory has an endpoint but no screen (if state/inventory.json exists),
// (7) shipped but not tied to any plan (if state/plan-gates.json exists), (8) a key step isn't measured (if state/metrics.json exists).
// Deterministic; the agent does the interpretation.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { matrixRead } from "./read-matrix.mjs"; import { thresholds } from "./thresholds.mjs";
import { demandLoad, demandFor, demandLine, trendWord, isCluster, windowText } from "./demand.mjs";
import { advice } from "./hints.mjs";
import { readSources, teamLogins, isTeamLogin } from "./sources-file.mjs";
const argv = process.argv.slice(2), ji = argv.indexOf("--json"), jsonOut = ji >= 0 ? argv.splice(ji, 2)[1] : null;
const pm = argv[0] || "pm";
const K = readSources(pm);
const ES = thresholds(K); // the optional `thresholds` object in sources.json, falls back to defaults otherwise
const git = (...a) => execFileSync("git", ["-C", K.repo, ...a], { encoding: "utf8", maxBuffer: 64 << 20 });
const show = f => { try { return git("show", `${K.ref}:${f}`); } catch { return ""; } };
const items = [];
let supersededNote = null; // set by signal (6) below if inventory.json has superseded endpoints
// References that appear in our open PRs: these count as "in progress".
const inPr = new Map();
if (K.issue) { try {
  const prs = JSON.parse(execFileSync("gh", ["pr", "list", "-R", K.issue.repo, "--state", "open", "--author", "@me", "--json", "number,title,body"], { encoding: "utf8" }));
  for (const p of prs) for (const r of new Set(((p.title + " " + p.body).match(/§\d+[a-z]?|#\d+|K\d{2,3}/g) || []))) inPr.set(r, p.number);
} catch {} }
const prNote = ref => inPr.has(ref) ? ` (in #${inPr.get(ref)})` : "";
// Any OTHER open PR (not only ours) that closes or names an item: someone is already doing it, so it is not "cheap work to ship".
// A real run on a public repo ranked requests that already had an open PR among the cheap work. Linked by GitHub's own
// closing-issue references and by "closes/fixes/resolves #N" in the PR body, or a #N in its title.
const openPr = new Map();
if (K.issue) { try {
  let prs;
  const list = fields => JSON.parse(execFileSync("gh", ["pr", "list", "-R", K.issue.repo, "--state", "open", "--limit", "100", "--json", fields], { encoding: "utf8", maxBuffer: 64 << 20 }));
  try { prs = list("number,title,body,closingIssuesReferences"); } catch { prs = list("number,title,body"); }
  const closing = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)/gi;
  for (const p of prs) {
    const linked = new Set((p.closingIssuesReferences || []).map(r => r?.number).filter(Boolean));
    for (const m of String(p.body || "").matchAll(closing)) linked.add(+m[1]);
    for (const m of String(p.title || "").matchAll(/#(\d+)/g)) linked.add(+m[1]);
    linked.delete(p.number);
    for (const n of linked) if (!openPr.has(`#${n}`)) openPr.set(`#${n}`, p.number);
  }
} catch {} }
const add = (o) => { const r = (o.ref || "");
  if (r && inPr.has(r)) { o.title += prNote(r); o.value = Math.max(1, (o.value ?? 2) - 2); o.type += " · in PR"; }
  else if (r && openPr.has(r)) { o.type += ` · a PR is already open (#${openPr.get(r)})`; o.value = 0; o.openPr = openPr.get(r); (o.detail ||= []).unshift(`A PR is already open (#${openPr.get(r)}): not cheap work to ship, review or unblock that one instead.`); }
  items.push({ value: 2, effort: 1, ...o }); };
const Effort = { 1: "S", 2: "M", 3: "L" };

// (1) Backend fields not used on screen
if (K.dropped) {
  const out = (() => { try { return git("grep", "-n", K.dropped.pattern, K.ref, "--", K.dropped.path); } catch { return ""; } })();
  const opportunity = new RegExp(K.dropped.opportunity, "i");
  const groups = new Map();
  for (const line of out.split("\n").filter(Boolean)) {
    const m = line.match(/^[^:]+:([^:]+):(\d+):(.*)$/); if (!m) continue;
    const [, file, no, text] = m; if (!opportunity.test(text)) continue;
    if (K.dropped.knowingly && new RegExp(K.dropped.knowingly, "i").test(text)) continue;
    const ref = (text.match(/§\d+[a-z]?|K\d{2,3}|#\d+/) || ["(no ref)"])[0];
    const key = `${ref} ${path.dirname(path.dirname(file)).split("/").pop()}`;
    if (!groups.has(key)) groups.set(key, { ref, file, lines: [] });
    groups.get(key).lines.push(`${no}: ${text.replace(/^\s*\/\/\s*dropped:\s*/, "").slice(0, 140)}`);
  }
  for (const [key, g] of groups) add({ ref: g.ref === "(no ref)" ? null : g.ref, type: "Backend ready, not on screen", title: `${key} · ${g.lines.length} fields`, evidence: `${g.file}:${g.lines[0].split(":")[0]}`, detail: g.lines.slice(0, 3), value: 3, effort: g.lines.length > 4 ? 2 : 1 });
}

// (2)(3) Request document
if (K.request) {
  const doc = show(K.request.path), hRe = new RegExp(K.request.title, "gm"), sRe = new RegExp(K.request.state);
  const secs = []; let m;
  while ((m = hRe.exec(doc))) secs.push({ no: m[1], name: m[2], at: m.index });
  secs.forEach((s, i) => { s.body = doc.slice(s.at, secs[i + 1]?.at ?? doc.length); s.state = (s.body.match(sRe) || [, "?"])[1]; s.date = (s.body.match(/(?:checked|measured|updated)\s+(\d{1,2}\s+Sep)/i) || [, ""])[1]; });
  const since = K.request.last_day || 14;
  const recent = git("log", "--no-merges", `--since=${since}.days`, "--format=%h %s", K.ref).split("\n").filter(l => !/^\w+ docs\(/.test(l) || /done|served|exists|on main/i.test(l)).join("\n");
  for (const s of secs) {
    if (!/^\d+$/.test(s.no)) continue;
    const noUi = new RegExp(K.request.screen_missing || "not built yet|UI:\\s*not|no screen", "i");
    const uiLines = s.body.split("\n").filter(l => /\*\*UI\b/.test(l)); const lastUi = uiLines[uiLines.length - 1] || "";
    if (s.state === "exists" && noUi.test(s.body) && !/\b(built|done|wired|drawn)\b/i.test(lastUi))
      add({ ref: `§${s.no}`, type: "Served, no screen", title: `§${s.no} ${s.name}`, evidence: `${K.request.path} §${s.no}`, detail: [(s.body.match(noUi.source.split("|")[0] ? new RegExp(`[^.]*(${noUi.source})[^.]*\\.`, "i") : /$^/) || [""])[0].trim().slice(0, 200)], value: 3, effort: 2 });
    if (s.state !== "exists") {
      const krefs = [...new Set((s.body.match(/K\d{2,3}(?:\s*m\.\d+)?/g) || []))];
      const hits = recent.split("\n").filter(l => l.includes(`§${s.no} `) || l.includes(`§${s.no})`) || l.includes(`§${s.no},`) || krefs.some(k => /m\./.test(k) && l.replace(/\s+/g," ").includes(k.replace(/\s+/g," "))));
      if (s.date && hits.length) add({ ref: `§${s.no}`, type: "Status may be stale", title: `§${s.no} ${s.name} · "${s.state}" (${s.date})`, evidence: hits.slice(0, 2).map(h => h.slice(0, 90)).join(" · "), detail: krefs.length ? [`Decisions mentioned in the text: ${krefs.join(", ")}`] : [], value: 2, effort: 1 });
    }
  }
}

// (4) Matrix
// read-matrix.mjs reads both formats; an acquired/closed rival doesn't count as "common".
const MO = K.matrix ? matrixRead(K.matrix, { codes: K.matrixCodes }) : null;
if (MO) {
  const us = MO.biz;
  // "Common" threshold scales with rival count: 3 (old constant) at 5+ active rivals, at least 2 and half of them for a product with fewer rivals.
  const active = MO.products.filter(u => u !== us && !MO.oh.has(u)).length, commonThreshold = Math.min(ES.common, Math.max(2, Math.ceil(active / 2)));
  for (const r of MO.lines) {
    const c = r.codes[us]; if (r.decision === "notDoing") continue;
    // Only "y" (shipped) counts; "d" (announced, not shipped) doesn't add to commonality, only gets mentioned in the detail.
    const yRivals = Object.entries(r.codes).filter(([p, v]) => p !== us && v === "y" && !MO.oh.has(p)).map(([p]) => p);
    const dRivals = Object.entries(r.codes).filter(([p, v]) => p !== us && v === "d" && !MO.oh.has(p)).map(([p]) => p);
    const dNot = dRivals.length ? [`Announced, not shipped yet: ${dRivals.join(", ")}`] : [];
    // the first reference in the note is written to output as ref (so consumers don't have to repeat the regex);
    // add() still looks up the same ref in the open-PR list (inPr) and applies the "in PR" bump.
    const ref = (r.not.match(/§\d+[a-z]?|K\d{2,3}|#\d+/) || [])[0] || null;
    if (c === "b") add({ ref, type: "Matrix: backend ready", title: r.feature, evidence: r.not, detail: [...(yRivals.length ? [`Present in rivals: ${yRivals.join(", ")}`] : []), ...dNot], value: 2 + (yRivals.length > 0), effort: 2 });
    else if ((c === "s" || c === "p") && yRivals.length >= commonThreshold) add({ ref, type: "Common among rivals, partial for us", title: r.feature, evidence: r.not, detail: [`Present in ${yRivals.length} rivals: ${yRivals.join(", ")}`, ...dNot], value: 2, effort: 3 });
  }
}

// (5) Issues opened against us
// a security or bug report reads like code review, not a product opportunity —
// psst doesn't triage code. Detected structurally, never from words in the title/body: GitHub issue labels
// (product-defined via sources.json's issue.labels.security / issue.labels.bug, defaults below cover common
// English label names and are overridable), a CVE/GHSA id anywhere in the body, or the issue type field when
// gh returns one. These never enter the ranking; they're counted and surfaced as a single line instead.
const defaultSecurityLabels = ["security", "vulnerability", "cve"];
const defaultBugLabels = ["bug"];
const securityLabels = new Set((K.issue?.labels?.security || defaultSecurityLabels).map(s => String(s).toLowerCase()));
const bugLabels = new Set((K.issue?.labels?.bug || defaultBugLabels).map(s => String(s).toLowerCase()));
const cveRe = /\bCVE-\d{4}-\d+\b|\bGHSA-[a-z0-9]{4,}(?:-[a-z0-9]{4,}){0,3}\b/i;
let riskNote = null, teamNote = null;
if (K.issue) {
  try {
    let js;
    try {
      js = JSON.parse(execFileSync("gh", ["issue", "list", "-R", K.issue.repo, "--state", "open", "--limit", "60", "--json", "number,title,author,updatedAt,body,labels,issueType"], { encoding: "utf8" }));
    } catch {
      // Older gh / repos without issue types: retry without the field rather than failing the whole signal.
      js = JSON.parse(execFileSync("gh", ["issue", "list", "-R", K.issue.repo, "--state", "open", "--limit", "60", "--json", "number,title,author,updatedAt,body,labels"], { encoding: "utf8" }));
    }
    // `team` in sources.json (same rule as collect-signals.mjs): an issue one of your own people opened is a work item, not
    // a request from outside. It is left out of "issue opened against us" (and the risk count), and said once so the omission is visible.
    const team = teamLogins(K), mine = js.filter(i => isTeamLogin(team, i.author?.login));
    if (mine.length) teamNote = `${mine.length} open issue${mine.length === 1 ? "" : "s"} opened by your own team (sources.json \`team\`) ${mine.length === 1 ? "is" : "are"} left out: ${mine.length === 1 ? "it is a work item" : "they are work items"}, not a request from outside (${mine.slice(0, 8).map(i => `#${i.number}`).join(", ")}${mine.length > 8 ? ", …" : ""}).`;
    const ours = js.filter(i => !isTeamLogin(team, i.author?.login) && new RegExp(K.issue.our || "", "i").test(i.title));
    let securityN = 0, bugN = 0; const riskRefs = [];
    for (const i of ours) {
      const labelNames = (i.labels || []).map(l => String(l?.name ?? l).toLowerCase());
      const typeName = i.issueType ? String(i.issueType?.name ?? i.issueType).toLowerCase() : null;
      const isSecurity = labelNames.some(l => securityLabels.has(l)) || (typeName && securityLabels.has(typeName)) || cveRe.test(i.body || "");
      const isBug = !isSecurity && (labelNames.some(l => bugLabels.has(l)) || (typeName && bugLabels.has(typeName)));
      if (isSecurity || isBug) {
        if (isSecurity) securityN++; else bugN++;
        riskRefs.push(`#${i.number}`);
        continue;
      }
      const item = ((i.body || "").match(/^\s*(?:\d+\.|-|\*\*m\.\d)/gm) || []).length;
      add({ ref: `#${i.number}`, type: "Issue opened against us", title: `#${i.number} ${i.title}`, evidence: `${i.author?.login || "unknown"} · ${String(i.updatedAt || "").slice(0, 10)}`, detail: [`${item} items`], value: 2, effort: item > 6 ? 3 : item > 2 ? 2 : 1 });
    }
    const riskTotal = securityN + bugN;
    if (riskTotal) riskNote = `Reported risks, not ranked: ${riskTotal} (security ${securityN}, bugs ${bugN}) — Nosy doesn't triage code; see ${riskRefs.join(", ")}.`;
  } catch (e) { items.push({ type: "Warning", title: "gh could not be read", evidence: (advice(`${e.message}\n${e.stderr || ""}`) || "gh failed: is it signed in? `gh auth status` (sign in with `gh auth login`), and check `issue.repo` in pm/sources.json").slice(0, 220), value: 0, effort: 3 }); }
}

// (6) From inventory: endpoint exists, no screen (inventory.mjs; internal request 26). If inventory hasn't run
// (no state/inventory.json), the signal is skipped — the script doesn't slow down or error because of it.
// a structurally `superseded` endpoint (deprecated tag/410/redirect) isn't a real gap —
// excluded here too, and separately surfaced below as a "Superseded (not counted)" note (not a scored item, just
// context so an agent reading the list understands why a count dropped since the last run). An endpoint with an
// in-repo `callers` entry (a non-screen client — extension, release tool) also isn't "nobody calls this", so it's
// excluded from the count as well; its title keeps the caller name so the agent can tell it apart from a real gap.
const envPath = path.join(pm, "state", "inventory.json");
if (fs.existsSync(envPath)) { try {
  const EN = JSON.parse(fs.readFileSync(envPath, "utf8"));
  const groupsValue = new Map();
  for (const e of (EN.endpoints || []).filter(e => !e.used && !e.infrastructure && !e.superseded && !(e.callers && e.callers.length) && e.confidence !== "shouldLookAt")) { if (!groupsValue.has(e.area)) groupsValue.set(e.area, []); groupsValue.get(e.area).push(e); }
  for (const [area, es] of groupsValue) {
    const n = es.length;
    add({ type: "Endpoint exists, no screen", title: `${area} · ${n} endpoints`, evidence: `${es[0].file}:${es[0].line}`, detail: es.slice(0, 5).map(e => `${e.method} ${e.path}${e.possiblySuperseded ? " (possibly superseded — check)" : ""}`), value: n > 1 ? 3 : 2, effort: n <= 2 ? 1 : n <= 6 ? 2 : 3 });
  }
  const supersededN = (EN.endpoints || []).filter(e => e.superseded).length;
  if (supersededN) supersededNote = `Superseded (not counted): ${supersededN} endpoint${supersededN === 1 ? "" : "s"} had a structural deprecation signal (OpenAPI \`deprecated: true\`, a \`@deprecated\`/\`Deprecated:\` tag, or a handler that only returns 410/redirects) — dropped from the count above.`;
} catch {} }

// (7) Plan gate (plan-gates.mjs; internal request 58): feature fields shipped in the last N days but not behind any plan gate.
// A product without a billing trace already produces no signal here ("no pricing" may be a decision).
const gatePath = path.join(pm, "state", "plan-gates.json");
if (fs.existsSync(gatePath)) { try {
  const PK = JSON.parse(fs.readFileSync(gatePath, "utf8"));
  if (!PK.billing_missing) {
    if (!PK.gate_count && !(PK.plan_files_of || []).length) add({ type: "Billing exists, no plan gate", title: `No feature in the code is tied to a plan`, evidence: (PK.billing || []).slice(0, 2).join(", "), detail: ["If everyone gets everything, there's no packaging; if that's intentional, flag it with `learn knowingly`."], value: 3, effort: 2 });
    // The 8 fields with the most shipped features become items; the rest get one summary line (so a big product's list doesn't drown Psst out).
    else { const gateless = (PK.fields || []).filter(a => !a.gated && !a.infrastructure && !a.noScreen && !a.app).sort((x, y) => y.commit_count - x.commit_count);
    // these are questions for the owner ("which plan is this in?"), not work to ship. On Twenty nine
    // of them crowded the list; three, ranked as questions (value 1), is enough to raise the point.
    if (gateless.length > 3) add({ type: "Shipped, not tied to any plan", title: `and ${gateless.length - 3} more fields (plan-gates.json)`, evidence: gateless.slice(3, 9).map(a => a.area).join(", "), detail: [], value: 1, effort: 2 });
    for (const a of gateless.slice(0, 3)) add({ type: "Shipped, not tied to any plan", title: `${a.area} · ${a.commit_count} features in the last ${PK.day} days`, evidence: `${a.commits[0].h} ${a.commits[0].title}`, detail: [...a.commits.slice(0, 3).map(c => `${c.date} ${c.h} ${c.title}`), `Plan gate example: ${(PK.gate_example || PK.plan_files_of || [])[0] || "—"}`], value: 1, effort: 1 }); }
  }
} catch {} }

// (10) The team's own next list (team-next.mjs; internal request 128): what the team's working notes say is next.
// In blind test v7 these predicted what shipped better than any computed signal. Receipts and the refuter still check
// each one (already done? cheap?), so it ranks as high as "backend ready", first among equals. A note carries no size:
// ranked as M, shown as "?" until psst or the refuter sizes it ("the CRM trial" came out as S).
const nextPath = path.join(pm, "state", "team-next.json");
if (fs.existsSync(nextPath)) { try {
  const TN = JSON.parse(fs.readFileSync(nextPath, "utf8"));
  for (const i of (TN.items || []).slice(0, 8)) add({ ref: i.refs?.[0] || null, type: "On the team's next list", title: i.title, evidence: `${i.file}:${i.line}`, detail: [`${i.date}${i.refs?.length ? ` · ${i.refs.join(", ")}` : ""}`, ...(i.cited || []).slice(0, 3)], value: 3, effort: 2, sizeUnknown: true });
} catch {} }

// (9) Screen built, waiting for the backend (pending-backend.mjs; internal request 113): psst's other direction. The
// UI and copy are done; the backend work alone ships it. Screens that name the same request (§28) are one item.
const pendingPath = path.join(pm, "state", "pending.json");
if (fs.existsSync(pendingPath)) { try {
  const PB = JSON.parse(fs.readFileSync(pendingPath, "utf8")), P = PB.items || [];
  const byRef = new Map();
  for (const i of P.filter(i => i.kind === "marker")) { const k = i.ref || `${i.evidence}`; byRef.set(k, [...(byRef.get(k) || []), i]); }
  for (const [k, is] of byRef) add({ ref: is[0].ref, type: "Screen built, waiting for backend",
    title: `${is[0].ref ? `${is[0].ref} · ` : ""}${is.map(i => i.title).slice(0, 3).join(" · ")}${is.length > 3 ? ` +${is.length - 3}` : ""}`,
    evidence: is[0].evidence, detail: is.flatMap(i => [`${i.evidence}${i.detail.length ? ` — ${i.detail.join(" · ")}` : ""}`]).slice(0, 4),
    // The mirror of "backend ready" (effort 1 there): half the work is done. A screen that names a request item is asked for: value 3.
    value: is[0].ref ? 3 : 2, effort: 1 });
  const calls = new Map(); for (const i of P.filter(i => i.kind === "call")) calls.set(i.area, [...(calls.get(i.area) || []), i]);
  for (const [area, is] of calls) add({ type: "Screen calls a missing endpoint", title: `${area} · ${is.length} call${is.length === 1 ? "" : "s"} with no backend route`, evidence: is[0].evidence, detail: is.slice(0, 4).map(i => `${i.title} · ${i.evidence}`), value: 2, effort: is.length > 3 ? 3 : 2 });
  for (const i of P.filter(i => i.kind === "mock")) add({ type: "Screen on mock data", title: i.title, evidence: i.evidence, detail: i.detail, value: 2, effort: 2 });
} catch {} }

// (8) Metrics (scan-metrics.mjs; internal request 59): a key step the product has (AARRR) or the North Star isn't firing an analytics event.
const metricsPath = path.join(pm, "state", "metrics.json");
if (fs.existsSync(metricsPath)) { try {
  const Be = JSON.parse(fs.readFileSync(metricsPath, "utf8"));
  const missing = (Be.steps || []).filter(a => a.status === "notMeasured");
  if (!Be.event_count && (Be.steps || []).some(a => a.inProduct)) add({ type: "Product not measured", title: `No product event in the code at all · ${(Be.steps || []).filter(a => a.inProduct).length} key steps exist`, evidence: Be.installed?.length ? `installed but not called: ${Be.installed.join(", ")}` : "no analytics tool", detail: (Be.steps || []).filter(a => a.inProduct).map(a => `${a.name}: ${a.inProduct}`), value: 3, effort: 2 });
  else for (const a of missing) add({ type: "Key step not measured", title: `${a.name} doesn't fire an event`, evidence: a.inProduct, detail: [`None of the product's ${Be.event_count} events match this step.`], value: a.value || 2, effort: 1 });
  if (Be.northStar?.defined && !Be.northStar.measured) add({ type: "North Star not measured", title: `${Be.northStar.name}: no feeding event in the code`, evidence: "sources.json → metrics.northStar", detail: ["If the company's one metric isn't visible, no priority can be tested against it."], value: 3, effort: 1 });
} catch {} }

// Demand × readiness: if collect-signals has run (pm/state/signals.json), an item customers
// asked for gets +1 value (capped at 3) and wins ties by request count, so "asked for + ready" ranks above "ready"
// alone. Title and type stay untouched: collect-signals and build-waves match on them exactly.
const D = demandLoad(pm);
if (D) for (const i of items) { const g = demandFor(D, { ref: i.ref, title: i.title }); if (!g) continue;
  i.demand = { count: g.count, customer: g.customer || 0, first: g.first || g.ilk || null, last: g.last || null, trend: trendWord(g.trend) || null, ...(isCluster(g) ? { cluster: true, window: windowText(D.window) || null } : {}) };
  // demand does not lift an item somebody is already building (an open PR keeps value 0)
  if (!i.openPr) i.value = Math.min(3, (i.value ?? 2) + 1);
  (i.detail ||= []).unshift(`Demand: ${demandLine(g, D)}`); }
items.forEach(i => i.score = +(i.value / i.effort).toFixed(2));
// Equal score and demand: work that puts something new in front of the customer first (a waiting screen, a ready backend
// with no screen), then bookkeeping and questions (stale status, plan gates, metrics). Internal request 113: in blind test
// v4 the waiting screen that won sat at rank 23 of 25 ties, under "tied to no plan" questions.
const Ships = ["On the team's next list", "Screen built, waiting for backend", "Backend ready, not on screen", "Served, no screen", "Matrix: backend ready", "Endpoint exists, no screen"];
const shipsRank = t => { const i = Ships.findIndex(s => String(t).startsWith(s)); return i < 0 ? Ships.length : i; };
items.sort((a, b) => b.score - a.score || (b.demand?.count || 0) - (a.demand?.count || 0) || b.value - a.value || shipsRank(a.type) - shipsRank(b.type));
let o = `# Low-hanging fruit · ${new Date().toISOString().slice(0, 10)} · ${K.ref}\n\nScore = value (1–3) / effort (S=1, M=2, L=3). The list is evidence; a decision-maker owns what gets done.\n\n| # | Score | Effort | Type | Work | Asked for | Evidence |\n|---|---|---|---|---|---|---|\n`;
// An empty list says why: which signals had nothing to read (a fresh repo, or a product without those documents).
let emptyWhy = null;
if (!items.length) {
  const has = f => fs.existsSync(path.join(pm, "state", f)), why = [];
  if (!K.request) why.push("no request document in sources.json (`request`): signals 2-3 have nothing to read");
  if (!has("inventory.json")) why.push("no backend inventory yet: run `nosy inventory` for \"endpoint exists, no screen\"");
  if (!fs.existsSync(K.matrix || path.join(pm, "matrix.json"))) why.push("no feature matrix yet: `neighbors` fills it (or move-in step 4)");
  if (!(JSON.parse(has("team-next.json") ? fs.readFileSync(path.join(pm, "state", "team-next.json"), "utf8") : "{}").items || []).length) why.push("no team working notes found (sources.json → next.path)");
  if (!K.dropped) why.push("no `dropped` convention for backend fields the screen skips");
  emptyWhy = why;
  o += `\n**Nothing found this time.** ${why.length ? `Missing inputs: ${why.join("; ")}.` : "Every signal ran and none fired."} Reading the code by hand is the fallback: psst.md step 3.\n`;
}
items.forEach((i, n) => o += `| ${n + 1} | ${i.score} | ${i.sizeUnknown ? "?" : Effort[i.effort]} | ${i.type} | ${i.title.replace(/\|/g, "/")} | ${i.demand ? (i.demand.cluster ? `${i.demand.count} related issue${i.demand.count === 1 ? "" : "s"}${i.demand.customer ? ` · ${i.demand.customer} ${i.demand.customer === 1 ? "person" : "people"}` : ""}` : `${i.demand.count}×${i.demand.customer ? ` · ${i.demand.customer} cust.` : ""}`) + (i.demand.trend ? ` · ${i.demand.trend}` : "") : "—"} | ${String(i.evidence || "").replace(/\|/g, "/").slice(0, 120)} |\n`);
if (D?.window && items.some(i => i.demand?.cluster)) o += `\nDemand from GitHub issues counts related issues (a topic cluster matched by wording, not one request asked N times), over ${windowText(D.window)}.\n`;
if (!D) o += `\nNo demand data yet (pm/state/signals.json): drop support/interview/survey exports in pm/signal/ and run collect-signals, or \`nosy psst\` does it when that folder has files.\n`;
if (supersededNote) o += `\n${supersededNote}\n`;
if (riskNote) o += `\n${riskNote}\n`;
if (teamNote) o += `\n${teamNote}\n`;
o += `\n## Detail\n\n`;
items.slice(0, 15).forEach((i, n) => { if (i.detail?.length) o += `**${n + 1}. ${i.title}**\n${i.detail.map(a => `- ${a}`).join("\n")}\n\n`; });
process.stdout.write(o);
// each item's own ref (if any) is also written to the JSON — build-waves/measure-size/learn/diff now
// read this first instead of re-regexing it out of title+evidence; otherwise (e.g. matrix "common" row) it stays null.
if (jsonOut) fs.writeFileSync((fs.mkdirSync(path.dirname(jsonOut), { recursive: true }), jsonOut), JSON.stringify({ type: "lowHanging", ...(emptyWhy ? { empty_why: emptyWhy } : {}), generated: new Date().toISOString(), ref: K.ref, items: items.map(({ score, effort, sizeUnknown, type, title, evidence, detail, ref, demand }) => ({ score, effort: sizeUnknown ? null : Effort[effort], type, title, evidence, detail, ref: ref || null, demand: demand || null })), superseded_note: supersededNote, risk_note: riskNote, demand: D ? { generated: D.generated, goals: D.goals.length } : null }, null, 1));
