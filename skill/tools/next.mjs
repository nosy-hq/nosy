// next: what to run now. Reads pm/ and git, and returns the 2-3 commands worth running next, each with a one-line
// reason from the actual state (the context-aware menu idea from Impeccable's bare `/impeccable`; see
// pm/inspiration-skill-products.md). It never runs a command itself: the pick is a suggestion the owner confirms.
// Signals, all read-only and local (no network, no gh):
//   no pm/ or no sources.json                         → move-in (and nothing else: every other command needs it)
//   no record (state/shipped.json or status.json), or it's old / main moved since   → shipped
//   no psst list, or it's older than the record / a week  → psst
//   no rival files, or rivals not checked in 30+ days  → neighbors
//   a psst list newer than the waves (or no waves yet)  → scoop
//   bets exist: never scored, or one open too long / reverted   → score (bets are optional; never suggests placing one)
//   pm/state newer than pm/page.html (or no page yet) → tea
//   a landing page is set up and never checked, or the weekly landing roundup is due (a week since the last check
//   and 2+ features shipped since)                    → frontyard
//   nothing stale                                      → stakeout (the weekly run), low priority
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { Maintenance, commitArea } from "./frontyard.mjs";
import { nextDecision, render as renderDecision } from "./next-decision.mjs";
import { status as loadedStatus, render as loadedRender } from "./loaded.mjs";
import { readSourcesSafe } from "./sources-file.mjs";
import { nosyCommand } from "./hints.mjs";

const DAY = 864e5;
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };
const mtime = f => { try { return fs.statSync(f).mtimeMs; } catch { return null; } };
// A file's "as of" time: its own `generated` field when it has one (the scripts write it), otherwise its mtime.
const asOf = f => { const j = readJson(f), g = j?.generated && Date.parse(j.generated); return g || mtime(f); };
const days = (now, t) => Math.floor((now - t) / DAY);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// First-parent commits on the integration branch since a time: [{ hash, subject, body }]. Empty on any git failure.
function commitsSince(K, sinceMs) {
  const ref = K.integrationBranch || K.ref || "HEAD";
  try {
    const raw = execFileSync("git", ["-C", K.repo || ".", "log", "--first-parent", `--since=${new Date(sinceMs).toISOString()}`, "--format=%h\x1f%s\x1f%b\x1e", ref],
      { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
    return raw.split("\x1e").map(s => s.trim()).filter(Boolean).map(s => { const [hash, subject, body = ""] = s.split("\x1f"); return { hash, subject, body }; });
  } catch { return []; }
}

// Last time each rival file was touched: its last git commit, else its mtime. { file: ms }.
function rivalTouched(dir) {
  let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith(".md") && !f.startsWith("_")); } catch { return {}; }
  const seen = {};
  try {
    const out = execFileSync("git", ["-C", dir, "log", "--format=@%cI", "--name-only", "--", "."], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
    let at = null;
    for (const line of out.split("\n")) {
      if (line.startsWith("@")) at = Date.parse(line.slice(1));
      else if (line.trim()) { const f = path.basename(line.trim()); if (!(f in seen)) seen[f] = at; }
    }
  } catch {}
  return Object.fromEntries(files.map(f => [f, Math.max(seen[f] || 0, 0) || mtime(path.join(dir, f))]));
}

// Features in a set of commits, one name each: the commit's area (`feat(export): …` → export), else its title.
// Maintenance (chore/docs/fix/test/merge…) doesn't count: the page is for things customers can see.
export function featuresIn(commits) {
  const names = new Map();
  for (const c of commits) {
    if (Maintenance.test(c.subject)) continue;
    const { area, text } = commitArea(c.subject);
    const name = area || text.replace(/\s*\(.*$/, "").slice(0, 40).trim();
    if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  return [...names.values()];
}

export function next(pm, { now = Date.now(), staleDays = 7, rivalDays = 30 } = {}) {
  const picks = [], add = (command, reason, weight) => picks.push({ command, reason, weight });
  const K = readSourcesSafe(pm);
  // An older Nosy's pm/ (kaynaklar.json, durum/…) isn't a fresh repo: doctor renames it, move-in would start over.
  if (!K && fs.existsSync(path.join(pm, "kaynaklar.json"))) {
    add("doctor", `${pm}/ is from an older Nosy (kaynaklar.json, Turkish names): rename it before anything else`, 100);
    return { type: "next", generated: new Date(now).toISOString(), setUp: false, picks };
  }
  if (!fs.existsSync(pm) || !K) {
    add("move-in", fs.existsSync(pm) ? `${pm}/sources.json is missing: Nosy doesn't know this repo yet` : `no ${pm}/ folder yet: Nosy hasn't moved in`, 100);
    return { type: "next", generated: new Date(now).toISOString(), setUp: false, picks };
  }
  const state = f => path.join(pm, "state", f);

  // Inside: the record (shipped writes shipped.json and status.json; peek writes status.json).
  const shippedAt = Math.max(asOf(state("shipped.json")) || 0, asOf(state("status.json")) || 0) || null;
  if (!shippedAt) add("shipped", "no record of what shipped yet: every other answer starts from it", 90);
  else {
    const age = days(now, shippedAt), moved = commitsSince(K, shippedAt).length;
    if (age >= staleDays || moved >= 10)
      add("shipped", `the record is ${plural(age, "day")} old${moved ? ` and ${plural(moved, "commit")} landed on the integration branch since` : ""}`, 70 + Math.min(age, 20));
  }

  // The map every command reads first (commands/map.md): offered once setup is done.
  if (!fs.existsSync(path.join(pm, "map.md"))) add("map", "no product map yet: one page of what's live, beta or retired, and what only the owner knows, so answers stop contradicting each other", 52);

  // Inside: cheap wins.
  const psstAt = asOf(state("lowhanging.json"));
  if (!psstAt) add("psst", "no list of cheap wins yet (backend ready but no screen, stale requests, issues opened at us)", 60);
  else if (days(now, psstAt) >= staleDays) add("psst", `the cheap-wins list is ${plural(days(now, psstAt), "day")} old`, 55);
  else if (shippedAt && shippedAt > psstAt + 1000) add("psst", "the record moved since the cheap-wins list was built", 50);

  // psst's check step: a list nobody checked yet, or one newer than its check.
  const finalAt = asOf(state("psst-final.json"));
  if (psstAt && days(now, psstAt) < staleDays && (!finalAt || psstAt > finalAt + 1000))
    add("psst", finalAt ? "the cheap-wins list changed since it was checked: run psst's refuter again (psst.md step 3)" : "the cheap-wins list isn't checked yet: run psst's refuter (psst.md step 3) before acting on it", 48);

  // Over the fence.
  const touched = rivalTouched(path.join(pm, "rivals")), names = Object.keys(touched);
  if (!names.length) add("neighbors", "no rival files yet: nothing to say what rivals shipped or how much of it we have", 45);
  else {
    const old = names.filter(f => days(now, touched[f]) >= rivalDays);
    if (old.length) add("neighbors", `${plural(old.length, "rival")} not checked in ${rivalDays}+ days (${old.slice(0, 3).map(f => f.replace(/\.md$/, "")).join(", ")}${old.length > 3 ? "…" : ""})`, 40 + Math.min(old.length, 10));
  }

  // Ahead: the roadmap waves follow the psst list.
  const wavesAt = asOf(state("waves.json"));
  if (psstAt && !wavesAt) add("scoop", "there's a cheap-wins list but no roadmap waves built from it", 42);
  else if (psstAt && wavesAt && psstAt > wavesAt + 1000) add("scoop", "the cheap-wins list changed since the waves were built", 38);

  // Bets are optional: only speak about them when the owner has placed some.
  const index = readJson(path.join(pm, "bets", "bets.json")), bets = index?.bets || [];
  const scoreAt = asOf(state("score.json")), score = readJson(state("score.json"));
  if (bets.length) {
    const flagged = (score?.bets || []).filter(b => b.openTooLong || b.status === "reverted");
    if (!scoreAt) add("score", `${plural(bets.length, "bet")} placed, never scored`, 65);
    else if (flagged.length) add("score", `${plural(flagged.length, "bet")} open too long or reverted at the last score (${flagged.map(b => b.id).slice(0, 3).join(", ")})`, 60);
  }

  // Share: the page is drawn from pm/state.
  const pageAt = mtime(path.join(pm, "page.html"));
  const dataAt = Math.max(0, ...["shipped.json", "status.json", "lowhanging.json", "score.json", "waves.json"].map(f => asOf(state(f)) || 0));
  if (dataAt && !pageAt) add("tea", "there's something to show but no page yet", 35);
  else if (dataAt && pageAt && dataAt > pageAt + 1000) add("tea", "the page is older than what Nosy knows now", 30);

  // Front yard: the landing page changes in a weekly batch, never per commit — every page
  // change is a deploy and a chance to break it (the owner: "we did these this week, shall we put them up?"). Speaks when the
  // last check is `frontyard.every` days old (default 7) and at least `frontyard.min` features (default 2) shipped since.
  const V = K.frontyard;
  if (V && (V.path || V.url) && shippedAt) {
    const yardAt = asOf(state("frontyard.json")), every = +V.every || 7, min = +V.min || 2;
    if (!yardAt) add("frontyard", "the landing page has never been checked against what shipped", 34);
    else if (days(now, yardAt) >= every) {
      const shipped = featuresIn(commitsSince(K, yardAt));
      if (shipped.length >= min) add("frontyard", `landing roundup is due: ${plural(shipped.length, "feature")} shipped since the last check ${plural(days(now, yardAt), "day")} ago (${shipped.slice(0, 3).join(", ")}${shipped.length > 3 ? "…" : ""}); one page change for all of them?`, 36 + Math.min(shipped.length * 3, 20));
    }
  }

  if (!picks.length) add("stakeout", "nothing is stale: the weekly run (shipped → psst → neighbors → scoop → tea) is next, when the week is up", 10);
  picks.sort((a, b) => b.weight - a.weight);
  return { type: "next", generated: new Date(now).toISOString(), setUp: true, picks: picks.slice(0, 3), decision: nextDecision(pm) };
}

// Grouped by Nosy's three directions: inside first, then over the fence, then ahead.
export const MENU = [
  ["Set up", "move-in", "learn the product: repo, decisions, rivals, rules (once)"],
  ["Set up", "map", "one page of live/beta/retired apps, screens ↔ code, what only the owner knows"],
  ["Set up", "doctor", "a pm/ from an older Nosy: old names and keys, fixed with --fix"],
  ["Inside", "shipped", "what landed, when, for which decision or request (peek + explicit links + recent merges)"],
  ["Inside", "peek", "what shipped from git, what didn't, what has no screen"],
  ["Inside", "overheard", "which open PRs and issues serve which decision; not code review"],
  ["Inside", "psst", "cheap wins: backend ready but no screen, asked for + ready first"],
  ["Inside", "frontyard", "shipped but not on the landing page, and the reverse"],
  ["Inside", "dresscode", "the design system in 20 areas, the gaps that matter next"],
  ["Fence", "neighbors", "what rivals shipped and how much of it we already have"],
  ["Ahead", "canwe", "\"can we do X?\": sized, with evidence, remembered"],
  ["Ahead", "spill", "a PRD your agents can build from"],
  ["Ahead", "scoop", "the roadmap in waves, sized from history"],
  ["Share", "tea", "the decision page"],
  ["Loop", "stakeout", "the weekly run: shipped → psst → neighbors → scoop → tea"],
  ["Extra", "bet", "optional: record a bet with a size, to score later"],
  ["Extra", "score", "optional: settle bets against the record"],
];

// The same steps without an agent (`nosy <cli>`): move-in's scripted part is `setup`, tea's is `page`, stakeout's is `weekly`, neighbors' is `watch`.
// Commands with no script half show as the agent command.
export const CLI = { doctor: "doctor", "move-in": "setup", shipped: "shipped", peek: "peek", psst: "psst", frontyard: "frontyard", canwe: "canwe", neighbors: "watch", bet: "bet place", score: "score", tea: "page", stakeout: "weekly" };

// prefix: how the owner types a command here ("/nosy:" in the Claude Code plugin, "/nosy " as a skill); cli: plain `nosy` names.
export function render(R, { prefix = "/nosy:", cli = false } = {}) {
  const name = c => cli ? (CLI[c] ? nosyCommand(CLI[c]) : `/nosy:${c}`) : prefix + c;
  const width = Math.max(...MENU.map(([, c]) => name(c).length)) + 2;
  const lines = ["Psst… here's what I'd run next:", ""];
  R.picks.forEach((p, i) => lines.push(`${i + 1}. ${name(p.command)} · ${p.reason}`));
  if (R.decision) lines.push("", renderDecision(R.decision)); // the same one the nudge and the first report say
  lines.push("", "All commands:");
  for (const [group, cmd, what] of MENU) lines.push(`  ${group.padEnd(7)} ${name(cmd).padEnd(width)}${what}`);
  if (cli) lines.push("", "(/nosy:… lines have no script half: run them from your agent.)");
  return lines.join("\n");
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const jsonOut = take("--json"), nowArg = take("--now"), staleArg = take("--stale-days"), prefix = take("--prefix") ?? "/nosy:", cli = argv.includes("--cli");
  const pm = argv.filter(a => a !== "--cli")[0] || "pm";
  const R = next(pm, { now: nowArg ? Date.parse(nowArg) : Date.now(), staleDays: staleArg ? +staleArg : 7 });
  if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(R, null, 1)); }
  // the top-level skill with no command (`/nosy:nosy` in the plugin, `/nosy` as a skill): first the three "is it loaded" lines (loaded.mjs), then the picks. Not with --json.
  if (!jsonOut) { try { console.log(loadedRender(loadedStatus(), { prefix: cli ? `${nosyCommand()} ` : prefix, nextStep: false, moveIn: cli ? nosyCommand("setup .") : undefined }) + "\n"); } catch {} }
  console.log(render(R, { prefix, cli }));
}
