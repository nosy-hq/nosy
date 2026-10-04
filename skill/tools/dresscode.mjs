// dresscode: scores the product's design system across 20 areas, backs every score with file:line
// evidence, and turns the 3-5 gaps that matter most right now (per the roadmap) into a plan. Not a code
// review: it checks whether the design system's decisions are written down, linked, and current — it
// never looks at screen code.
// The area list is inspired by designsystems.surf's "AI-ready Design System Roadmap" (4 stages,
// 20 areas); the check items, evidence rules, and planning are Nosy's own.
// Usage: node dresscode.mjs <pm folder> [--folder <path>] [--json <file>] [--today YYYY-MM-DD]
//        [--from-artifact <path>] [--artifact-url <url>]  (--from-artifact is an
//        alias for --folder, for a local folder the agent downloaded from an Artifact's published files
//        via the Artifact tool's `read` call; --artifact-url is recorded in the report for provenance only
//        — this script stays offline and never fetches an Artifact itself.)
// Writes: <pm>/state/design.json (reader model), <pm>/state/dresscode.json (scores + plan),
//         <pm>/design/<date>.md (report). If a previous dresscode.json exists, shows what changed per area.
// Statuses: ready · partial · missing · ask (can't be seen from the repo — ask the owner; not the same as "missing").
// Verification (two passes): the script finds candidate evidence by word/heading match; a cheap sub-agent or
// the owner reads each candidate with its ±5-line window and says "yes/no". The verdict is stored in
// <pm>/design/approvals.json, keyed by check + file + a summary of the line window: the same wrong match
// never comes back unless the text changes, and a line shifting doesn't break the verdict.
// A rejected match is skipped and the check looks at the next candidate.
//   node dresscode.mjs <pm> decision <verdicts.json>      processes the sub-agent's [{key, decision: yes|no, reason}] answer
//   node dresscode.mjs <pm> accept|reject <id> <file:line> [--reason "..."]   the owner's verdict (overrides the agent's)
//   node dresscode.mjs <pm> add <id> <file:line> [--reason "..."]            the owner points out evidence the script missed
// Exception patterns: derived from rejected matches, a short expression per check
// ("server catalog", "is announced") is proposed, but only if it doesn't eliminate any accepted evidence. An
// approved pattern is written either to this product (<pm>/design/approvals.json → exception) or to Nosy
// itself (skill/data/dresscode-exceptions.json, shared across products).
// A line matching the pattern never goes to the judge. A pattern written to Nosy never carries product text.
//   node dresscode.mjs <pm> suggest [--pm <other pm> ...] [--apply] [--publish]
// Judge rounds: a check tries at most `thresholds.dresscodeMaxCandidates` (default 3)
// candidates. Once that many have been rejected (counted from approvals.json's decisions for that check id),
// no new candidate is proposed for it; it's marked ✗ with a note that the owner can add evidence by hand.
// Learned rejections: `node learn.mjs <pm> reject "<text>" --context "<area/check>"
// --type dresscode` also eliminates a matching line, the same way an exception pattern does (read by dresscode,
// written to by dresscode itself whenever a ✓ line is rejected — the bridge, so the owner manages rejections
// in one place, `learn list`/`remove`/`--duration`, instead of two separate mechanisms).
import { refuseDamaged } from "./owner-json.mjs";
import { localDay } from "./today.mjs";
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url"; import { createHash } from "node:crypto"; import { execFileSync } from "node:child_process"; import { read } from "./read-design.mjs"; import { small, root, smallAscii } from "./text.mjs"; import { thresholds } from "./thresholds.mjs";

const arg = (a, f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };

const summary = t => createHash("sha1").update(t).digest("hex").slice(0, 12);
const definitionSummary = id => Definition[id] ? summary(Definition[id]) : "";
const window = (s, i, r = 2) => s.slice(Math.max(0, i - r), i + r + 1).map(x => x.trim()).join("\n");
export const keyYap = (id, file, lines, i) => `${id}|${file}|${summary(window(lines, i))}`;
export function approvalRead(pm) { try { const o = JSON.parse(fs.readFileSync(path.join(pm, "design", "approvals.json"), "utf8")); return { ...o, decisions: o.decisions || {}, add: o.add || {}, exception: o.exception || [] }; } catch { return { decisions: {}, add: {}, exception: [] }; } }
export const EXCEPTION_PATH = process.env.NOSY_EXCEPTION || fileURLToPath(new URL("../data/dresscode-exceptions.json", import.meta.url)); // tests supply a temporary file
export function exceptionRead(filePath = EXCEPTION_PATH) { try { return JSON.parse(fs.readFileSync(filePath, "utf8")).patterns || []; } catch { return []; } }
function approvalWrite(pm, o) { refuseDamaged(path.join(pm, "design", "approvals.json")); fs.mkdirSync(path.join(pm, "design"), { recursive: true }); fs.writeFileSync(path.join(pm, "design", "approvals.json"), JSON.stringify(o, null, 1)); }

// --- the owner's/agent's `learn.mjs reject --type dresscode` records, the same
// filterRejects pattern measure-size.mjs (context) and canwe.mjs (context) already use. --context is the
// area + check label text (e.g. "Design–Code Alignment A live catalog exists"); a bare area name (e.g.
// "Goals", what the owner's `reject <id> ...` CLI use writes as a fallback) still matches every check in
// that area (word-overlap ≥ 0.5), which is the intended broader default when the owner doesn't name a check.
export function learnRejectRulesOf(pm) {
  try {
    const O = JSON.parse(fs.readFileSync(path.join(pm, "learned.json"), "utf8"));
    const b = localDay();
    return (O.rules || []).filter(k => k.tip === "reject" && (k.type === "dresscode" || k.type === "all") && (!k.end || k.end >= b));
  } catch { return []; }
}
const wordsOf = s => small(s || "").split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2).map(root);
function contextIsMatching(topicText, context) {
  const bw = wordsOf(context); if (!bw.length) return false;
  const sw = new Set(wordsOf(topicText));
  return bw.filter(w => sw.has(w)).length / bw.length >= 0.5;
}
const LEARN_REGEX_FORMAT_OF = /^\/(.+)\/([a-z]*)$/s; // same convention as learn.mjs's own match(): a key can be given as a regex
function learnLineMatches(rule, line) {
  const rm = LEARN_REGEX_FORMAT_OF.exec(rule.key || "");
  if (rm) { try { return new RegExp(rm[1], rm[2] || "i").test(line); } catch { return false; } }
  return smallAscii(line).includes(smallAscii(rule.key || ""));
}

// --- at most N (thresholds.dresscodeMaxCandidates) candidates tried per check ---
function rejectedCountOf(approval, id) {
  const prefix = `${id}|`;
  return Object.entries(approval.decisions || {}).filter(([key, v]) => key.startsWith(prefix) && v.decision === "no").length;
}

// --- bridges a rejected (decision "no") ✓ line into learn's storage (type dresscode),
// so the same text is also recognized by internal request 63's check above. Deliberately thin: it shells out
// to learn.mjs's own `reject` command (the same pattern canwe.mjs uses to call gather-evidence.mjs) instead
// of re-implementing its id/dedup logic here. approvals.json stays the single fine-grained, line-window-keyed
// record (never duplicated); this is the coarser, cross-tool record the owner already manages with `learn
// list`/`remove`/`--duration`. Best-effort: a missing/unwritable learned.json shouldn't fail the verdict itself.
const LEARN_TOOL = fileURLToPath(new URL("./learn.mjs", import.meta.url));
function learnBridgeWrite(pm, id, line, reason, contextText) {
  if (!line) return;
  const context = (contextText || (id || "").split("#")[0] || "dresscode").trim();
  try { execFileSync(process.execPath, [LEARN_TOOL, pm, "reject", line.slice(0, 160), "--context", context, "--type", "dresscode", "--reason", (reason || "dresscode verdict: rejected").slice(0, 200)], { stdio: "ignore" }); }
  catch {}
}

// Instruction sent to the judge sub-agent (same text as in the command doc). The word showing up isn't enough;
// the decision has to actually be written down.
export const Instruction = "For each candidate, read the 'line' and 'context' text. If the candidate has a 'definition', decide by that first — it comes before the general rule. Question: does this text really write down, for this product's DESIGN SYSTEM, the decision that the 'label' check names under 'area'? "
  + "yes: the decision is clearly written down (a rule, a table row, a process, an owner). no: the word appears in another sense (e.g. a UI 'Feedback' pattern is not a feedback process; 'A person approves' is a product principle, not a design-system decision right), "
  + "it's only mentioned or points to another document, it's example interface text, an open question or a to-do item, or there's a heading with nothing under it. If unsure, say no. "
  + "Return only a JSON array: [{\"key\": \"...\", \"decision\": \"yes\"|\"no\", \"reason\": \"one sentence\"}].";

// Written here when what counts as evidence for a check differs from the general rule; the judge checks this
// first. In particular, "pointing to another document" is itself the evidence for some checks (in the first
// BlogFactory verdict, agent context was wrongly rejected for exactly this reason).
export const Definition = {
  "Enablement#1": "Yes if the file agents read (AGENTS.md, CLAUDE.md, AI-CONTEXT) names one of the files from the candidate's 'system_documents_of' list. Here, pointing to another document is the evidence itself.",
  "Enablement#2": "A section that walks step by step through setting up a new screen/page. A general principle or a single rule isn't enough.",
  "Design–Code Alignment#3": "A catalog/preview where components render live (Storybook, a page like /design, a design-system artifact). A catalog of something else (a tool, a server) doesn't count.",
  "Design–Code Alignment#1": "A sentence that clearly says whether the source of truth for design is code or a design tool.",
  "Architecture#2": "A table/list that says which DOCUMENT or file answers design-system questions (color, component, language, rule); saying a single design document is the 'single source' is also enough. An endpoint, a hook, or app state being the 'single source of truth' doesn't count.",
  "Ownership#2": "Who decides on a design-system change, or that a change in that document is a product decision. The product's user-facing principles (e.g. 'a person approves') don't count.",
  "Feedback#1": "The way the team reports a problem/suggestion about the design system. In-UI user-feedback patterns (toast, error line) don't count.",
  "Contribution#2": "A checklist ticked off before a UI change. A plain text/copy checklist also counts.",
};

// --- evidence helpers: model._docs = [[file, text]] ---
function evidenceProvider(m, approval = { decisions: {}, add: {}, exception: [] }, general = [], learnRules = [], ES = thresholds(null)) {
  const docs = m._docs || [];
  // Role order is priority: ["governance","contribution"] searches the governance doc first. No role given = all docs.
  const roleDocs = roles => roles ? [...new Set(roles.flatMap(r => m.roles[r] || []))].map(f => docs.find(([d]) => d === f)).filter(Boolean) : docs;
  // A line under a "Not decided yet" / "Open questions" heading is not a decision: listing an open decision doesn't count as making it.
  const Open = /not decided|undecided|open (questions|decisions)|to be decided|\bTBD\b/i;
  // st.active: the id of the check currently running (e.g. "Goals#2"); score() sets it before each check.
  // st.activeText: that check's area + label text, used to match a `learn reject --context` against.
  // st.everything: every line every check matched in this run (for suggestions; never written to disk). st.eliminated: matches eliminated by a pattern.
  const st = { active: null, activeText: "", status: new Map(), cand: [], rejected: [], everything: [], eliminated: [] };
  const patterns = [...(approval.exception || []).map(x => ({ ...x, scope: "product" })), ...general.map(x => ({ ...x, scope: "Nosy" }))]
    .map(x => { try { return { ...x, re: new RegExp(x.pattern, "i") }; } catch { return null; } }).filter(Boolean);
  const search = (re, roles, group = 0) => { // first matching line that isn't eliminated or rejected → "file:line"
    let found = null;
    // once this check has 3+ rejected candidates on record, no new (unresolved) line is
    // proposed as a fresh candidate — an already-resolved line (yes/owner) still counts, below.
    const capped = rejectedCountOf(approval, st.active) >= ES.dresscodeMaxCandidates;
    for (const [f, md] of roleDocs(roles)) { const s = md.split("\n"); let open = false;
      for (let i = 0; i < s.length; i++) { const h = s[i].match(/^#{1,4}\s+(.*)$/); if (h) open = Open.test(h[1]);
        const mm = open ? null : s[i].match(re); if (!mm) continue;
        const evidence = `${f}:${i + 1}`, key = keyYap(st.active, f, s, i);
        st.everything.push({ id: st.active, key, evidence, line: s[i].trim(), matching: (mm[group] ?? mm[0]).trim() });
        if (found) continue; // scanning on only to record the rest
        const d = patterns.find(x => x.id === st.active && x.re.test(s[i]));
        if (d) { st.eliminated.push({ id: st.active, evidence, pattern: d.pattern, scope: d.scope }); continue; }
        // If the definition changed, the agent's old verdict is void (asked again); the owner's verdict stands regardless of the definition.
        const v0 = approval.decisions[key], v = v0 && (v0.source === "owner" || (v0.definition || "") === definitionSummary(st.active)) ? v0 : null;
        if (v?.decision === "no") { st.rejected.push({ id: st.active, evidence, reason: v.reason, source: v.source }); continue; }
        // a `learn reject --type dresscode` record eliminates a matching line the same way —
        // only for a line approvals.json hasn't already ruled on itself (that stays the fine-grained, authoritative
        // record for a line it has seen; learn.json is the broader fallback for a line it hasn't).
        if (!v) { const lr = learnRules.find(rule => contextIsMatching(st.activeText, rule.context) && learnLineMatches(rule, s[i]));
          if (lr) { st.eliminated.push({ id: st.active, evidence, pattern: lr.key, scope: "learn" }); continue; } }
        if (!v && capped) continue; // stop proposing new candidates; the check falls back to "missing" with a note (score())
        st.status.set(evidence, v ? (v.source === "owner" ? "owner" : "yes") : "waiting");
        if (!v) st.cand.push({ key, id: st.active, evidence, line: s[i].trim().slice(0, 240), context: s.slice(Math.max(0, i - 5), i + 6).join("\n").slice(0, 1600) });
        found = evidence; } }
    return found;
  };
  // Evidence the owner pointed out (approvals.json → add): found again by line text, so a shifted line doesn't break it.
  const ownerEvidenceOf = id => { const e = approval.add[id]; if (!e) return null; const d = docs.find(([f]) => f === e.file); if (!d) return null;
    const i = d[1].split("\n").findIndex(x => x.trim() === e.line_text_of); if (i < 0) return null;
    const evidence = `${e.file}:${i + 1}`; st.status.set(evidence, "owner"); return evidence; };
  const title = (re, roles) => search(new RegExp(`^#{1,4}\\s+.*(${re.source})`, re.flags), roles, 1);
  const file = role => (m.roles[role] || [])[0] || null;
  return { search, title, file, st, ownerEvidenceOf };
}

// Each area: stage, name, whether it's the PM's call (Define/Evolve decision areas), whether it's "ask" when
// it can't be seen from the repo, checks [label, evidence function], question for the owner (in the ask case),
// next step (plan line).
function fields(m, k) {
  const { search, title, file } = k;
  const componentExists = m.components.total > 0, stateful = Object.keys(m.components.status).some(d => d !== "?");
  const placeOf = (x, y) => x || y || null;
  return [
    { stage: "Define", name: "Goals", en: "Goals", pm: true, check: [
      ["Goals are written down", () => m.goals[0] ? `${m.goals[0].file}:${m.goals[0].line} (${m.goals.length} goals)` : title(/goals?/i)],
      ["Every goal has a success signal", () => search(/success signal|what would show|solved/i, ["direction", "design"])],
      ["Deliberate non-goals are written down", () => title(/non-goals?|not now/i) || search(/non-goals?/i)],
      ["Goals are backed by evidence", () => search(/\bevidence\b/i, ["direction"])],
    ], step: "Write a table of the 3-5 problems the design system solves, who has them, and what counts as 'solved'." },
    { stage: "Define", name: "Principles", en: "Principles", pm: true, check: [
      ["Principles are written down", () => m.principles[0] ? `${m.principles[0].file}:${m.principles[0].line} (${m.principles.length} principles)` : title(/principles?/i)],
      ["Which one wins in a conflict is clear", () => search(/in the order they win|order they win|higher one decides/i)],
      ["Kept and broken examples exist", () => search(/\|\s*(kept|broken|do|don't)\s*\|/i, ["direction", "design"]) || search(/\b(kept|broken)\b.*\b(kept|broken)\b/i)],
      ["Principles are tied to goals", () => search(/without a goal|goal to justify|G\d\b.*P\d|P\d\b.*G\d/i, ["direction"])],
    ], step: "Pick two principles that conflict, write which one wins and one 'kept / broken' example each; a plain list is enough." },
    { stage: "Define", name: "Scope", en: "Scope", pm: true, check: [
      ["Scope table exists", () => m.scope.line ? `${title(/scope/i) || "scope"} (${m.scope.line} lines)` : title(/scope/i)],
      ["What's included is clear", () => m.scope.included ? `${m.scope.included} included line(s)` : search(/\bincluded\b/i, ["direction"])],
      ["What's excluded is clear", () => m.scope.excluded ? `${m.scope.excluded} excluded line(s)` : search(/\b(excluded|out of scope)\b/i, ["direction"])],
      ["Deferred items and why are written down", () => m.scope.deferred ? `${m.scope.deferred} deferred line(s)` : search(/\bdeferred\b/i, ["direction"])],
    ], step: "Which app/platform/screen is inside the design system, which is deferred, which is out: one table, one reason per row." },
    { stage: "Define", name: "Architecture", en: "Architecture", check: [
      ["Layers are separate (token · component · pattern)", () => { const d = file("pattern") || title(/component layers|layers/i, ["design", "agent"]);
        return file("token") && componentExists && d ? `${file("token")} · ${m.components.total} components · ${d}` : null; }],
      ["Single source of truth per question", () => search(/sources? of truth/i, ["governance", "direction", "design", "agent"])],
      ["Naming convention is written down", () => title(/naming|names?\b/i) || search(/semantic tokens? only|compatibility alias/i)],
      ["Impact of a change is traceable", () => placeOf(file("usage"), search(/impact|every screen|reaches every/i, ["direction", "governance"]))],
    ], step: "Write a single table of which decision lives in which file (color → token file, component → registry, language → content guide)." },
    { stage: "Define", name: "Ownership", en: "Ownership", pm: true, ask: true, check: [
      ["Who does what is written down", () => title(/who does what|ownership|owners?/i) || search(/\bCODEOWNERS\b|maintainer/i)],
      ["Decision rights are clear", () => search(/\b(decision rights?|who approves|product decision|owner'?s? decision)/i, ["governance", "contribution", "direction"])],
      ["An exception and escalation path exists", () => title(/exceptions?|escalat/i)],
    ], question: "Who says 'yes' to a design-system change, and who does a disagreement go to?", step: "Write decision rights in one line: who proposes, who approves, who breaks a tie." },

    { stage: "Setup", name: "Foundations", en: "Foundations", check: [
      ["Color", () => title(/colou?rs?/i, ["design"]) || (m.tokens.groups.color ? `${file("token")} (color)` : null)],
      ["Typography", () => title(/typography|type scale/i, ["design"]) || (m.tokens.groups.typography || m.tokens.groups.font ? file("token") : null)],
      ["Spacing and layout", () => title(/spacing|layout|space|page layer/i, ["design", "pattern"]) || (m.tokens.groups.spacing || m.tokens.groups.space || m.tokens.groups.page ? file("token") : null)],
      ["Accessibility (contrast) rule", () => search(/contrast|WCAG/i)],
    ], step: "Bring color, typography, spacing, and contrast decisions into one document (like DESIGN.md); one sentence of 'why' for each." },
    { stage: "Setup", name: "Tokens", en: "Tokens", check: [
      ["Token file exists", () => file("token") ? `${file("token")} (${m.tokens.total} tokens)` : null],
      ["Semantic names (primary, destructive…)", () => m.tokens.total && Object.keys(m.tokens.groups).length > 1 && (m._docs || []).length ? search(/primary|foreground|destructive|semantic/i, ["design"]) : null],
      ["Two themes (light/dark)", () => search(/dark (theme|mode)|light and dark|both themes/i)],
      ["Raw values are blocked", () => (m.tests.find(t => /token|colou?r/i.test(t))) || search(/no hex|lint:colors|raw palette/i)],
    ], step: "Move colors and sizes into a token file with meaningful names (primary, surface, row-height); add a check that bans raw hex." },
    { stage: "Setup", name: "Components", en: "Components", check: [
      ["Component list exists", () => componentExists ? `${m.components.list[0]?.source} (${m.components.total} components)` : null],
      ["Every component's maturity is clear (stable/beta/legacy)", () => stateful ? `${JSON.stringify(m.components.status)}` : null],
      ["When not to use it is written down", () => m.components.when_not ? `${m.components.list[0]?.source} (${m.components.when_not} component(s))` : search(/^#+\s*when not|\bnotFor\b/i, ["design", "pattern", "governance"])],
      ["Accessibility note exists", () => m.components.access ? `${m.components.list[0]?.source} (${m.components.access} component(s))` : search(/\ba11y\b|accessibility|screen reader/i, ["design", "governance", "contribution"])],
    ], step: "One line per shared component: what it's for, when not to use it, how reliable it is (stable/beta/legacy)." },
    { stage: "Setup", name: "Design–Code Alignment", en: "Design–Code Alignment", check: [
      ["Source of design is clear (code or a design tool)", () => search(/code is the design source|design source|figma/i)],
      ["A check catches drift", () => m.tests.find(t => /visual|frontmatter|registry|token|lint|colou?r/i.test(t)) || null],
      ["A live catalog exists", () => search(/catalogue|catalog|storybook/i)],
    ], step: "Pick a single source (code or a design tool) and write that the other is generated from it; catch drift with a visual/token test." },
    { stage: "Setup", name: "Documents", en: "Documentation", check: [
      ["Pattern guide (frequent tasks)", () => file("pattern") || title(/patterns?|workflow rules|recipes/i, ["design"])],
      ["Content/language guide", () => file("content") || title(/\b(copy|content|voice|wording|writing)\b/i, ["design"])],
      ["States are written down (loading, empty, error)", () => search(/empty state|loading|nothing yet|error state/i, ["pattern", "content", "design"])],
      ["Explained with examples", () => search(/\bexample\b|kept|broken/i, ["pattern", "content", "direction"])],
    ], step: "Write the pattern for the three most frequent tasks (list page, form, empty state) and what parts it's built from; a term table for language." },

    { stage: "Spread", name: "Version", en: "Release", check: [
      ["Change log exists", () => file("change") ? `${file("change")} (${m.change.record} entries, latest ${m.change.last || "?"})` : null],
      ["Change class is clear (breaking or not)", () => search(/breaking|\bclass\b.*means|major|minor/i, ["change", "governance"])],
    ], step: "Start a dated change log; every entry should say what existing screens should do." },
    { stage: "Spread", name: "Contact", en: "Communication", ask: true, check: [
      ["A change is announced with its impact on screens", () => search(/existing screens|migrat|what to do/i, ["change"])],
      ["Announcement channel is written down", () => search(/announce|release notes|slack/i, ["governance", "contribution", "change"])],
    ], question: "When the design system changes, where does the team hear about it (channel, meeting, PR description)?", step: "Pick a single place the change log gets announced and write it in the governance doc." },
    { stage: "Spread", name: "Enablement", en: "Enablement", check: [
      ["Agent context points to the design system", () => search(/DESIGN\.md|UI_UX\.md|design system|registry|DIRECTION|components\/README|style ?guide/i, ["agent"])],
      ["Guide for setting up a new screen", () => title(/building a|new surface|new screen|getting started|how to/i, ["pattern", "contribution", "agent", "design"])],
      ["AI-readiness scenarios exist", () => m.ai.scenario.length ? `${(m.roles.agent || []).find(f => /ai-readiness/i.test(f))} (${m.ai.scenario.length} scenarios, ${m.ai.result_line_of} results)` : null],
    ], step: "Write in AGENTS.md/CLAUDE.md the order to read the design system files in; add a 'setting up a new screen' step list." },
    { stage: "Spread", name: "Contribution", en: "Contribution", check: [
      ["When to add a new piece is written down", () => search(/second (screen|feature)|before adding|new, or misuse/i)],
      ["A review checklist exists", () => title(/review checklist|checklist|before you call it done/i, ["governance", "contribution", "pattern", "design", "content"])],
    ], step: "Write a short rule that answers 'new component, or misuse?' (e.g. shared once a second screen asks for it)." },
    { stage: "Spread", name: "Governance", en: "Governance", check: [
      ["Governance document exists", () => file("governance")],
      ["Component lifecycle is written down", () => title(/lifecycle/i) || (stateful ? `${(m.roles.record || [])[0]} (status field)` : null)],
      ["Exceptions are recorded", () => title(/exceptions?/i)],
    ], step: "Open a governance document: a sources table, a lifecycle, an exception record. One page is enough." },

    { stage: "Develop", name: "Metrics", en: "Metrics", pm: true, ask: true, check: [
      ["Usage is measured", () => file("usage") || search(/usage|adoption|ds:usage/i, ["governance"])],
      ["The measure is tied to goals", () => search(/success signal/i, ["direction"]) && file("usage") ? `${file("usage")} + success signals` : null],
    ], question: "Is the design system working: which number are you watching (adoption rate, screens rebuilt, design-code drift)?", step: "Pick one measure per goal and write where it's read; start with usage counting (which screen uses which component)." },
    { stage: "Develop", name: "Feedback", en: "Feedback", pm: true, ask: true, check: [
      ["Feedback path is written down", () => title(/feedback/i, ["governance", "contribution", "agent"])],
      ["There's a loop back on the outcome", () => search(/close the loop|closes the loop|reply to|answered/i, ["governance", "contribution"])],
    ], question: "Where does the team write a design-system problem, and where do they hear the answer?", step: "Pick a single feedback spot (issue label, channel) and write it in the governance doc." },
    { stage: "Develop", name: "Maintenance", en: "Maintenance", check: [
      ["Automated checks", () => m.tests.length ? `${m.tests[0]} (+${m.tests.length - 1})` : null],
      ["Regular review", () => title(/audits?|review cadence/i) || search(/every (week|month|quarter)/i, ["governance"])],
      ["Current (recent change entry)", () => m.change.last ? `${file("change")} (latest ${m.change.last})` : null],
      ["Docs don't point to a file that doesn't exist", () => m.broken_ref.length ? { missing: m.broken_ref.slice(0, 5).map(r => `${r.name} ← ${r.where}`).join(" · ") } : `no broken references in ${(m._docs || []).length} documents`],
    ], step: "One automated check each for tokens, component registry, and contrast; a 30-minute review once a month." },
    { stage: "Develop", name: "Deprecation", en: "Deprecation", check: [
      ["Deprecation process is written down", () => title(/deprecat|retir|sunset/i, ["governance", "contribution", "design"])],
      ["What replaces an aging piece is clear", () => m.components.list.find(b => b.instead) ? `${m.components.list.find(b => b.instead).name} → ${m.components.list.find(b => b.instead).instead}` : search(/insteadOf|replaced by/i, ["governance", "change"])],
    ], step: "Write how a piece gets deprecated: why, what replaces it, which screens it affects, when it's removed." },
    { stage: "Develop", name: "Prioritization", en: "Prioritization", pm: true, check: [
      ["How design-system work is prioritized is written down", () => title(/prioriti[sz]ation/i, ["governance", "direction", "contribution"])],
      ["Tied to the product roadmap", () => search(/roadmap|roadmap wave|product wave|waves\.md/i, ["governance", "direction"])],
    ], step: "Rank design-system work in the same place as the product roadmap: which goal and which wave's screen each item serves." },
  ];
}

const Weight = { "Define": 3, "Setup": 2, "Spread": 1, "Develop": 1.5 };
const STATUS_WEIGHT = { missing: 2, ask: 1.5, unknown: 2, partial: 1, ready: 0 };
// If there's screen work on the roadmap, a gap in these areas slows that work down.
const TO_SCREEN_LINKED = new Set(["Components", "Documents", "Tokens", "Design–Code Alignment", "Scope"]);

export function score(pm, options = {}) {
  const m = read(pm, options);
  const today = options.today || localDay();
  if (m.notFound) return { date: today, notFound: true, reason: m.reason, model: m };
  const approval = options.approval || approvalRead(pm);
  const ES = options.thresholds || thresholds(pm);
  const k = evidenceProvider(m, approval, options.general ?? exceptionRead(), options.learn ?? learnRejectRulesOf(pm), ES);
  const candidates = [];
  const areaList = fields(m, k).map(a => {
    // The check function returns evidence (a string) or { missing: "detail" }; the detail goes on the ✗ line in the report.
    // verification: yes (judge approved) · owner · waiting (not looked at yet) · null (count/file evidence, not a line)
    const checks = a.check.map(([label, f], j) => {
      const id = `${a.en}#${j + 1}`; k.st.active = id; k.st.activeText = `${a.en} ${label}`; const head = k.st.cand.length, rejStart = k.st.rejected.length;
      let r = null; try { r = f() || null; } catch {}
      if (!r) r = k.ownerEvidenceOf(id);
      // no evidence, and the judge has already rejected as many candidates as allowed → ✗ with a note.
      if (!r) { const rejectedN = rejectedCountOf(approval, id); if (rejectedN >= ES.dresscodeMaxCandidates) r = { missing: `${rejectedN} candidates rejected — owner can add evidence with \`add ${id} <file:line>\`` }; }
      // no evidence, AND read-design.mjs couldn't recognize this doc's section names in
      // its language at all (m.headings_unrecognized) - never fall through to a false "missing" ✗ here; the
      // check is unknown ("?"), not failed. The headings themselves are listed once, in the report's language
      // note (see report() below), not repeated on every check line.
      const unknown = !r && m.headings_unrecognized;
      if (unknown) r = { missing: `section names not recognized in ${m.language || "this language"} — see the note above`, unknown: true };
      // Only the match that made it into the final answer becomes a candidate (not the unused branch in a || b).
      const fresh = k.st.cand.splice(head).filter(x => typeof r === "string" && r.includes(x.evidence));
      candidates.push(...fresh.map(x => ({ ...x, area: a.name, label, ...(Definition[id] ? { definition: Definition[id], definition_summary: definitionSummary(id) } : {}),
        ...(id === "Enablement#1" ? { system_documents_of: Object.entries(m.roles).filter(([r]) => r !== "agent" && r !== "test").flatMap(([, f]) => f).filter(f => f.endsWith(".md")) } : {}) })));
      const rejected = k.st.rejected.slice(rejStart), elimStart = k.st._elimStart ?? 0; const eliminated = k.st.eliminated.slice(elimStart); k.st._elimStart = k.st.eliminated.length;
      const evidenceLineOf = typeof r === "string" ? r.match(/^[^\s`]+:\d+/)?.[0] : null;
      const verification = evidenceLineOf ? k.st.status.get(evidenceLineOf) || null : null;
      const extra = { id, ...(rejected.length ? { rejected } : {}), ...(eliminated.length ? { eliminated } : {}) };
      return r && typeof r === "object" ? { label, evidence: null, detail: r.missing, ...(r.unknown ? { unknown: true } : {}), ...extra } : { label, evidence: r, verification, ...extra }; });
    const done = checks.filter(x => x.evidence).length;
    const unknownN = checks.filter(x => x.unknown).length;
    const status = done === checks.length ? "ready" : done > 0 ? "partial" : (unknownN === checks.length && m.headings_unrecognized) ? "unknown" : a.ask ? "ask" : "missing";
    const scenario = m.ai.scenario.find(s => s.area.toLowerCase().includes(a.en.toLowerCase().split(/[– ]/)[0]));
    return { stage: a.stage, name: a.name, en: a.en, pm: !!a.pm, status, done, total: checks.length, checks, ai: scenario?.no || null, ...(a.question && status !== "ready" ? { question: a.question } : {}), step: a.step };
  });

  // Screen work on the roadmap (scoop's waves): ties a gap to "why now".
  let screenTaskOf = 0, wavePath = null;
  for (const cand of [path.join(pm, "waves.md")]) if (fs.existsSync(cand)) {
    wavePath = cand; screenTaskOf = fs.readFileSync(cand, "utf8").split("\n").filter(s => /^\s*([-*]|\d+\.|\|)/.test(s) && /screen|page|list\b|form|filter|button|panel|dashboard|\bUI\b/i.test(s)).length;
  }
  const plan = areaList.filter(a => a.status !== "ready").map(a => {
    let scoreValue = Weight[a.stage] * STATUS_WEIGHT[a.status] + (a.pm ? 1 : 0) + (screenTaskOf && TO_SCREEN_LINKED.has(a.name) ? 2 : 0);
    const reason = a.status === "unknown" ? `Section names in this design system aren't recognized in ${m.language || "this language"} yet (see the note above) - the checks below couldn't be verified either way, which is not the same as "missing".`
      : screenTaskOf && TO_SCREEN_LINKED.has(a.name) ? `There's ${screenTaskOf} screen task(s) on the roadmap (${path.relative(path.join(pm, ".."), wavePath)}); this gap turns each one into a question for the designer.`
      : a.stage === "Define" ? "The Define stage is the ground the other 15 areas stand on; agents guess when they see a gap here."
      : a.pm ? "This decision belongs to the product owner; a designer can't make it instead." : "Left open, the same question gets asked again on every new screen.";
    const missing = a.checks.filter(c => !c.evidence).map(c => c.label); // step is area-wide; missing is exactly what wasn't written down
    const step = a.status === "unknown" ? "Add sources.json → glossary.design with this product's own section-name words (see move-in.md step 5), then rerun dresscode." : a.step;
    return { area: a.name, en: a.en, status: a.status, score: +scoreValue.toFixed(1), reason, missing, step, owner: a.pm ? "product owner" : "design + frontend", ...(a.question ? { question: a.question } : {}) };
  }).sort((x, y) => y.score - x.score);
  const selected = plan.slice(0, Math.max(3, Math.min(5, plan.filter(p => p.score >= 3).length)));
  const check = new Date(Date.parse(today) + 14 * 864e5).toISOString().slice(0, 10);

  let previous = null; try { previous = JSON.parse(fs.readFileSync(path.join(pm, "state", "dresscode.json"), "utf8")); } catch {}
  const changed = previous?.fields ? areaList.map(a => ({ name: a.name, before: previous.fields.find(o => o.name === a.name)?.status, now: a.status })).filter(x => x.before && x.before !== x.now) : [];

  const say = d => areaList.filter(a => a.status === d).length;
  return {
    date: today, source: m.source, artifact_url: options.artifactUrl || null,
    // never silent - the product's design language wasn't recognized (see the
    // recognition gate in read-design.mjs); the report shows which headings were found so the agent can map
    // sources.json's glossary.design.
    language: m.language || null, headings_unrecognized: !!m.headings_unrecognized, all_headings: m.all_headings || [],
    summary: { ready: say("ready"), partial: say("partial"), missing: say("missing"), ask: say("ask"), unknown: say("unknown") },
    fields: areaList, plan: selected.map(p => ({ ...p, check_date_of: check })), screen_task_of: screenTaskOf,
    previous_date: previous?.date || null, changed,
    verification: {
      approved: areaList.flatMap(a => a.checks).filter(c => c.verification === "yes" || c.verification === "owner").length,
      pending: candidates.length,
      rejected: areaList.flatMap(a => a.checks).reduce((n, c) => n + (c.rejected?.length || 0), 0),
      eliminated: k.st.eliminated.length,
    },
    candidates,
    _everything: k.st.everything,
    designer: {
      principles: m.principles.slice(0, 8).map(i => `${i.id} ${i.name}`),
      component: { total: m.components.total, status: m.components.status },
      measurements: m.tokens.pixel,
      ai_scenario: m.ai.scenario.length, ai_result: m.ai.result_line_of,
    },
    model: m,
  };
}

const Marker = { ready: "✓", partial: "◐", missing: "✗", ask: "?", unknown: "?" };
export function report(P) {
  if (P.notFound) return `# dresscode · ${P.date}\n\nDesign system not found: ${P.reason || "no source file"}.\n\n` +
    `If the design system lives somewhere else, add \`"design": { "root": "apps/web" }\` to \`pm/sources.json\`, or for a folder downloaded from an Artifact use \`"design": { "folder": "<path>" }\`.\n`;
  const src = P.source.type === "git" ? `${P.source.repo}@${P.source.ref}` : P.source.folder;
  let o = `# dresscode · ${P.date}\n\n`;
  o += `Design system: \`${src}\`${P.source.root ? ` · root \`${P.source.root}\`` : ""}${P.source.root_estimate ? " (estimated)" : ""}\n\n`;
  if (P.source.type === "folder") o += `_Folder mode: tests, change log, and agent context usually live in the repo and don't show up in a folder. The ✗'s here should be retried in repo mode (\`sources.json\` → \`design.root\`)._\n\n`;
  if (P.artifact_url) o += `_Source: downloaded from an Artifact (\`${P.artifact_url}\`) by the agent — not fetched by this script, which stays offline._\n\n`;
  // never silent - section names not recognized in this doc's language (EN/TR core +
  // sources.json's glossary.design found nothing anywhere in the headings, though the docs clearly have
  // sections). Shown once, here, instead of repeating the heading list on every affected check line below.
  if (P.headings_unrecognized) o += `**Section names not recognized in ${P.language || "this doc's language"}:** ${P.all_headings.length} section(s) found in the design docs, but none matched Nosy's built-in (English/Turkish) words or sources.json's \`glossary.design\`. Checks below are marked "?" (unknown) — not "missing" — until this is fixed. Agent, map these headings to \`glossary.design\` (see move-in.md step 5):\n\n${P.all_headings.map(h => `- ${h}`).join("\n")}\n\n`;
  o += `**${P.summary.ready} ready · ${P.summary.partial} partial · ${P.summary.missing} missing · ${P.summary.ask} to ask${P.summary.unknown ? ` · ${P.summary.unknown} unknown (language)` : ""}** (20 areas)\n\n`;
  const D = P.verification;
  o += `Evidence: ${D.approved} line(s) verified · ${D.pending} awaiting verification (✓?) · ${D.rejected} match(es) rejected${D.eliminated ? ` · ${D.eliminated} match(es) eliminated by an exception pattern` : ""}${D.pending ? " — candidates in `pm/state/dresscode-verify.json`" : ""}\n\n`;
  if (P.changed.length) o += `Since the last run (${P.previous_date}): ${P.changed.map(d => `${d.name} ${d.before} → ${d.now}`).join(" · ")}\n\n`;
  o += `## ${P.plan.length} gaps that matter right now\n\n`;
  o += P.plan.map((p, i) => `${i + 1}. **${p.area}** (${p.en}) · ${Marker[p.status]} ${p.status}\n   - Missing: ${p.missing.join(" · ")}\n   - Why now: ${p.reason}\n   - Next step: ${p.step}\n   - Owner: ${p.owner} (suggested) · check on: ${p.check_date_of}${p.question ? `\n   - Ask the owner: ${p.question}` : ""}`).join("\n") + "\n\n";
  for (const stage of ["Define", "Setup", "Spread", "Develop"]) {
    o += `## ${stage}\n\n| Area | Status | Checks | AI scenario |\n|---|---|---|---|\n`;
    for (const a of P.fields.filter(x => x.stage === stage)) o += `| ${a.name} (${a.en})${a.pm ? " · PM" : ""} | ${Marker[a.status]} ${a.status} | ${a.done}/${a.total} | ${a.ai || "—"} |\n`;
    o += "\n";
    for (const a of P.fields.filter(x => x.stage === stage)) {
      const marker = c => c.unknown ? "?" : !c.evidence ? "✗" : c.verification === "waiting" ? "✓?" : "✓";
      const not = c => c.verification === "owner" ? " · owner" : c.verification === "yes" ? " · verified" : "";
      o += `**${a.name}**\n${a.checks.map(c => `- ${marker(c)} ${c.label} \`${c.id}\`${c.evidence ? ` — \`${c.evidence}\`${not(c)}` : c.detail ? ` — ${c.detail}` : ""}`
        + (c.rejected || []).map(r => `\n  - rejected: \`${r.evidence}\` — ${r.reason || ""}${r.source === "owner" ? " (owner)" : ""}`).join("")
        + (c.eliminated || []).map(r => `\n  - eliminated by pattern: \`${r.evidence}\` — /${r.pattern}/ (${r.scope})`).join("")).join("\n")}${a.question ? `\n- ? Ask the owner: ${a.question}` : ""}\n\n`;
    }
  }
  const T = P.designer;
  o += `## Talking to the designer\n\n`;
  o += `- **Components:** ${T.component.total} (${Object.entries(T.component.status).map(([d, n]) => `${n} ${d}`).join(", ") || "maturity not written down"})\n`;
  if (T.principles.length) o += `- **Principles (in order):** ${T.principles.join(" · ")}\n`;
  if (T.measurements.length) o += `- **Measurements:** ${T.measurements.map(x => `\`${x.name}\` ${x.value}`).join(", ")}\n`;
  o += `- **AI readiness:** ${T.ai_scenario ? `${T.ai_scenario} scenario(s), ${T.ai_result} result line(s)` : "no scenarios yet — `dresscode` step 3 runs the first test"}\n\n`;
  o += `---\n_Statuses are evidence-based: ✓ file:line shown (✓? not yet verified) · ✗ not found ("?" can't be seen from the repo, ask the owner). The area list is inspired by designsystems.surf's "AI-ready Design System Roadmap"; the check items are Nosy's own._\n`;
  return o;
}

// --- exception pattern suggestion ---
// On a rejected line, looks for the shortest expression (≥2 words) around the word that triggered the check:
// "server catalog", "is announced", "PR waves". The expression must not match any product's protected lines for
// that check (accepted, owner's, or not-yet-looked-at evidence); if it does, a longer expression is tried, and if
// none is safe, no suggestion comes out.
const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The expression doesn't cross a sentence or table-cell boundary (so no nonsense pattern like "catalogue | no"),
// and doesn't start or end on a filler word (not "… source of truth for").
const Filler = new Set("a an the of for to in on at by and or is are was be this that these it its no not with as from our your".split(" "));
// Splits the line into a bounded chunk and gives the word range [a, b] of the triggering word (shared by the expression and neighbor logic).
function split(line0, matching) {
  const e00 = line0.toLowerCase().indexOf(String(matching).toLowerCase()); if (e00 < 0) return null;
  // A comma or parenthesis is also a boundary: in "MCP catalog, OAuth", "OAuth" isn't a neighbor.
  const limit = /\s\|\s|\|\s|\s\||[.;:!?,](\s|$)|\s[—–]\s|\s-\s|\*\*|`|[()]/g; let head = 0, last = line0.length, mm;
  while ((mm = limit.exec(line0))) { if (mm.index + mm[0].length <= e00) head = mm.index + mm[0].length; else if (mm.index >= e00 + String(matching).length) { last = mm.index; break; } }
  const line = line0.slice(head, last);
  const words = [...line.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu)].map(x => ({ w: x[0].replace(/[.]+$/, ""), head: x.index, last: x.index + x[0].length }));
  const e0 = line.toLowerCase().indexOf(String(matching).toLowerCase()); if (e0 < 0 || !words.length) return null;
  const e1 = e0 + String(matching).length;
  const ic = words.map((k, i) => (k.last > e0 && k.head < e1) ? i : -1).filter(i => i >= 0); if (!ic.length) return null;
  return { words, a: ic[0], b: ic[ic.length - 1] };
}
function expressionCandidatesOf(line0, matching) {
  const P = split(line0, matching); if (!P) return [];
  const { words, a, b } = P, out = [];
  for (const [left, right] of [[1, 0], [0, 1], [1, 1], [2, 0], [0, 2], [2, 1], [1, 2], [2, 2]]) {
    const i = a - left, j = b + right; if (i < 0 || j >= words.length || j - i < 1) continue;
    const part = words.slice(i, j + 1).map(k => k.w); if (part.join(" ").length < 8) continue;
    if (Filler.has(part[0].toLowerCase()) || Filler.has(part[part.length - 1].toLowerCase())) continue;
    out.push(`\\b${part.map(esc).join("\\W+")}\\b`);
  }
  return [...new Set(out)];
}
// --- generalization: rejections of the same trigger with different neighbors, on the
// same check, merge into one pattern ---
// "server catalog" + "MCP catalog" + "tool catalog" → (?:MCP|server|tool) catalog. Only OBSERVED neighbors get
// added (not "\w+ catalog": "component catalog" is evidence). For each rejection, the single-word neighbor is
// tried first; if it matches a protected line, the two-word predecessor ("public API") is tried; if both match,
// that rejection doesn't join the generalization. The trigger word tolerates suffixes: "catalog" → catalogs,
// catalogue. JS's plain \b is close enough here since the boundary is ASCII-only; the merged pattern still uses
// its own letter boundary for clarity.
// The pattern's structure (side, root, neighbors) is written to the record as `structure`, so a later merge
// doesn't have to reverse-engineer the regex.
const Letter = "a-z0-9";
const B0 = `(?<![${Letter}])`, B1 = `(?![${Letter}])`;
function resolveTrigger(k, a, b, matching) {
  const word = k.slice(a, b + 1).map(x => x.w.toLowerCase()), e = String(matching).toLowerCase().trim();
  if (word.length === 1 && e.length >= 4 && word[0].startsWith(e) && !/\s/.test(e)) word[0] = e; // root of a suffixed word: catalogs → catalog
  return word;
}
function neighbor(line, matching) {
  const P = split(line, matching); if (!P) return null;
  const { words: k, a, b } = P, filler = i => Filler.has(k[i].w.toLowerCase());
  const left = [], right = [];
  if (a >= 1 && !filler(a - 1)) { left.push([k[a - 1].w]); if (a >= 2 && !filler(a - 2)) left.push([k[a - 2].w, k[a - 1].w]); }
  if (b + 1 < k.length && !filler(b + 1)) { right.push([k[b + 1].w]); if (b + 2 < k.length && !filler(b + 2)) right.push([k[b + 1].w, k[b + 2].w]); }
  return { trigger: resolveTrigger(k, a, b, matching), left, right };
}
const unescape = t => t.replace(/\\(.)/g, "$1");
// Resolves old two-word patterns that have no recorded structure: \bX\W+T\b or \b(?:X|Y)\W+T\b.
function resolvePattern(d) {
  if (d.structure) return d.structure;
  const m = String(d.pattern).match(/^\\b(.+)\\b$/); if (!m) return null;
  const p = m[1].split("\\W+"); if (p.length !== 2) return null;
  const alt = x => { const g = x.match(/^\(\?:(.+)\)$/); return (g ? g[1].split("|") : [x]).map(unescape); };
  const [left, right] = p.map(alt);
  if (right.length === 1) return { side: "left", root: [right[0].toLowerCase()], neighbors: left };
  if (left.length === 1) return { side: "right", root: [left[0].toLowerCase()], neighbors: right };
  return null;
}
const escK = w => esc(w).replace(/\s+/g, "\\W+");
function triggerPattern(root) {
  const last = root[root.length - 1], head = root.slice(0, -1).map(esc);
  const attached = last.length >= 4 ? esc(last) + `[${Letter}]*` : esc(last);
  return [...head, attached].join("\\W+");
}
function mergedPattern(side, root, neighbors) {
  const k = [...new Set(neighbors)].sort((x, y) => x.toLowerCase() < y.toLowerCase() ? -1 : 1).map(escK);
  const g = k.length > 1 ? `(?:${k.join("|")})` : k[0], t = triggerPattern(root);
  return side === "left" ? `${B0}${g}\\W+${t}${B1}` : `${B0}${t}\\W+${g}${B1}`;
}

export function suggest(pms, options = {}) {
  const general = options.general ?? exceptionRead();
  const rejected = [], protect = [], existing = new Set(general.map(x => `${x.id} ${x.pattern}`)), registered = general.map(x => ({ ...x, scope: "Nosy" }));
  for (const pm of pms) {
    const approval = approvalRead(pm); for (const x of approval.exception) { existing.add(`${x.id} ${x.pattern}`); registered.push({ ...x, scope: "product" }); }
    const P = score(pm, { approval, general: [] }); if (P.notFound) continue; // suggestions are built from raw matches: existing patterns aren't applied here
    const name = path.basename(path.resolve(pm, "..")) || pm;
    for (const h of P._everything) { const v = approval.decisions[h.key];
      (v?.decision === "no" ? rejected : protect).push({ ...h, product: name, reason: v?.reason }); }
  }
  const suggestions = new Map();
  const closed = r => registered.some(d => d.id === r.id && (() => { try { return new RegExp(d.pattern, "i").test(r.line); } catch { return false; } })());
  for (const r of rejected) {
    if (closed(r)) continue; // already eliminated by a pattern; a singular suggestion is redundant (it'll still join the generalization)
    const protectedLines = protect.filter(k => k.id === r.id);
    const pattern = expressionCandidatesOf(r.line, r.matching).find(d => { const re = new RegExp(d, "i"); return re.test(r.line) && !protectedLines.some(k => re.test(k.line)); });
    if (!pattern || existing.has(`${r.id} ${pattern}`)) continue;
    const o = suggestions.get(`${r.id} ${pattern}`) || { id: r.id, pattern, products: new Set(), support: 0, example: r.line.slice(0, 160), reason: r.reason, check_that_is_done: protectedLines.length };
    o.products.add(r.product); o.support++; suggestions.set(`${r.id} ${pattern}`, o);
  }
  // If the same pattern also covers other rejected lines, support goes up.
  for (const o of suggestions.values()) { const re = new RegExp(o.pattern, "i"); o.support = rejected.filter(r => r.id === o.id && re.test(r.line)).length;
    o.products = [...new Set(rejected.filter(r => r.id === o.id && re.test(r.line)).map(r => r.product))]; }
  // Generalization: sources grouped per check + side + trigger root. Each source (a rejection, or a neighbor of a
  // registered pattern) carries its neighbor options in order: [one word, two words]. A registered pattern's
  // neighbor is a single option.
  const groups = new Map();
  const add = (id, side, root, optionsValue, source) => { const g = `${id}|${side}|${root.join(" ")}`;
    const x = groups.get(g) || { id, side, root, sources: [] }; x.sources.push({ options: optionsValue, source }); groups.set(g, x); };
  for (const r of rejected) { const k = neighbor(r.line, r.matching); if (!k) continue;
    if (k.left.length) add(r.id, "left", k.trigger, k.left.map(x => x.join(" ")), r); if (k.right.length) add(r.id, "right", k.trigger, k.right.map(x => x.join(" ")), r); }
  for (const d of registered) { const c = resolvePattern(d); if (c) for (const n of c.neighbors) add(d.id, c.side, c.root, [n], d); }
  const merged = [];
  for (const g of groups.values()) {
    const protectedLines = protect.filter(k => k.id === g.id);
    const isSafe = n => { const re = new RegExp(mergedPattern(g.side, g.root, [n]), "i"); return !protectedLines.some(k => re.test(k.line)); };
    // The first safe option per source; if none is safe, the source is dropped (protected-line rule).
    const selection = g.sources.map(x => ({ ...x, n: x.options.find(isSafe) })).filter(x => x.n);
    const safe = [...new Set(selection.map(x => x.n))].sort((x, y) => x.toLowerCase() < y.toLowerCase() ? -1 : 1); // same order as in the pattern
    if (safe.length < 2 || !selection.some(x => !x.source.pattern)) continue;
    const pattern = mergedPattern(g.side, g.root, safe); if (existing.has(`${g.id} ${pattern}`)) continue;
    const re = new RegExp(pattern, "i"), covered = rejected.filter(r => r.id === g.id && re.test(r.line));
    // A registered pattern is replaced if all of its neighbors ended up inside the merged pattern.
    const instead = [...new Map(g.sources.filter(x => x.source.pattern).map(x => [x.source.pattern + "|" + x.source.scope, x.source])).values()]
      .filter(d => (resolvePattern(d)?.neighbors || []).every(n => safe.includes(n))).map(d => ({ pattern: d.pattern, scope: d.scope }));
    merged.push({ id: g.id, pattern, merged: true, neighbors: safe, structure: { side: g.side, root: g.root, neighbors: safe }, instead,
      products: [...new Set(covered.map(r => r.product))], support: covered.length, example: covered[0]?.line.slice(0, 160) || "", reason: covered[0]?.reason, check_that_is_done: protectedLines.length });
  }
  // Singular suggestions that a merged pattern already covers drop off the list.
  const singular = [...suggestions.values()].filter(o => !merged.some(b => b.id === o.id && rejected.filter(r => r.id === o.id && new RegExp(o.pattern, "i").test(r.line)).every(r => new RegExp(b.pattern, "i").test(r.line))));
  return [...merged, ...singular].sort((a, b) => b.products.length - a.products.length || b.support - a.support);
}

// Records a verdict. The owner's verdict overrides the agent's; the agent can't override the owner's.
export function verdictWrite(pm, inputs, source, today = localDay()) {
  const o = approvalRead(pm); let n = 0;
  for (const g of inputs) {
    if (!g?.key || !/^(yes|no)$/i.test(g.decision || "")) continue;
    if (o.decisions[g.key]?.source === "owner" && source !== "owner") continue;
    const decision = /^yes$/i.test(g.decision) ? "yes" : "no";
    o.decisions[g.key] = { decision, reason: String(g.reason || "").slice(0, 300), source, date: today, ...(g.id ? { id: g.id } : {}), ...(g.evidence ? { evidence: g.evidence } : {}), ...(g.definition_summary ? { definition: g.definition_summary } : {}) };
    n++;
    // a rejected ✓ line also becomes a learn record (type dresscode), the bridge to internal request 63.
    if (decision === "no") learnBridgeWrite(pm, g.id, g.line, g.reason, g.context);
  }
  approvalWrite(pm, o); return n;
}
function lineFind(pm, options, evidence) {
  const m = read(pm, options), mm = String(evidence).match(/^(.*):(\d+)$/); if (!mm) throw new Error(`expected file:line: ${evidence}`);
  const d = (m._docs || []).find(([f]) => f === mm[1]); if (!d) throw new Error(`not found in the design system documents: ${mm[1]}`);
  const s = d[1].split("\n"), i = +mm[2] - 1; if (i < 0 || i >= s.length) throw new Error(`no such line: ${evidence}`);
  return { file: mm[1], s, i };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), pm = a[0] && !a[0].startsWith("--") ? a[0] : "pm";
  const alt = a[1], sec = { folder: arg(a, "--folder") || arg(a, "--from-artifact") };
  const artifactUrl = arg(a, "--artifact-url");
  if (alt === "decision") { // the sub-agent's answer: candidate metadata is filled in from the latest dresscode-verify.json
    let answer; try { answer = JSON.parse(fs.readFileSync(a[2], "utf8")); } catch (e) { console.error(`couldn't read: ${a[2]} (${e.message})`); process.exit(1); }
    let meta = {}; try { meta = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(pm, "state", "dresscode-verify.json"), "utf8")).candidates.map(x => [x.key, x])); } catch {}
    const n = verdictWrite(pm, (Array.isArray(answer) ? answer : answer.verdicts || []).map(g => ({ ...g, id: meta[g.key]?.id, evidence: meta[g.key]?.evidence, definition_summary: meta[g.key]?.definition_summary, line: meta[g.key]?.line, context: meta[g.key] ? `${meta[g.key].area} ${meta[g.key].label}` : undefined })), "agent");
    console.log(`${n} verdict(s) recorded → ${path.join(pm, "design", "approvals.json")}. Now rerun dresscode.`); process.exit(0);
  }
  if (alt === "suggest") {
    const others = a.flatMap((x, i) => x === "--pm" ? [a[i + 1]] : []).filter(Boolean);
    const list = suggest([pm, ...others]);
    if (!list.length) { console.log("No suggestions: no safe exception pattern came out of the rejected matches (or they're all already recorded)."); process.exit(0); }
    console.log(`# Exception pattern suggestions (${list.length})\n`);
    list.forEach((o, n) => console.log(`${n + 1}. \`${o.id}\` /${o.pattern}/ · covers ${o.support} rejection(s) · in ${o.products.length} product(s) (${o.products.join(", ")}) · eliminates none of the ${o.check_that_is_done} protected line(s)`
      + (o.merged ? `\n   generalization: ${o.neighbors.length} observed neighbor(s)${o.instead.length ? ` · replaces: ${o.instead.map(y => `/${y.pattern}/ (${y.scope})`).join(", ")}` : ""}` : "")
      + `\n   example: ${o.example}\n   reason: ${o.reason || "—"}`));
    const date = localDay();
    // --sec 1,3: only the selected ones. No selection: --apply writes all of them to this product; --publish writes
    // only patterns seen in ≥2 products to Nosy (a pattern seen in one product hasn't proven it's general; the owner
    // can publish it deliberately with --sec).
    // --sec: a list number (1,3) or a check id (Architecture#2) — the id doesn't shift even if the list is renumbered.
    const sec = arg(a, "--sec") ? new Set(arg(a, "--sec").split(",").map(x => x.trim())) : null;
    const selected = list.filter((o, n) => !sec || sec.has(String(n + 1)) || sec.has(o.id));
    const thisProduct = path.basename(path.resolve(pm, "..")) || pm; // --apply writes only patterns from this product's own rejections to this product
    // A merged pattern deletes the old patterns in the same scope that it replaces (so a check doesn't end up with two copies).
    const extract = (array, x, scope) => array.filter(d => !(d.id === x.id && (x.instead || []).some(y => y.scope === scope && y.pattern === d.pattern)));
    if (a.includes("--apply")) { const o = approvalRead(pm); for (const x of selected.filter(x => x.products.includes(thisProduct))) { o.exception = extract(o.exception, x, "product"); o.exception.push({ id: x.id, pattern: x.pattern, ...(x.structure ? { structure: x.structure } : {}), reason: x.reason || "", date }); } approvalWrite(pm, o); console.log(`\n${selected.filter(x => x.products.includes(thisProduct)).length} pattern(s) written to this product → ${path.join(pm, "design", "approvals.json")}`); }
    if (a.includes("--publish")) { // To Nosy itself: product text (the example line) is NOT written; only the pattern, the general reason, and how many products it was seen in.
      let j = { patterns: [] }; try { j = JSON.parse(fs.readFileSync(EXCEPTION_PATH, "utf8")); } catch {}
      // Default: a pattern seen in ≥2 products, or a generalization of a pattern already published to Nosy (the
      // family was already approved; only the observed neighbors are added, and it still passes the protected-line rule).
      const publish = sec ? selected : selected.filter(x => x.products.length >= 2 || (x.instead || []).some(y => y.scope === "Nosy"));
      for (const x of publish) { const old = j.patterns.find(d => d.id === x.id && (x.instead || []).some(y => y.scope === "Nosy" && y.pattern === d.pattern));
        j.patterns = extract(j.patterns, x, "Nosy");
        j.patterns.push({ id: x.id, pattern: x.pattern, ...(x.structure ? { structure: x.structure } : {}), ...(old?.reason ? { reason: old.reason } : {}), product_count: x.products.length, support: x.support, date }); }
      fs.writeFileSync(EXCEPTION_PATH, JSON.stringify(j, null, 1) + "\n"); console.log(`\n${publish.length} pattern(s) written to Nosy${!sec && publish.length < selected.length ? ` (${selected.length - publish.length} skipped — seen in only one product; use --sec to publish deliberately)` : ""} → ${EXCEPTION_PATH} (commit with the owner's approval)`);
    }
    process.exit(0);
  }
  if (alt === "accept" || alt === "reject" || alt === "add") {
    const [id, evidence] = [a[2], a[3]], reason = arg(a, "--reason") || "";
    if (!id || !evidence) { console.error(`Usage: node dresscode.mjs <pm> ${alt} <check id, e.g. Goals#2> <file:line> [--reason "..."]`); process.exit(1); }
    try {
      const { file, s, i } = lineFind(pm, sec, evidence);
      if (alt === "add") { const o = approvalRead(pm); o.add[id] = { file, line_text_of: s[i].trim(), reason, date: localDay() }; approvalWrite(pm, o); }
      else verdictWrite(pm, [{ key: keyYap(id, file, s, i), decision: alt === "accept" ? "yes" : "no", reason, id, evidence, line: s[i].trim() }], "owner");
      console.log(`${id}: ${alt} recorded (${file}:${i + 1}).`); process.exit(0);
    } catch (e) { console.error(e.message); process.exit(1); }
  }
  const P = score(pm, { ...sec, today: arg(a, "--today"), artifactUrl });
  const o = report(P);
  const status = path.join(pm, "state");
  try {
    fs.mkdirSync(status, { recursive: true });
    if (!P.notFound) {
      fs.writeFileSync(path.join(status, "design.json"), JSON.stringify(P.model, null, 1));
      const { model, candidates, _everything, ...record } = P; fs.writeFileSync(arg(a, "--json") || path.join(status, "dresscode.json"), JSON.stringify(record, null, 1));
      // Input for the judge sub-agent: only candidates without a verdict yet. Written with an empty list too if there are none, so it doesn't go stale.
      fs.writeFileSync(path.join(status, "dresscode-verify.json"), JSON.stringify({ date: P.date, instruction: Instruction, candidates }, null, 1));
      fs.mkdirSync(path.join(pm, "design"), { recursive: true }); fs.writeFileSync(path.join(pm, "design", `${P.date}.md`), o);
    }
  } catch (e) { console.error(`write failed: ${e.message}`); }
  process.stdout.write(o);
}
