#!/usr/bin/env node
// Nosy's single entry point: runs the model-free (no-LLM) counts with one command. The same scripts are called
// from every agent, from CI (GitHub Action), and from the MCP server; the judgment call still belongs to the agent.
// Counting happens in the script, judgment in the agent, memory in pm/.
// Usage: node nosy.mjs <command> [--pm <pm folder>] [...]      (via npx: `npx nosy <command>`)
// Commands: next (the default), tour, roadmap, facts, find, sweep, matrix-proposals, tiers, cite-check, team-next, fields, receipts, refute, decision, nudge, install, update, uninstall, doctor, setup, check, explain, shipped, ship-notes, peek, inventory, gates, metrics, frontyard, signals, watch, rival-demand, rival-signals, psst, bet, score, todo, canwe, notes, page, page-adopt, weekly, notify, publish, mcp, help.
// No dependencies; uses git and (if present) gh. The commands that write outward are `notify` (only to the given webhook), `ship-notes --yes` (one comment per issue that asked, on GitHub) and `publish` (opt-in: counts and structure only, to a Nosy Cloud you configured, after the privacy scan); `watch` only reads public rival pages (plain GET).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { demandInputs, interviewInputs } from "./demand.mjs";
import { advice, cleanTrace, closest, nosyCommand, nosyPrefix, oldLayout, repoProblem, sourcesProblem } from "./hints.mjs";
import { versionOf } from "./loaded.mjs";
import { readSources, findPm } from "./sources-file.mjs";

const Tool = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const al = name => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = name => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };
const explicitPm = al("--pm") || process.env.NOSY_PM || null;
// pm/ is looked for upward when it isn't here (internal request 204; sources-file.mjs findPm): one line on stderr, once, says which.
const pm = findPm(process.cwd(), { explicit: explicitPm });
if (!explicitPm && pm !== "pm" && !["--version", "-v", "-V", "--help", "-h", "help", "version", "mcp"].includes(argv[0])) console.error(`Using ${path.resolve(pm)} (found above this folder)`);
const since = al("--since"), target = al("--for"), short = flag("--short"), scoreboardPage = flag("--scoreboard"), decisionsFlag = flag("--decisions");
flag("--all"); flag("--decision"); // older flags: the full cycle and the decision page are the defaults again
const [given = "next", ...args] = argv;
const command = ["--version", "-v", "-V"].includes(given) ? "version" : ["--help", "-h"].includes(given) ? "help" : given;
const today = new Date().toISOString().slice(0, 10);

const sources = () => { try { return readSources(pm); } catch { return null; } };
const statusWrite = (name, content) => { fs.mkdirSync(path.join(pm, "state"), { recursive: true }); fs.writeFileSync(path.join(pm, "state", name), content); };

// Hints in the scripts' own messages say `nosy <command>`, and nothing puts `nosy` on PATH after `nosy install`: say the
// command that runs here (hints.mjs nosyCommand). No change when a global `nosy` exists.
const localize = text => {
  const prefix = nosyPrefix(); if (prefix === "nosy" || !text) return text;
  return text.replace(new RegExp("`nosy (" + [...Object.keys(Commands), "help"].join("|") + ")\\b([^`\\n]*)`", "g"), (_, c, rest) => "`" + prefix + " " + c + rest + "`");
};
const NoStateDir = new Set(["adopt-page.mjs", "tour.mjs", "rivals-import.mjs", "doctor.mjs", "health.mjs", "find-sources.mjs", "install.mjs", "git-hooks.mjs", "explain.mjs", "next.mjs", "verify-setup.mjs"]);
// Runs a script; prints its output or (silently) returns it. Never throws, returns the exit code instead.
function script(name, a = [], { silent = false } = {}) {
  // A fresh repo has no pm/state yet: every step writes there (first-run `nosy inventory` / `nosy shipped` used to crash).
  // Not for the scripts that only read or set up (doctor would create the state/ it then warns about beside an old durum/),
  // and not in an older Nosy's pm/ (old names): state/ there is what `doctor --fix` renames durum/ to.
  if (fs.existsSync(pm) && !NoStateDir.has(name) && !oldLayout(pm).length) fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  const r = spawnSync(process.execPath, [path.join(Tool, name), ...a], { encoding: "utf8", maxBuffer: 64 << 20 });
  // A script that crashed (a raw Node stack trace) says what broke and the fix instead; real messages pass through untouched.
  if (!silent) { process.stdout.write(localize(r.stdout || "")); const clean = r.status ? cleanTrace(r.stderr) : null; process.stderr.write(localize(clean ? `${clean}\n` : r.stderr || "")); }
  return { code: r.status ?? 1, output: r.stdout || "", error: r.stderr || "" };
}
// pm/sources.json has to exist and parse, and (unless `repo: false`) the repo and branch it names have to read: without
// that most scripts would crash with a git stack trace, or worse, answer "nothing found" about a repo they never read.
// Each problem says what to do next (hints.mjs). Checked once per run.
let repoVerdict;
function sourceRequired({ repo = true } = {}) {
  const bad = sourcesProblem(pm) ?? (repo ? (repoVerdict ??= repoProblem(sources()) ?? "") || null : null);
  if (!bad) return true;
  console.error(`Psst… ${bad}`);
  process.exitCode = 1;
  return false;
}
// "7d" / "30d" → date; a date or ref is passed through unchanged.
const start = s => { const m = /^(\d+)d$/.exec(s || "7d"); return m ? new Date(Date.now() - m[1] * 864e5).toISOString().slice(0, 10) : s; };

const Commands = {
  // No command (or `next`): the 2-3 front-door steps worth running now, each with its reason, then the grouped menu.
  // Read-only; never runs the step it suggests.
  next: () => { const r = script("next.mjs", [pm, "--cli"]); if (r.code === 0) console.log(`\nEvery command with its options: ${nosyCommand("help")}`); return r; },
  // A pm/ folder from an older Nosy (Turkish names, old sources.json keys): what to fix; --fix renames. Exit 2 when
  // something is left, so CI can flag it.
  // `doctor --check`: is the install healthy (Node, git, gh, skill files, hooks, pm/sources.json)? Runs health.mjs directly so a broken skill folder can't stop it. Exit 2 on a hard failure.
  doctor: () => { const r = args.includes("--check") ? script("health.mjs", ["--pm", pm, ...args.filter(a => a !== "--check")]) : script("doctor.mjs", [pm, ...args.filter(a => ["--fix", "--dry-run", "--undo", "--force"].includes(a))]); if (r.code === 2) process.exitCode = 2; return r; },
  // The owner's never rules against a change about to ship (staged by default; --last-commit, --worktree,
  // --base <ref>). Exit 2 on a match, so it can sit in a git pre-commit hook or CI.
  "never-check": () => { const r = script("never-check.mjs", [pm, ...process.argv.slice(3).filter((a, i, all) => a !== "--pm" && all[i - 1] !== "--pm")]); if (r.code === 2) process.exitCode = 2; return r; },
  // The product's hard facts, computed once (pm/state/facts.md + facts/*.json): commits by person/kind/area for
  // the last 7 days and the month, branches with content not in the integration branch, every issue and PR.
  facts: () => script("facts.mjs", [pm, "build", ...process.argv.slice(3).filter((a, i, all) => a !== "--pm" && all[i - 1] !== "--pm")]),
  // What each rival put out in a window, from the registry's release notes / newsroom / blog pages (leads, not verdicts).
  sweep: () => { const r = script("rival-sweep.mjs", [pm, ...process.argv.slice(3).filter((a, i, all) => a !== "--pm" && all[i - 1] !== "--pm")]); if (r.code === 2) process.exitCode = 2; return r; },
  // Matrix proposals the neighbor agents wrote (pm/state/matrix-proposals.json): `check` sorts them by evidence, `apply` writes only the ones
  // that earned it (after a backup), `undo` puts the matrix back.
  "matrix-proposals": () => { const sub = args[0] && !args[0].startsWith("-") ? args[0] : "check"; return script("matrix-proposals.mjs", [sub, pm, ...(sub === args[0] ? args.slice(1) : args)]); },
  // Which rivals get a full research pass, which are only watched, which get a thin read, and what that costs.
  tiers: () => { const a = args.filter(x => x !== "plan"); return script("rival-tiers.mjs", ["plan", pm, ...a, ...(a.includes("--json") ? [] : ["--json", path.join(pm, "state", "rival-tiers.json")])]); },
  // Every place a word appears: the whole repo (any case, Turkish letters either way) and every issue/PR. Exit 2: nowhere.
  find: () => { const r = script("facts.mjs", [pm, "find", ...process.argv.slice(3).filter((a, i, all) => a !== "--pm" && all[i - 1] !== "--pm")]); if (r.code === 2) process.exitCode = 2; return r; },
  // Every file:line, quote, commit and #ref in an answer draft, checked before it goes out. Exit 2 when one
  // doesn't hold up.
  "cite-check": () => { const r = script("cite-check.mjs", [pm, ...process.argv.slice(3).filter((a, i, all) => a !== "--pm" && all[i - 1] !== "--pm")]); if (r.code === 2) process.exitCode = 2; return r; },
  // Puts the skill where each coding agent in the project reads skills (install.mjs); update / uninstall touch only
  // folders it wrote. Runs without pm/.
  // The after-commit nudge and the never-rule check as git hooks, for agents without hooks of their own (git-hooks.mjs). Runs without pm/.
  "git-hooks": () => script("git-hooks.mjs", process.argv.slice(3).filter((a, i, all) => a !== "--pm" && all[i - 1] !== "--pm").concat(["--pm", pm])),
  install: () => script("install.mjs", ["install", ...process.argv.slice(3)]),
  update: () => script("install.mjs", ["update", ...process.argv.slice(3)]),
  uninstall: () => script("install.mjs", ["uninstall", ...process.argv.slice(3)]),
  // setup also opens an empty matrix (the product's own column, no rows yet) so `nosy check` doesn't fail on a missing
  // file right after setup; move-in step 4 or neighbors fills the rows and the rival columns.
  setup: () => {
    const r = script("find-sources.mjs", [args[0] || ".", "--pm", pm, "--write"]);
    const mx = path.join(pm, "matrix.json");
    if (fs.existsSync(path.join(pm, "sources.json")) && !fs.existsSync(mx)) {
      let name = path.basename(path.resolve(args[0] || "."));
      try { name = JSON.parse(fs.readFileSync(path.join(args[0] || ".", "package.json"), "utf8")).name?.replace(/^@[^/]+\//, "") || name; } catch {}
      fs.writeFileSync(mx, JSON.stringify({ steps: [], biz: { name, codes: {} }, products: [] }, null, 1) + "\n");
      console.log(`\nOpened ${mx}: empty for now (move-in step 4 writes the product's feature rows, neighbors the rival columns).`);
    }
    return r;
  },
  check: () => sourceRequired({ repo: false }) && script("verify-setup.mjs", [pm]), // it reports an unreadable repo or ref itself, as a table row
  // The named rule catalog (skill/data/rules.json): no args lists id/name/one-liner; an id prints the
  // full rule (why, enforcedBy, tests); an unknown id prints the closest ids and exits 1. No pm needed.
  explain: () => { const r = script("explain.mjs", [...args]); if (r.code !== 0) process.exitCode = r.code; return r; },
  inventory: () => sourceRequired() && script("inventory.mjs", [pm, "--json", path.join(pm, "state", "inventory.json")]),
  gates: ({ silent } = {}) => sourceRequired() && script("plan-gates.mjs", [pm, "--json", path.join(pm, "state", "plan-gates.json")], { silent }),
  metrics: ({ silent } = {}) => sourceRequired() && script("scan-metrics.mjs", [pm, "--json", path.join(pm, "state", "metrics.json")], { silent }),
  // psst's check step, one command each: usually `nosy psst` runs the first two.
  "team-next": () => sourceRequired() && script("team-next.mjs", [pm, ...args, "--json", path.join(pm, "state", "team-next.json")]),
  fields: () => sourceRequired() && script("fields.mjs", [sources().repo || ".", ...args]),
  receipts: () => sourceRequired() && script("psst-receipts.mjs", [pm, ...args, "--json", path.join(pm, "state", "receipts.json")]),
  refute: () => {
    if (!["pack", "apply"].includes(args[0])) { console.error("Usage: nosy refute pack · nosy refute apply   (psst.md step 3: pack → the nosy-refuter agent → pm/state/refute.json → apply)"); process.exitCode = 1; return; }
    return sourceRequired({ repo: false }) && script("psst-refute.mjs", [args[0], pm, ...args.slice(1)]);
  },
  decision: () => sourceRequired() && script("next-decision.mjs", [pm, ...args]),
  nudge: () => sourceRequired() && script("nudge.mjs", [pm, ...args]),
  frontyard: () => sourceRequired() && script("frontyard.mjs", [pm, ...args, "--json", path.join(pm, "state", "frontyard.json")]),
  // Rival language: are the loop matrix's steps still just Nosy's own framing, or do
  // rivals' own homepage claims (pm/rivals/*.md's "## Featured on the landing page") actually back each one up.
  "rival-language": () => fs.existsSync(path.join(pm, "rivals")) ? script("rival-language.mjs", [pm, ...args, "--json", path.join(pm, "state", "rival-language.json")]) : (console.log(`Psst… no ${path.join(pm, "rivals")}/ yet: run neighbors first.`), { code: 0 }),
  // Demand signal: collect-signals runs whenever there is something to read (pm/signal/ or
  // sources.json signal.path has files, or the product has a GitHub issue repo). It reads psst's list, so psst runs
  // first, then again once signals.json exists: "asked for + ready" is ranked by the second pass.
  signals: ({ silent } = {}) => {
    if (!sourceRequired()) return;
    const K = sources(), inputs = demandInputs(pm, K), gh = !!K.issue?.repo;
    if (interviewInputs(pm, K).length) Commands.interviews({ silent: true });
    if (!inputs.length && !gh) { if (!silent) console.log(`Psst… no demand input: drop support/interview/survey exports in ${path.join(pm, "signal")}/ (or set sources.json signal.path).`); return { code: 0, output: "" }; }
    return script("collect-signals.mjs", [pm, ...(gh ? ["--gh"] : []), "--json", path.join(pm, "state", "signals.json")], { silent });
  },
  // Interview and call notes into themes with receipts.
  interviews: ({ silent } = {}) => sourceRequired() && script("interview-themes.mjs", [pm, ...(silent ? [] : args), "--json", path.join(pm, "state", "interviews.json")], { silent }),
  // Rival watch (matrix step 3): public rival pages vs the last snapshot in pm/history/watch/;
  // the only command besides notify that goes to the network, and it only reads public pages.
  // After a run, rival-tiers.mjs logs the states (pm/history/watch-states.jsonl): the watch keeps only its latest snapshot, and "changed 3 times in 4" needs the history.
  watch: () => { if (!fs.existsSync(path.join(pm, "rivals"))) return (console.log(`Psst… no ${path.join(pm, "rivals")}/ yet: ${typeof sources()?.rivalsPath === "string" && sources().rivalsPath.trim() ? `\`${nosyCommand("rivals-import")}\` copies the rival files from \`rivalsPath\` in, then run this again` : "run neighbors first"}.`), { code: 0 }); const r = script("watch-rivals.mjs", [pm, ...args, "--json", path.join(pm, "state", "watch.json")]); if (r.code === 0) script("rival-tiers.mjs", ["record", pm], { silent: true }); return r; },
  // Did a rival grow? Public counters (GitHub, npm, App Store, open roles) with history: run | init | note | notes. Reads public APIs only, never LinkedIn.
  "rival-signals": () => { const [sub, ...rest] = args, named = sub && !sub.startsWith("--"); return script("rival-signals.mjs", [named ? sub : "run", pm, ...(named ? rest : args)]); },
  // Rival demand: what the users of open-source rivals ask for (open issues and Discussions, by votes), from their public trackers.
  // Repos: --repos, sources.json rivalRepos, or GitHub links in pm/rivals/*.md. Discussions need gh or GH_TOKEN. No model.
  "rival-demand": () => script("rival-demand.mjs", [pm, ...args, "--json", path.join(pm, "state", "rival-demand.json")]),
  // psst silently refreshes the plan-gate, metrics, waiting-screen and demand scans first (signals 7, 8, 9 and the demand column read these files).
  psst: () => {
    if (!sourceRequired()) return;
    fs.mkdirSync(path.join(pm, "state"), { recursive: true });
    Commands.gates({ silent: true }); Commands.metrics({ silent: true });
    script("pending-backend.mjs", [pm, "--json", path.join(pm, "state", "pending.json")], { silent: true }); // signal 9
    script("team-next.mjs", [pm, "--json", path.join(pm, "state", "team-next.json")], { silent: true }); // signal 10
    const K = sources();
    if (demandInputs(pm, K).length || K.issue?.repo) {
      script("lowhanging.mjs", [pm, "--json", path.join(pm, "state", "lowhanging.json")], { silent: true });
      Commands.signals({ silent: true });
    }
    const R = script("lowhanging.mjs", [pm, "--json", path.join(pm, "state", "lowhanging.json")]);
    // The owner's standing calls (learn.mjs: noise / knowingly / important) apply on every run, not only when an agent
    // remembers psst.md step 2: a row marked "knowingly" must not come back as the next decision.
    if (fs.existsSync(path.join(pm, "learned.json"))) script("learn.mjs", [pm, "apply", path.join(pm, "state", "lowhanging.json")], { silent: true });
    // work already written on the owner's own unpushed branches. `facts` lists every unmerged branch with the
    // files merging it would change; receipts join an item to it. Refreshed when missing or older than 12 hours (a week-old branch
    // list would call finished work "not started"); a failure is silent, and receipts then say "local work not checked".
    { const bj = path.join(pm, "state", "facts", "branches.json");
      if (!fs.existsSync(bj) || Date.now() - fs.statSync(bj).mtimeMs > 12 * 3600e3) script("facts.mjs", [pm, "build", ...(process.env.NOSY_OFFLINE ? ["--no-gh"] : [])], { silent: true }); }
    // the check step's receipts for the top items, next to the list.
    const out = spawnSync(process.execPath, [path.join(Tool, "psst-receipts.mjs"), pm, "--json", path.join(pm, "state", "receipts.json")], { encoding: "utf8", maxBuffer: 64 << 20 });
    if (out.status === 0 && out.stdout) { fs.writeFileSync(path.join(pm, "state", "receipts.md"), out.stdout); console.log(`\nReceipts for the top items (check each before listing it): ${path.join(pm, "state", "receipts.md")}`); }
    // Say plainly what this list is: an unchecked draft until the refuter runs (a CLI, Action or MCP user only sees this).
    const rj = (() => { try { return JSON.parse(fs.readFileSync(path.join(pm, "state", "receipts.json"), "utf8")); } catch { return null; } })();
    const tn = (() => { try { return JSON.parse(fs.readFileSync(path.join(pm, "state", "team-next.json"), "utf8")); } catch { return null; } })();
    const held = (rj?.items || []).filter(r => r.gate?.held).length, teamItems = tn?.items?.length || 0;
    const started = (rj?.items || []).filter(r => r.inProgress).length; // written on a local branch or edited right now
    const listed = (() => { try { return JSON.parse(fs.readFileSync(path.join(pm, "state", "lowhanging.json"), "utf8")).items.length; } catch { return 0; } })();
    if (listed) console.log(`Unchecked draft: ${held} held on purpose (not cheap work), ${started ? `${started} already started locally (branch or uncommitted edits, see the receipts), ` : rj && !rj.localWork?.checked ? "local branches not checked (run `nosy facts`), " : ""}${teamItems} from the team's own notes${tn?.files?.length ? ` (${tn.files.join(", ")})` : ""}. To check it: \`nosy refute pack\` → the nosy-refuter agent → \`nosy refute apply\` (psst.md step 3); then \`nosy decision\` for the one next product decision.`);
    return R;
  },
  // The first look in one go (tour.mjs): the welcome, the walk with each step's state, one list of questions.
  // `tour approve <id>...` / `tour done <id>` record progress in pm/state/tour.json. It runs no step itself: the agent does, in order.
  tour: () => script("tour.mjs", [pm, ...args]), // `args` has --pm taken out wherever it stood (`nosy --pm x tour` too)
  // Rival research kept outside pm/rivals, copied in (rivals-import.mjs): `--from <folder>` or sources.json `rivalsPath`; `--dry-run` lists.
  "rivals-import": () => script("rivals-import.mjs", [pm, ...args]),
  // The roadmap, in the repo (roadmap.mjs): a preview of the Now / Next / Later block, `--check` (is ROADMAP.md current on the
  // integration branch), `--pr --yes` (a pull request that edits only that block, or updates the one still open; nothing is pushed without --yes), `--lang <code>`.
  roadmap: () => sourceRequired() && script("roadmap.mjs", [pm, ...process.argv.slice(3).filter((a, i, all) => a !== "--pm" && all[i - 1] !== "--pm")]),
  // Bets (N3): `bet` places one and prints its id; `score` settles every bet from git (explicit links only).
  bet: () => {
    if (!args.length) { console.error('Usage: nosy bet place "<what>" --why "…" --estimate S|M|L [--rests-on K12] [--expect "…"] · nosy bet list · nosy bet drop <id> --reason "…"'); process.exitCode = 1; return; }
    return sourceRequired({ repo: false }) && script("bet.mjs", [pm, ...process.argv.slice(3).filter((a, i, all) => a !== "--pm" && all[i - 1] !== "--pm")]);
  },
  score: () => sourceRequired() && script("score.mjs", [pm, ...args.filter(a => a === "--include-backfill"), "--json", path.join(pm, "state", "score.json")]),
  // Todo: what only a person can do, or said they would do (todo.mjs). No arguments (or `list`) lists what waits; `add`, `done`,
  // `drop`, `show` change one item's file under pm/todo/. Nothing is sent anywhere, and no copy of the titles goes into pm/state/
  // (the Action commits that folder); `list --json <file>` writes one where you point it.
  todo: () => {
    if (!sourceRequired({ repo: false })) return;
    const a = process.argv.slice(3).filter((x, i, all) => x !== "--pm" && all[i - 1] !== "--pm");
    const act = !a.length || a[0].startsWith("--") ? ["list", ...a] : a;
    return script("todo.mjs", [pm, ...act]);
  },
  canwe: () => {
    if (!args.length) { console.error('Usage: nosy canwe "<question>"'); process.exitCode = 1; return; }
    return sourceRequired() && script("canwe.mjs", [pm, ...args]);
  },
  peek: () => {
    if (!sourceRequired()) return;
    // No end-ref given: collect-status.mjs detects the integration branch itself from --pm's sources.json.
    const K = sources(), r = script("collect-status.mjs", [K.repo || ".", start(since || args[0]), "--pm", pm, "--json", path.join(pm, "state", "status.json")]);
    if (r.code === 0 && r.output) statusWrite(`${today}-delivery.md`, r.output);
    return r;
  },
  notes: () => sourceRequired() && script("write-notes.mjs", [pm, start(since || args[0]), "--audience", target || "customer"]),
  // Recency (wave N2): merged since the last run (incremental, pm/history/runs.jsonl) + open PRs close to
  // merging (approved / green CI), each tied to its decision/request/issue via refs.mjs. `overheard`'s
  // "which decision does this PR serve" question now lives here as a standing view.
  // --since is a global flag (already pulled out of argv above into `since`); passed through explicitly
  // since recent.mjs has its own --since/--days/--branch options.
  recent: () => sourceRequired() && script("recent.mjs", [pm, ...(since ? ["--since", start(since)] : []), ...args, "--json", path.join(pm, "state", "recent.json")]),
  // The record: peek's core plus explicit links and recent merges (overheard's "which decision does this PR serve").
  // 1) explicit issue↔PR links (shipped-links.mjs) when that tool is installed; 2) what reached the
  // integration branch, grouped by the decision/request each change references (collect-status, peek's core);
  // 3) what merged since the last run and what's close to merging (recent.mjs, N2). Explicit links only throughout.
  // these are TWO DIFFERENT QUESTIONS ("which decisions were explicitly linked to their
  // shipped work" vs "what landed on the branch, grouped by any ref it happens to carry") that used to share
  // one implicit heading — a run that showed "0 shipped" (nothing explicitly linked) right above an 85-row
  // table of ref-tagged commits read as a flat contradiction. Each section now gets its own heading naming
  // its own question, and when the first is 0 while the second isn't, a one-line note explains why (the
  // record below isn't wrong; it's just answering the other question) and points at the link convention.
  shipped: () => {
    if (!sourceRequired()) return;
    const codes = [];
    // Explicit links (N1): shipped-links.mjs is a library; its runnable writer is
    // shipped-record.mjs. Two modes: a GitHub issue tracker (sources.json issue.repo, needs gh), or a
    // decisions-log record (K.preread.decisions, e.g. KARARLAR.md — no GitHub issues at all). A decisions
    // doc wins when there's no issue.repo to fall back to, or when --decisions is passed explicitly; a
    // failure here is reported, not fatal (the git record below still stands).
    const K = sources(), writer = [path.join(Tool, "shipped-record.mjs"), path.join(Tool, "..", "..", "experiments", "backfill-history.mjs")].find(f => fs.existsSync(f));
    const decisionsMode = !!K.preread?.decisions && (decisionsFlag || !K.issue?.repo);
    // Parses the "N shipped"/"N decided...shipped" count off the writer's own summary line (which follows
    // an "Integration branch: …" line, so it isn't always the first line of stdout); null when the headline
    // itself was withheld (missing link kinds) — there's nothing to contradict in that case.
    // "explicit links not read": the reason, and (hints.mjs) the fix when it's a known one: gh missing or signed out, no network, no remote.
    const notRead = err => { const fix = advice(err); return fix ? `(explicit links not read. ${fix} The record below still stands.)` : `(explicit links not read: ${err.trim().split("\n")[0].slice(0, 120)}; the record below still stands)`; };
    const shippedCountOf = out => { const m = /(\d+)\s+shipped\b/.exec(out || ""); return m ? +m[1] : null; };
    let explicitShipped = null, explicitSource = null;
    if (decisionsMode && writer && !process.env.NOSY_OFFLINE) {
      console.log("── Decisions that shipped (explicit links: commit names the decision) ──");
      const r = spawnSync(process.execPath, [writer, K.repo || ".", "--decisions", K.preread.decisions, "--pm", pm, "--day", "30", "--shipped-json", path.join(pm, "state", "shipped.json")], { encoding: "utf8", maxBuffer: 64 << 20 });
      process.stdout.write(r.stdout || ""); if (r.status !== 0) console.log(notRead(r.stderr || "shipped-record.mjs failed"));
      else { explicitShipped = shippedCountOf(r.stdout); explicitSource = K.preread.decisions; }
    } else if (K.issue?.repo && writer && !process.env.NOSY_OFFLINE) {
      console.log("── Decisions that shipped (explicit links: issue ↔ PR) ──");
      const r = spawnSync(process.execPath, [writer, K.repo || ".", K.issue.repo, "--day", "30", "--pm", pm, "--shipped-json", path.join(pm, "state", "shipped.json")], { encoding: "utf8", maxBuffer: 64 << 20 });
      process.stdout.write(r.stdout || ""); if (r.status !== 0) console.log(notRead(r.stderr || "gh failed"));
      else { explicitShipped = shippedCountOf(r.stdout); explicitSource = K.issue.repo; }
    } else if (!K.issue?.repo && !K.preread?.decisions) console.log("(no GitHub repo and no decisions doc in sources.json: the record below uses the references in commits and merges only)");
    console.log("\n── Work that landed, by reference (any ref-tagged commit — not the same question as above) ──");
    codes.push(Commands.peek()?.code ?? 1);
    if (explicitShipped === 0) {
      let landedRefs = 0;
      try { landedRefs = (JSON.parse(fs.readFileSync(path.join(pm, "state", "status.json"), "utf8")).groups || []).length; } catch {}
      if (landedRefs > 0) {
        const hint = decisionsMode
          ? "link convention: put the decision's id (e.g. K123) in the landing commit's own message"
          : "link convention: reference the issue with \"Closes #N\" (or \"#N\") in the merged PR";
        console.log(`(${landedRefs} reference${landedRefs === 1 ? "" : "s"} landed above, but none names a decision in ${explicitSource}; the two counts are answering different questions — ${hint})`);
      }
    }
    console.log("\n── recent: merged since the last run, and close to merging ──");
    codes.push(Commands.recent()?.code ?? 1);
    return { code: codes.every(c => c === 0) ? 0 : 1 };
  },
  // Closes the loop with the people who asked: one comment on each issue a merged PR closed (GitHub's own closing links), shown first,
  // posted only with --yes (ship-notes.mjs). --since is a global flag (pulled out of argv above): a tag or a date, passed through as written.
  "ship-notes": () => sourceRequired() && script("ship-notes.mjs", [pm, ...(since ? ["--since", since] : []), ...args]),
  // The page: the decision page by default (tea); --scoreboard builds the bets/shipped scoreboard from pm/state/shipped.json.
  page: () => {
    // No pm/ at all: say so and how to make one, instead of failing on the file it can't write.
    if (!fs.existsSync(pm) || (!fs.existsSync(path.join(pm, "sources.json")) && oldLayout(pm).length)) { console.error(`Psst… ${sourcesProblem(pm)}`); process.exitCode = 1; return; }
    // The scoreboard is its own file (pm/scoreboard.html): it never overwrites the decision page.
    if (scoreboardPage) {
      if (fs.existsSync(path.join(pm, "state", "shipped.json"))) return script("scoreboard.mjs", [pm, args[0] || path.join(pm, "scoreboard.html")]);
      console.log(`(no record yet: pm/state/shipped.json is written by \`${nosyCommand("shipped")}\`; building the decision page instead)`);
    }
    return script("build-page.mjs", [pm, args[0] || path.join(pm, "page.html")]);
  },
  // A hand-built page: adopt finds its tables and says which Nosy data could feed each (read only; --apply --yes
  // marks them), refresh rewrites only the marked tables from the current data, undo puts the newest page backup back (adopt-page.mjs).
  "page-adopt": () => {
    const a = args;
    if (!["adopt", "refresh", "undo"].includes(a[0])) { console.error("Usage: nosy page-adopt adopt [--page f] [--apply --yes] · nosy page-adopt refresh [--page f] [--dry-run] · nosy page-adopt undo [--page f] [--force]"); process.exitCode = 1; return; }
    return sourceRequired({ repo: false }) && script("adopt-page.mjs", [a[0], pm, ...a.slice(1)]);
  },
  // Weekly model-free cycle, inside to outside: inventory → shipped → psst → score (if pm/bets/) → rival watch (if
  // rival files; NOSY_OFFLINE=1 skips it) → page. --short: shipped → score → page only. If one fails, the others still run.
  weekly: () => {
    if (!sourceRequired()) return;
    const result = [];
    const bets = fs.existsSync(path.join(pm, "bets")), rivals = fs.existsSync(path.join(pm, "rivals")) && !process.env.NOSY_OFFLINE;
    const steps = short ? ["shipped", ...(bets ? ["score"] : []), "page"] : ["inventory", "shipped", "psst", ...(bets ? ["score"] : []), ...(rivals ? ["watch"] : []), "page"];
    for (const k of steps) {
      console.log(`\n── nosy ${k} ──`);
      const r = Commands[k]();
      // ✓ ran clean · ! ran and found something to look at (exit 2) · ✗ couldn't run
      result.push(`${k}: ${!r ? "✗" : r.code === 0 ? "✓" : r.code === 2 ? "!" : "✗"}`);
    }
    console.log(`\n${result.join(" · ")}`);
    process.exitCode = result.some(s => s.endsWith("✗")) ? 1 : result.some(s => s.endsWith("!")) ? 2 : 0;
  },
  notify: async () => {
    const { messageSetup, cleanMi, send } = await import("./news.mjs");
    const slack = al("--slack") || process.env.NOSY_SLACK_WEBHOOK, discord = al("--discord") || process.env.NOSY_DISCORD_WEBHOOK;
    const dry = flag("--dry-run") || (!slack && !discord), allowSensitive = flag("--allow-sensitive");
    const notes = path.join(pm, "state", "notes.json");
    if (sources()) script("write-notes.mjs", [pm, start("7d"), "--audience", "customer", "--json", notes], { silent: true });
    const message = messageSetup(pm, { notes });
    if (!message) { console.log("Psst… nothing to say (pm/state is empty). Run this first: nosy weekly"); return; }
    if (!dry && !cleanMi(message, pm, { allow: allowSensitive })) { console.error("The message contains a secret or personal data (listed above); not sent. Check it with --dry-run. Only if it is fine to send: --allow-sensitive."); process.exitCode = 1; return; }
    if (dry) { console.log(message); if (!cleanMi(message, pm)) console.error("\n(A real send would stop here: the scan found a secret or personal data, listed above.)"); if (!slack && !discord) console.error("\n(No webhook given, printed only: --slack <url> / --discord <url> or NOSY_SLACK_WEBHOOK / NOSY_DISCORD_WEBHOOK)"); return; }
    for (const [name, url] of [["Slack", slack], ["Discord", discord]]) if (url) {
      const ok = await send(name, url, message);
      console.log(`${name}: ${ok ? "sent" : "failed (no network, or the webhook URL is wrong or was revoked: check it, then run notify again; --dry-run prints the message)"}`);
      if (!ok) process.exitCode = 1;
    }
  },
  publish: () => script("publish.mjs", [pm, ...args]),
  // The version of this copy (the repo's package.json, the plugin manifest or the marker `nosy install` wrote).
  version: () => { console.log(`nosy ${versionOf()}`); },
  mcp: async () => { await import("./mcp.mjs"); },
  help: () => console.log(`Nosy · Nosy about your product. Never your data.

Model-free counts (judgment stays with the agent; these just gather evidence):
  nosy [next]              what to run now: 2-3 steps with the reason for each, then the menu (read-only)
  nosy doctor [--fix]      a pm/ from an older Nosy: old names and keys (--fix lists, backs up to pm/.backup/, then renames; --fix --dry-run only lists; --undo puts it back), files to re-run
  nosy doctor --check      is my install healthy? Node (18.17+), git, gh, skill files, hooks, pm/sources.json; each problem carries its fix (exit 2 on a hard failure)
  nosy never-check [--last-commit|--base ref]   the owner's never rules against a change about to ship (exit 2 on a match)
  nosy facts [--now YYYY-MM-DD] [--no-gh]   the hard facts once: commits by person/kind/area, branches with content not in base, every issue/PR (pm/state/facts.md)
  nosy sweep [--days 30] [--only slug,…]   each rival's dated release notes / news / blog entries in the window (sources.json rivals)
  nosy matrix-proposals [check|apply|undo] [--dry-run]   the neighbor agents' proposed matrix cells sorted by evidence; apply writes only the ones that earned it (backup first, undo puts it back)
  nosy tiers [--json]      which rivals get a full research pass (tier A), which are only watched (B) or read thinly (C), who needs work now, and the token estimate (read-only; nosy watch records the watch states)
  nosy find <word> [more]  every place a word appears: whole repo (any case, Turkish letters either way) and every issue/PR (exit 2: nowhere)
  nosy cite-check <answer.md> [--gh]   every file:line, quote, commit and #ref in an answer checked (exit 2 when one doesn't hold)
  nosy git-hooks <install|uninstall|status> [--dry-run]   the after-commit nudge and never-rule check as git hooks, for agents without hooks (Codex, Cursor…)
  nosy install [--providers claude,codex,cursor,…] [--global] [--dry-run] [--git-hooks]   the skill into each agent's folder here (+ the git hooks)
  nosy update · nosy uninstall   refresh / remove only what install wrote
  nosy setup [repo]        writes a pm/sources.json proposal (the scripted part of move-in)
  nosy check               verifies the paths in sources.json against the repo
  nosy explain [id]        the named rule catalog: no id lists them, an id prints the full rule (why, enforcedBy, tests)
  nosy peek [7d|date|ref]  what actually shipped, from git → pm/state/
  nosy inventory           endpoint ↔ screen inventory → pm/state/inventory.json
  nosy gates               are recently shipped features tied to a plan → pm/state/plan-gates.json
  nosy metrics             do the key steps (signup, activation, revenue…) fire events → pm/state/metrics.json
  nosy frontyard [--page f] are shipped features on the landing page → pm/state/frontyard.json
  nosy rival-language      are the matrix's steps in rivals' own words, from their landing pages → pm/state/rival-language.json
  nosy interviews          interview/call notes in pm/signal/interviews/ → themes with receipts → pm/state/interviews.json
  nosy signals             demand from pm/signal/ exports (+ GitHub issues) → pm/state/signals.json
  nosy psst                cheap and valuable work (gates, metrics, waiting screens, the team's notes) → pm/state/lowhanging.json + receipts.md (an unchecked draft)
  nosy team-next           the team's own working notes (psst signal 10) → pm/state/team-next.json
  nosy fields <From> <To>  which fields one type carries and the next drops (Go structs, TS types), with file:line
  nosy receipts            the check-step receipts for psst's top items (held on purpose, decisions, merged?, which apps) → pm/state/receipts.json
  nosy refute pack|apply   psst's refuter: pack the draft for the nosy-refuter agent; apply its verdicts → pm/state/psst-final.json
  nosy decision            the one next product decision (same as the after-commit nudge and the first report say)
  nosy nudge [--since ref] what the last commit means for the product: the matrix gap it may close, the next decision
  nosy canwe "<question>"  an evidence skeleton for "can we do this?"
  nosy notes [7d] [--for customer|team|manager]   shareable release notes
  nosy recent [--since d|date] [--days N] [--branch b]   merged since the last run + close to merging
  nosy page [output.html]  the decision page (default pm/page.html); --scoreboard: the bets/shipped scoreboard (default pm/scoreboard.html)
  nosy page-adopt adopt|refresh|undo   keep a hand-built page current: adopt lists its tables and the Nosy data that fits each (--apply --yes marks them), refresh rewrites only the marked tables, undo restores the page backup
  nosy watch               which rivals' public pages changed since the last run
  nosy rival-signals [run|init|note|notes]   did a rival grow? GitHub stars/releases/commits, npm downloads, App Store rating, open roles, against the last 28 days → pm/state/rival-signals.json (init proposes the config; note keeps a sourced observation)
  nosy rival-demand [--repos o/r,…]   what your open-source rivals' users ask for, by votes (issues + Discussions) → pm/state/rival-demand.json
  nosy bet place "<what>" --why "…" --estimate S|M|L   place a bet; prints the id to put in the commit/PR (Bet: nb-…)
  nosy score               settle bets from git (landed, reverted, patched, partial) → pm/state/score.json
  nosy todo [list|add|done|drop|show]   what only a person can do, or said they would: add "<what>" --who ali --why "…" --blocks "…" · done <id> (files under pm/todo/; nothing is sent)
  nosy shipped [7d]        decisions that shipped (explicit links) + work that landed by reference, + recent (merged / close)
  nosy ship-notes [--since tag|date] [--days N] [--json f] [--yes]   tell the people who asked that it shipped: one comment per issue a merged PR closed, shown first, posted only with --yes
  nosy rivals-import [--from folder] [--dry-run]   copy rival research kept outside pm/rivals (sources.json rivalsPath) into pm/rivals, originals stay
  nosy roadmap [--check | --pr --yes] [--lang tr]   Now / Next / Later (scoop's waves and/or your GitHub labels, milestones, project board; read-only) as a block of ROADMAP.md: a preview (also pm/state/roadmap.json), a check against the integration branch, or a PR that edits only that block (an open Nosy roadmap PR is updated, not duplicated)
  nosy tour                the first look in one go: what Nosy reads, writes and sends, the steps with their state, one list of questions (tour approve|skip|done <id> records progress)
  nosy weekly [--short]    inventory → shipped → psst → score (if pm/bets/) → rival watch → page; --short: shipped → score → page
  nosy notify [--slack url] [--discord url] [--dry-run] [--allow-sensitive]   this week's "Psst…" summary (a secret or personal data stops it)
  nosy publish [--project name] [--url address] [--token-file path] [--dry-run [--full]] [--yes] [--allow-sensitive]   send counts and structure of pm/ (no quotes) to a Nosy Cloud you configured (cloud.url or NOSY_CLOUD_URL; the token from NOSY_CLOUD_TOKEN, --token-file, or ~/.config/nosy/token); asks first, --dry-run shows exactly what would go
  nosy mcp                 MCP server (stdio) — Cursor, Claude Desktop, Zed…
  nosy version             which Nosy this is (also --version, -v)

Shared: --pm <folder> (default ./pm or NOSY_PM).
For the full agent-driven cycle (rivals, PRD, roadmap) use the skill: skill/SKILL.md.`),
};

const f = Commands[command];
if (!f) {
  const near = closest(command, Object.keys(Commands));
  console.error(`Unknown command: ${command}.${near ? ` Did you mean \`${nosyCommand(near)}\`?` : ""} \`${nosyCommand("help")}\` lists them all.`);
  process.exitCode = 1;
}
else {
  // Exit contract (docs/CLI-CONTRACT.md): 0 nothing needs attention · 1 couldn't run · 2 ran and found something.
  // A command that returns a script's result passes its code on, unless the command already set one.
  const r = await f();
  if (r && (r.code === 1 || r.code === 2) && !process.exitCode) process.exitCode = r.code;
}
