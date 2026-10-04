// bet (N3): place a product bet — what, why, what it rests on, a size estimate, the expected
// outcome — and get an id to put in the commit message, PR body or branch name. `score.mjs` later settles the bet from
// git using that id only (an explicit link, never text similarity).
// Usage:
//   node bet.mjs <pm> place "<what>" --why "<why>" --estimate S|M|L [--basis code|document|intent] [--expect "<outcome>"]
//                [--rests-on "<ref, e.g. K12, §3, #40, internal request 84>"] [--check-by YYYY-MM-DD] [--pr 12,15]
//                [--origin placed|backfill] [--date YYYY-MM-DD]
//   node bet.mjs <pm> list [--status open|landed|partial|reverted|dropped]
//   node bet.mjs <pm> show <id>
//   node bet.mjs <pm> drop <id> --reason "<why>"
//   node bet.mjs <pm> index                      rebuild pm/bets/bets.json from the .md files
// Files: pm/bets/<id>.md (the source of truth, human-editable) and pm/bets/bets.json (index, rebuilt from the .md files).
// The estimate is the human's: `bet` never prefills it (measure-size history is only a hint the agent may mention).
import { withExtras } from "./owner-json.mjs";
import { localDay } from "./today.mjs";
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { patternsOfLoad, refRegex } from "./refs.mjs";
import { smallAscii } from "./text.mjs";
import { readSources } from "./sources-file.mjs";

export const ID_RE = /\bnb-\d{6}-[a-z0-9]+(?:-[a-z0-9]+){0,2}\b/;
const STATUSES = ["open", "landed", "partial", "reverted", "dropped"];
const SLUG_STOP = new Set("a an the and or of for to in on with by from at is are be as it this that we our add adds new make let lets can".split(" "));

// nb-<yyMMdd>-<slug of up to 3 words>, unique within pm/bets/.
export function betId(what, date, taken = new Set()) {
  const d = String(date).slice(2, 10).replace(/-/g, "");
  const ws = smallAscii(what).replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w && !SLUG_STOP.has(w)).slice(0, 3);
  const base = `nb-${d}-${(ws.length ? ws : ["bet"]).join("-")}`;
  let id = base, n = 2; while (taken.has(id)) id = `${base}-${n++}`;
  return id.length > 60 ? id.slice(0, 60).replace(/-+$/, "") : id;
}

const FIELDS = [["bet", "Bet"], ["why", "Why"], ["restsOn", "Rests on"], ["estimate", "Estimate"], ["basis", "Basis"], ["expected", "Expected outcome"],
  ["checkBy", "Check by"], ["placed", "Placed"], ["origin", "Origin"], ["prs", "PRs"], ["status", "Status"], ["dropReason", "Dropped because"]];

export function betRender(b) {
  let o = `# Bet ${b.id}\n\n`;
  for (const [k, label] of FIELDS) {
    if (k === "dropReason" && !b.dropReason) continue;
    let v = b[k];
    if (k === "restsOn") v = v || "none ⚠ (rests on no decision or request)";
    if (k === "prs") v = b.prs?.length ? b.prs.map(n => `#${n}`).join(", ") : "—";
    if (k === "checkBy") v = v || "—";
    o += `- **${label}:** ${v ?? "—"}\n`;
  }
  o += `\nLink the work: put \`Bet: ${b.id}\` in the commit message or PR body, or use the id in the branch name (e.g. \`bet/${b.id}\`).\n`;
  if (b.score) o += `\n## Score\n\n${b.score.trim()}\n`;
  return o;
}

export function betParse(md, file = "") {
  const id = (md.match(/^# Bet (\S+)/m) || [])[1] || path.basename(file, ".md");
  const b = { id };
  for (const [k, label] of FIELDS) { const m = md.match(new RegExp(`^- \\*\\*${label}:\\*\\*\\s*(.*)$`, "m")); if (m) b[k] = m[1].trim(); }
  if (/^none/.test(b.restsOn || "")) b.restsOn = null;
  if (b.checkBy === "—") b.checkBy = null;
  b.prs = (b.prs && b.prs !== "—") ? [...b.prs.matchAll(/#?(\d+)/g)].map(m => +m[1]) : [];
  b.estimate = (b.estimate || "").trim().toUpperCase().slice(0, 1) || null;
  b.origin = b.origin || "placed";
  b.status = STATUSES.includes(b.status) ? b.status : "open";
  const sc = md.match(/^## Score\n\n([\s\S]*)$/m); if (sc) b.score = sc[1].trim();
  return b;
}

export function betsLoad(pm) {
  const dir = path.join(pm, "bets"); if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /^nb-.*\.md$/.test(f)).sort().map(f => betParse(fs.readFileSync(path.join(dir, f), "utf8"), f));
}
export function betSave(pm, b) {
  const dir = path.join(pm, "bets"); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${b.id}.md`); let was = ""; try { was = fs.readFileSync(file, "utf8"); } catch {}
  fs.writeFileSync(file, withExtras(betRender(b), was, ["Score"])); // what the owner added to the file stays
}
export function indexWrite(pm) {
  const bets = betsLoad(pm), dir = path.join(pm, "bets"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "bets.json"), JSON.stringify({ type: "bets", generated: new Date().toISOString(), bets: bets.map(({ score, ...b }) => b) }, null, 1));
  return bets;
}

function main() {
  const argv = process.argv.slice(2), opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const why = opt("--why"), est = opt("--estimate"), basis = opt("--basis"), expect = opt("--expect"), restsOn = opt("--rests-on"),
    checkBy = opt("--check-by"), prs = opt("--pr"), origin = opt("--origin"), date = opt("--date"), status = opt("--status"), reason = opt("--reason");
  const [pm = "pm", action = "list", ...rest] = argv, text = rest.join(" ").trim();
  const K = (() => { try { return readSources(pm); } catch { return {}; } })();
  const fail = m => { console.error(m); process.exit(1); };

  if (action === "place") {
    if (!text) fail('Usage: node bet.mjs <pm> place "<what>" --why "<why>" --estimate S|M|L [--basis …] [--expect "…"] [--rests-on K12]');
    if (!est || !/^[SML]$/i.test(est)) fail("Estimate missing: ask the owner for S, M or L (S = 1–2 days, M = about a week, L = bigger). measure-size's history can be mentioned as a hint, never filled in for them.");
    if (!why) fail('Why missing: one line, e.g. --why "customers asked 14 times; backend is ready".');
    const b0 = betsLoad(pm), taken = new Set(b0.map(b => b.id));
    const placed = date || localDay();
    let ref = null;
    if (restsOn) { const m = String(restsOn).match(refRegex(patternsOfLoad(K))); ref = m ? restsOn.trim() : null;
      if (!m) console.error(`Note: "${restsOn}" doesn't look like a decision/request reference in this product (sources.json refs); recorded as none.`); }
    const b = { id: betId(text, placed, taken), bet: text, why, restsOn: ref, estimate: est.toUpperCase(), basis: /^(code|document|intent)$/.test(basis || "") ? basis : "intent",
      expected: expect || "—", checkBy: checkBy || null, placed, origin: origin === "backfill" ? "backfill" : "placed", prs: prs ? prs.split(/[ ,]+/).map(x => +x.replace("#", "")).filter(Boolean) : [], status: "open" };
    betSave(pm, b); indexWrite(pm);
    let o = `Bet placed: ${b.id}\n  ${b.bet}\n  estimate ${b.estimate} (basis: ${b.basis}) · rests on ${b.restsOn || "none ⚠"} · file pm/bets/${b.id}.md\n\n`;
    o += `Copy this into the commit message or PR body:\n\n  Bet: ${b.id}\n\nor name the branch bet/${b.id}. \`score\` settles the bet from git using this id only.\n`;
    if (!b.restsOn) o += `\n⚠ Rests on no decision or request: add --rests-on <ref> if one exists, or record the decision first.\n`;
    process.stdout.write(o); return;
  }
  if (action === "drop") {
    const bets = betsLoad(pm), b = bets.find(x => x.id === text); if (!b) fail(`No bet ${text}.`);
    if (!reason) fail('Reason missing: --reason "<why it was dropped>"');
    b.status = "dropped"; b.dropReason = reason; betSave(pm, b); indexWrite(pm);
    console.log(`Dropped ${b.id}: ${reason}`); return;
  }
  if (action === "show") { const f = path.join(pm, "bets", `${text}.md`); if (!fs.existsSync(f)) fail(`No bet ${text}.`); process.stdout.write(fs.readFileSync(f, "utf8")); return; }
  if (action === "index") { const bets = indexWrite(pm); console.log(`${bets.length} bets → pm/bets/bets.json`); return; }
  if (action === "list") {
    const bets = betsLoad(pm).filter(b => !status || b.status === status);
    if (!bets.length) { console.log(status ? `No ${status} bets.` : 'No bets yet. Place one: node bet.mjs pm place "<what>" --why "…" --estimate S|M|L'); return; }
    let o = `| Id | Bet | Estimate | Rests on | Placed | Status |\n|---|---|---|---|---|---|\n`;
    for (const b of bets) o += `| ${b.id} | ${b.bet.replace(/\|/g, "/").slice(0, 60)} | ${b.estimate} | ${b.restsOn || "none ⚠"} | ${b.placed} | ${b.status}${b.origin === "backfill" ? " (backfill)" : ""} |\n`;
    process.stdout.write(o); return;
  }
  fail(`Unknown action: ${action}. Use place, list, show, drop, index.`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
