// psst-receipts: the check step, forced by receipts. psst blind re-run v5 lost on checking,
// not finding: Nosy recommended merging a branch a later decision (K164) had overruled, called a pricing page "data
// entry" though the screen's own `need` said the plan fields don't exist, and sized a cross-service change as one wire.
// Each of those was checkable from files Nosy already reads. This script puts them next to every top psst item, so
// the agent answers from receipts instead of its own diligence.
// Usage: node psst-receipts.mjs <pm folder> [--top 30] [--json <file>]   (reads pm/state/lowhanging.json, pending.json)
// Per item, all structural (no word lists; the language audit):
//   request    the request document's own section for each §N ref (its gaps and "needed" lines say what's missing)
//   decisions  decisions whose number is the ref, or whose text names one of the item's refs; dated by git blame
//   history    commit hashes and branch names the texts mention: merged into ref or not, and a branch whose tip is
//              older than a decision the item touches is flagged (it may implement what the decision replaced)
//   code       the code's own words at the item's evidence: the evidence line and the comment lines
//              right above it, verbatim, plus decisions that name that file. A comment there that carries a ref (#385,
//              K178) or a decision naming the file puts the item behind a gate: it was held on purpose until shown
//              otherwise. Blind re-run v6's only loss was such an item ("a screen decision, not a missing read, #385").
//              A #N that is an issue in pm/state/facts/github.json is a ticket, not a parking sign:
//              it is listed under `ticketed` (open: tracked and ready; closed: check it was finished) and holds nothing.
//   local      work already written on a branch the integration branch lacks, or uncommitted in a working tree (internal request
//              195, local-work.mjs): matched by a file in common or a reference in the branch's commit subjects. On the first
//              run on a real product 3 of 5 draft items were already done on the owner's own unpushed branches.
//   reach      code identifiers the texts name (`backticked`, snake_case, camelCase, name[]): which top-level apps
//              contain each one at ref. An identifier absent from an app the change must reach means a cross-app change.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { patternsOfLoad, refRegex } from "./refs.mjs";
import { decisionsOfRead } from "./read-decisions.mjs";
import { readSourcesSafe } from "./sources-file.mjs";
import { loadLocalWork, pushedNames, matchBranchesDetailed, workingTreeScan, editsIn, formatLocal } from "./local-work.mjs";

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };
const uniq = a => [...new Set(a.filter(Boolean))];
const day = t => t ? new Date(t).toISOString().slice(0, 10) : "?";

export function receipts(pm, { top = 30 } = {}) {
  const K = readSourcesSafe(pm);
  const L = readJson(path.join(pm, "state", "lowhanging.json"));
  if (!K || !L) return null;
  const repo = K.repo || ".", ref = K.ref || "HEAD";
  const git = (...a) => { try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
  const ok = (...a) => { try { execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" }); return true; } catch { return false; } };
  const refRe = refRegex(patternsOfLoad(K));
  const refsIn = s => { refRe.lastIndex = 0; return uniq(String(s || "").match(refRe) || []); };

  // Request document sections, by number ("### 26. …" → 26), when the product has one.
  const sections = new Map();
  if (K.request?.path && K.request?.title) {
    const doc = git("show", `${ref}:${K.request.path}`) || "", hRe = new RegExp(K.request.title, "gm"), heads = [];
    let m; while ((m = hRe.exec(doc))) heads.push({ no: m[1], at: m.index, line: doc.slice(0, m.index).split("\n").length });
    heads.forEach((h, i) => sections.set(String(h.no), { no: h.no, line: h.line, text: doc.slice(h.at, heads[i + 1]?.at ?? doc.length).trim() }));
  }
  const sectionOf = r => { const m = String(r).match(/^§\s*(\d+[a-z]?)$/); return m ? sections.get(m[1]) : null; };

  // Decisions, each dated by the commit that wrote its heading line (git blame): language-independent.
  let decisions = []; try { decisions = decisionsOfRead(K); } catch {}
  const dated = new Map();
  const dateOf = d => {
    if (!dated.has(d)) { const b = git("blame", "--porcelain", "-L", `${d.line},${d.line}`, ref, "--", d.file) || ""; const t = b.match(/^author-time (\d+)/m); dated.set(d, t ? +t[1] * 1000 : null); }
    return dated.get(d);
  };

  // Branches: every local and remote branch name, to spot the ones a text mentions.
  const shortName = b => b.replace(/^(origin|upstream|remotes\/[^/]+)\//, "");
  const trunk = new Set(["main", "master", "develop", "HEAD", shortName(String(ref)), K.integrationBranch && shortName(K.integrationBranch)].filter(Boolean));
  const branches = uniq((git("branch", "-a", "--format=%(refname:short)") || "").split("\n").map(b => b.trim()).filter(b => b && !/HEAD/.test(b) && !trunk.has(shortName(b))));
  // A branch name must appear as a whole token in the text ("neo-ui/plan" shouldn't match inside "neo-ui/plan-onayi").
  const mentions = (text, b) => new RegExp(`(^|[\\s\`'"(])${shortName(b).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}($|[\\s\`'"),.;:])`, "m").test(text);

  // Top-level apps: apps/* packages/* services/* when the repo is a monorepo, else the root folders.
  const tree = (git("ls-tree", "-d", "--name-only", ref) || "").split("\n").filter(Boolean);
  let units = tree.filter(d => ["apps", "packages", "services"].includes(d)).flatMap(d => (git("ls-tree", "-d", "--name-only", ref, `${d}/`) || "").split("\n").filter(Boolean));
  if (!units.length) units = tree.filter(d => !d.startsWith("."));
  const reachOf = id => {
    const out = git("grep", "-c", "-F", id, ref, "--", ...units) || "";
    const n = new Map(units.map(u => [u, 0]));
    for (const l of out.split("\n")) { const m = l.match(/^[^:]+:([^:]+):(\d+)$/); if (!m) continue; const u = units.find(u => m[1].startsWith(u + "/")); if (u) n.set(u, n.get(u) + +m[2]); }
    return { id, in: [...n].filter(([, c]) => c).map(([u, c]) => ({ app: u, count: c })), notIn: [...n].filter(([, c]) => !c).map(([u]) => u) };
  };
  const IDENT = /`([A-Za-z_][\w.]*(?:\[\])?)`|\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b|\b([a-z]+(?:[A-Z][a-z0-9]+)+)\b|\b([A-Za-z_]\w*)\[\]/g;
  // Only names shaped like code (snake_case, camelCase, PascalCase with 2+ parts): a plain word in backticks
  // (`missing`, `partial`) is a status or prose, and would match every app.
  const codeShaped = x => /_/.test(x) || /[a-z][A-Z]/.test(x);
  const identsIn = s => uniq([...String(s || "").matchAll(IDENT)].map(m => (m[1] || m[2] || m[3] || m[4] || "").replace(/\[\]$/, "")).filter(x => x.length >= 5 && codeShaped(x) && !/[./]/.test(x)));

  // Local work: facts' branch list (`nosy facts`; psst refreshes it), read once.
  const LW = loadLocalWork(pm), pushed = LW ? pushedNames(repo) : new Set();
  let scanned; // the worktrees' uncommitted files, read on the first item that names a file
  const pending = readJson(path.join(pm, "state", "pending.json"))?.items || [];
  // Issues by number, from the facts (`nosy facts`): a ref in a code comment that is an issue number is a ticket, not a parking
  // sign. On the first real run the top items were "held" for a comment saying "issue to follow", but the
  // issues had been opened that same day. No github.json: every ref stays a parking sign, exactly as before.
  const issueByNo = new Map();
  for (const x of readJson(path.join(pm, "state", "facts", "github.json"))?.items || []) if (x && x.kind === "issue" && x.n != null) issueByNo.set(String(x.n), x);
  // Comment lines in any language's syntax: the markers are code, not words.
  const COMMENT = /^\s*(\/\/|#(?![!\[{])|\/\*|\*|--|<!--|;|%|\{\/\*)/;
  const files = new Map(), fileLines = f => { if (!files.has(f)) files.set(f, (git("show", `${ref}:${f}`) || "").split("\n")); return files.get(f); };
  const codeAt = loc => {
    const m = String(loc).match(/([\w@~./+-]+\.[A-Za-z0-9]+):(\d+)/); if (!m) return null;
    const lines = fileLines(m[1]); const n = +m[2]; if (!lines.length || n < 1 || n > lines.length) return null;
    const own = lines[n - 1], take = [];
    for (let k = n - 2; k >= 0 && k >= n - 5 && COMMENT.test(lines[k]); k--) take.unshift(lines[k]);
    const text = [...take, own].map(l => l.trim().slice(0, 400)).filter(Boolean);
    // The evidence line itself only counts when it's a comment (or ends in one): a plain code line is no claim.
    const said = [...take, COMMENT.test(own) ? own : (own.match(/(\/\/|#)\s.*$/) || [""])[0]].join("\n");
    // A decision names this file when it carries its last three path segments ("uyap/http/routes.go"): two ("http/routes.go")
    // match every package's router.
    const tail = m[1].split("/").slice(-3).join("/");
    const named = decisions.filter(d => d.no && d.text.includes(tail)).slice(0, 3).map(d => d.no);
    return { at: `${m[1]}:${n}`, text, refs: refsIn(said), decisions: named };
  };
  const out = [];
  for (const [i, it] of (L.items || []).filter(x => x.score >= 2).slice(0, top).entries()) {
    const own = [it.title, it.evidence, ...(it.detail || [])].join("\n");
    // The waiting screens behind this item: their `need` text is a receipt too.
    const screens = pending.filter(p => p.kind === "marker" && ((it.ref && p.ref === it.ref) || own.includes(p.evidence)));
    const needs = screens.flatMap(p => p.detail || []);
    const refs = uniq([it.ref, ...refsIn(own), ...refsIn(needs.join(" "))]);
    const req = uniq(refs.map(sectionOf)).map(s => ({ no: s.no, file: K.request.path, line: s.line, text: s.text.split("\n").slice(0, 18).join("\n") }));
    const refsAll = uniq([...refs, ...req.flatMap(s => refsIn(s.text))]);
    const decs = decisions.filter(d => d.no && (refsAll.includes(d.no) || refs.some(r => r !== d.no && d.text.includes(r)))).slice(0, 4)
      .map(d => ({ no: d.no, title: d.title, at: `${d.file}:${d.line}`, date: day(dateOf(d)), time: dateOf(d), status: d.status || null, notDoing: !!d.notDoing }));
    const texts = [own, ...needs, ...req.map(s => s.text)].join("\n");
    const hashes = uniq((texts.match(/\b[0-9a-f]{7,12}\b/g) || []).filter(h => /[a-f]/.test(h) && /\d/.test(h)));
    const history = [];
    for (const h of hashes.slice(0, 5)) {
      const when = git("log", "-1", "--format=%cI", h); if (!when) continue;
      history.push({ kind: "commit", name: h, date: day(when.trim()), merged: ok("merge-base", "--is-ancestor", h, ref) });
    }
    const seenBranch = new Set();
    for (const b of branches.filter(b => mentions(texts, b))) {
      if (seenBranch.has(shortName(b)) || seenBranch.size >= 4) continue; seenBranch.add(shortName(b));
      const tip = (git("log", "-1", "--format=%cI", b) || "").trim(), t = Date.parse(tip), merged = ok("merge-base", "--is-ancestor", b, ref);
      // Only an unmerged branch can "undo" a later decision by being merged now.
      const newer = merged ? [] : decs.filter(d => d.time && t && d.time > t).map(d => d.no);
      history.push({ kind: "branch", name: b, date: day(tip), merged, olderThan: newer });
    }
    const reach = identsIn(texts).slice(0, 5).map(reachOf).filter(r => r.in.length);
    const locs = uniq([it.evidence, ...(it.detail || [])].flatMap(t => String(t).match(/[\w@~./+-]+\.[A-Za-z0-9]+:\d+/g) || [])).slice(0, 4);
    const code = locs.map(codeAt).filter(Boolean);
    // The team's own next-list items point at their notes, not at code: a ref in a note is context, not a parking sign.
    // A #N that is a known issue (open or closed) is a ticket, not a parking sign: it is reported under `ticketed` and doesn't hold
    // the item. Any other ref (K178, a PR, an issue the facts don't list) and any decision naming the file still holds it.
    const ticketed = [], isTicket = r => { const n = (String(r).match(/^#(\d+)$/) || [])[1], x = n && issueByNo.get(n); return x && (x.state === "open" || x.state === "closed") ? { ref: r, n: +n, state: x.state } : null; };
    const heldBy = [];
    for (const c of /^On the team's next list/.test(it.type) ? [] : code) {
      const rest = [];
      for (const r of c.refs) { const t = isTicket(r); if (t) { if (!ticketed.some(x => x.n === t.n)) ticketed.push(t); } else rest.push(r); }
      if (rest.length || c.decisions.length) heldBy.push({ at: c.at, refs: rest, decisions: c.decisions });
    }
    const gate = heldBy.length ? { held: true, because: heldBy } : null;
    // Every evidence file the item names (not only the four whose code is quoted), and its references.
    const evPaths = uniq([it.evidence, ...(it.detail || [])].flatMap(t => [...String(t).matchAll(/([\w@~./+-]+\.[A-Za-z0-9]+):\d+/g)].map(m => m[1])));
    const { list: local, more: localMore } = matchBranchesDetailed(LW, { paths: evPaths, refs, refRe, pushed });
    const edits = evPaths.length ? editsIn(scanned ??= workingTreeScan(repo), evPaths) : []; // one `git status` per worktree for the whole list, not one per item
    out.push({ rank: i + 1, type: it.type, title: it.title, ref: it.ref || null, evidence: it.evidence, gate, ticketed, code, needs, request: req, decisions: decs, history, reach, local, localMore, edits, inProgress: local.some(x => x.strength === "strong") || edits.length > 0 });
  }
  return { type: "psstReceipts", generated: new Date().toISOString(), ref, units, localWork: LW ? { checked: true, facts: LW.generated, base: LW.base, branches: LW.branches.length, prsRead: LW.ghRead } : { checked: false }, items: out };
}

export function formatMd(R) {
  if (!R) return "No pm/sources.json or pm/state/lowhanging.json: run psst (lowhanging.mjs) first.\n";
  let o = `# psst receipts · ${R.ref}\n\nCheck every item against these before you list it (psst.md, step 3).\n`;
  if (!R.localWork?.checked) o += `\n_Local work not checked: no \`pm/state/facts/branches.json\` (run \`nosy facts\`). Without it, work already written on a local branch looks like new work._\n`;
  else if (!R.localWork.prsRead) o += `\n_Local branches checked (${R.localWork.branches}, facts of ${String(R.localWork.facts).slice(0, 10)}); GitHub wasn't read, so "no PR" below means "no PR known"._\n`;
  for (const it of R.items) {
    o += `\n## ${it.rank}. ${it.title}\n${it.type} · ${it.evidence}\n`;
    if (it.gate) o += `\n**⛔ Held on purpose until shown otherwise:** the code at ${it.gate.because.map(b => `${b.at} (${[...b.refs, ...b.decisions.map(d => `decision ${d}`)].join(", ")})`).join("; ")} records a decision or a tracked deferral. Don't list it as cheap work unless you quote that line and show why it no longer applies.\n`;
    for (const t of it.ticketed || []) o += t.state === "open"
      ? `\n**Ticketed:** issue #${t.n} is open, so it is tracked and ready, not parked.\n`
      : `\n**Ticketed**, issue #${t.n} is closed: check it was finished.\n`;
    if (it.local?.length || it.edits?.length) o += formatLocal(it.local || [], it.edits || [], it.localMore || 0);
    for (const c of it.code.filter(c => c.text.length)) o += `\n**Code at ${c.at}:**\n\n${c.text.map(l => `> ${l}`).join("\n")}\n`;
    if (it.needs.length) o += `\n**The screen's own need:** ${it.needs.join(" · ")}\n`;
    for (const s of it.request) o += `\n**Request §${s.no}** (${s.file}:${s.line}):\n\n${s.text.split("\n").map(l => `> ${l}`).join("\n")}\n`;
    if (it.decisions.length) o += `\n**Decisions:** ${it.decisions.map(d => `${d.no} (${d.date}${d.notDoing ? ", not doing" : ""}) ${d.at} — ${d.title.slice(0, 90)}`).join("\n- ")}\n`.replace("**Decisions:** ", "**Decisions:**\n- ");
    for (const h of it.history) o += `\n${h.merged ? "✓" : "✗"} ${h.kind} \`${h.name}\` (${h.date}) ${h.merged ? "is already merged (if the text above says it isn't, the text is out of date)" : "is not merged"}${h.olderThan?.length ? ` · ⚠ older than decision ${h.olderThan.join(", ")}: it may implement what that decision replaced` : ""}\n`;
    for (const r of it.reach) o += `\n\`${r.id}\` is in ${r.in.map(x => `${x.app} (${x.count})`).join(", ") || "no app"}${r.notIn.length && r.in.length ? `; not in ${r.notIn.slice(0, 6).join(", ")}${r.notIn.length > 6 ? "…" : ""}` : ""}\n`;
    if (!it.code.length && !it.needs.length && !it.request.length && !it.decisions.length && !it.history.length && !it.reach.length) o += `\n_No receipts found: check it by hand before listing it._\n`;
  }
  return o;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) { // realpath: a skill reached through a symlink (the project skill link) still runs
  const argv = process.argv.slice(2), take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const jsonOut = take("--json"), topArg = take("--top");
  const R = receipts(argv[0] || "pm", { top: topArg ? +topArg : 30 });
  process.stdout.write(formatMd(R));
  if (R && jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(R, null, 1)); }
}
