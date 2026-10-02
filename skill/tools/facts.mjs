// facts: the product's hard facts, computed once and kept in pm/state/facts/, so answers look them up instead
// of each agent re-searching from scratch. The owner's 20-question test (29 Sep) ran the same questions twice
// with the same instructions: one run scored 82, the other 66. The misses were searches that happened to go
// another way: a branch's 8 unmerged commits found once and not the next time, a merged PR "not found" as an
// issue, commit counts over the wrong window, a word "absent" that sits in 80 files. None needs judgment.
//   build   pm/state/facts/github.json   every issue and PR: number, kind, state, dates, merge commit, branch,
//                                        body and comments (one `gh issue list` + one `gh pr list`)
//           pm/state/facts/branches.json every branch with work not in the integration branch: commits ahead
//                                        (all / non-merge / not equivalent by patch), tip, age, its PR if any
//           pm/state/facts/commits.json  the last 7 days and this month: commits per person, per day, per kind
//                                        (feat/fix/docs…) and per top-level area, non-merge by author date
//           pm/state/facts.md            the same, short, for the agent to read first
//   find <words…>   every place a term appears: the whole repo (any case, Turkish letters either way, any
//                   suffix) and every issue/PR title, body and comment. Say "not there" only after this.
// Usage: node facts.mjs <pm> build [--now YYYY-MM-DD] [--branch-days 60] [--max-branches 200] [--no-gh] · node facts.mjs <pm> find <term> [more terms]
// Exit: 0 built / found · 2 find: nothing anywhere · 1 couldn't read sources.json, the repo, or GitHub (build
// without GitHub still writes the git parts and says so).
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { redactLine } from "./redact.mjs";
import { repoProblem, sourcesProblem } from "./hints.mjs";
import { readSources } from "./sources-file.mjs";

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"], ...opts });
export const fold = s => String(s).replace(/[İI]/g, "i").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
const day = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => day(new Date(new Date(s + "T00:00:00Z").getTime() + n * 864e5));

// --- git ---------------------------------------------------------------------------------------------------
// A blobless or treeless clone (remote.<name>.promisor): file contents come from the network on demand, so any
// command that reads contents (merge-tree, cherry, numstat, blame) turns into thousands of fetches that also
// write into the repo. Those repos get a tree-only comparison instead.
export function isPartialClone(repo) {
  try { return /true/.test(sh("git", ["-C", repo, "config", "--get-regexp", "^remote\\..*\\.promisor$"])) || !!sh("git", ["-C", repo, "config", "--get", "extensions.partialclone"]).trim(); } catch { return false; }
}

// A treeless clone (filter tree:0 / tree:N) has no trees for most commits either: listing a commit's files or
// comparing trees would fetch them. Such a clone gets commit counts only.
export function isTreeless(repo) {
  try { return /tree:\d/.test(sh("git", ["-C", repo, "config", "--get-regexp", "^remote\\..*\\.partialclonefilter$"])); } catch { return false; }
}

// Belt and braces for Nosy's own git calls in a partial clone: a promisor remote pointed at nowhere. Git 2.39
// still fetches through it in some paths, so the real guard is not asking for what isn't local (tree-only
// comparisons in a blobless clone, none at all in a treeless one); a comparison that fails is reported as
// "not in this clone", never retried.
export function noLazyFetchArgs(repo) {
  let out = ""; try { out = sh("git", ["-C", repo, "config", "--get-regexp", "^remote\\..*\\.promisor$"]); } catch {}
  return out.split("\n").filter(l => /\strue$/.test(l)).flatMap(l => ["-c", `${l.split(" ")[0].replace(/\.promisor$/, ".url")}=/nonexistent/nosy-no-lazy-fetch`]);
}

// Blob ids of the given paths at a commit (tree-only: no file contents read).
function blobsAt(git, commit, paths) {
  const out = new Map();
  for (let i = 0; i < paths.length; i += 200) {
    const t = git("ls-tree", "-r", commit, "--", ...paths.slice(i, i + 200)); // a missing tree throws: not in this clone
    for (const l of t.split("\n").filter(Boolean)) { const m = l.match(/^\S+ \S+ ([0-9a-f]+)\t(.*)$/); if (m) out.set(m[2], m[1]); }
  }
  return out;
}

// Branches with content the integration branch doesn't have. Only branches with a commit in the last `days`
// days, at most `max` of them (newest first): a repo with 2,000 branches is mostly history. Nothing is written
// to the repo: merge-tree's objects go to a throwaway object directory.
export const PATHS_EACH = 500, PATHS_TOTAL = 40000;
// Caps every branch's `paths` in place (see the comment where branchFacts calls it). Returns the list it was given.
export function capPaths(out, { each = PATHS_EACH, total = PATHS_TOTAL } = {}) {
  let budget = total;
  for (const b of [...out].sort((x, y) => x.filesDiffer - y.filesDiffer)) {
    const all = b.paths, floor = Math.min(all.length, 60), keep = Math.max(floor, Math.min(all.length, each, budget));
    b.pathsTotal = all.length; if (keep < all.length) { b.paths = all.slice(0, keep); b.pathsTruncated = true; }
    budget -= keep;
  }
  return out;
}
export function branchFacts(repo, base, { days = 60, max = 200, big = 20, openPr = new Set(), now = new Date().toISOString().slice(0, 10) } = {}) {
  const partial = isPartialClone(repo), treeless = partial && isTreeless(repo);
  let tmp = null, env = process.env;
  if (!partial) {
    try {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nosy-facts-obj-"));
      const objects = path.resolve(repo, sh("git", ["-C", repo, "rev-parse", "--git-path", "objects"]).trim());
      env = { ...process.env, GIT_OBJECT_DIRECTORY: tmp, GIT_ALTERNATE_OBJECT_DIRECTORIES: objects };
    } catch { tmp = null; }
  }
  const noFetch = partial ? noLazyFetchArgs(repo) : [];
  const git = (...a) => sh("git", ["-c", "core.quotepath=off", ...noFetch, "-C", repo, ...a], { env: { ...env, GIT_TERMINAL_PROMPT: "0" } }); // quotepath off: a file named "café.ts" is listed as that, not as "caf\\303\\251.ts", so evidence paths match
  const baseSha = git("rev-parse", base).trim(), since = addDays(now, -days);
  // `remote` / `branch`: a ref under refs/remotes names the remote it is on (any name, not only "origin") and the branch without it, so local-work.mjs can
  // say "pushed" for a branch on a remote called "fork" and never mistake "fork/feat/x" for a local branch of that name.
  const remotes = (() => { try { return git("remote").split("\n").map(r => r.trim()).filter(Boolean).sort((a, b) => b.length - a.length); } catch { return []; } })();
  const all = git("for-each-ref", "--sort=-committerdate", "--format=%(refname:short)\t%(objectname:short)\t%(committerdate:short)\t%(authorname)\t%(refname)", "refs/heads", "refs/remotes")
    .trim().split("\n").filter(Boolean).map(l => { const [name, tip, date, author, full = ""] = l.split("\t");
      const rest = full.replace(/^refs\/remotes\//, ""), r = full.startsWith("refs/remotes/") ? remotes.find(x => rest.startsWith(`${x}/`)) : null;
      return { name, tip, date, author, ...(r ? { remote: r, branch: rest.slice(r.length + 1) } : {}) }; })
    .filter(b => !/\/HEAD$|^origin$/.test(b.name));
  const recent = all.filter(b => b.date >= since), picked = new Map(recent.slice(0, max).map(b => [b.name, "recent"]));
  // Second product (Twenty): the largest unmerged branch (402 files) wasn't among the 200 newest. Always add
  // branches with an open PR, whatever their age, and the `big` unmerged ones furthest ahead (commit counts are
  // cheap: no file contents read, fine in a partial clone).
  for (const b of all) if (openPr.has((b.branch ?? b.name).replace(/^origin\//, ""))) picked.set(b.name, picked.get(b.name) || "open PR");
  let unmerged = []; try { unmerged = git("branch", "-a", "--no-merged", baseSha, "--format=%(refname:short)").trim().split("\n").filter(Boolean); } catch {}
  const aheadOf = new Map();
  for (const n of unmerged) { if (picked.has(n) || /\/HEAD$/.test(n)) continue; try { aheadOf.set(n, +git("rev-list", "--count", `${baseSha}..${n}`).trim()); } catch {} }
  for (const [n] of [...aheadOf].sort((a, b) => b[1] - a[1]).slice(0, big)) picked.set(n, "far ahead");
  const refs = all.filter(b => picked.has(b.name)).map(b => ({ ...b, why: picked.get(b.name) }));
  const out = [];
  try {
    for (const b of refs) {
      let ahead = 0;
      try { ahead = +git("rev-list", "--count", `${baseSha}..${b.name}`).trim(); } catch { continue; }
      if (!ahead) continue;
      const nonMerge = +git("rev-list", "--count", "--no-merges", `${baseSha}..${b.name}`).trim();
      const subjects = git("log", "--no-merges", "--format=%h %ad %s", "--date=short", "-n", "12", `${baseSha}..${b.name}`).trim().split("\n").filter(Boolean);
      let files = [], conflicts = false, unique = null, notLocal = false;
      if (treeless) { notLocal = true; }
      else if (partial) {
        // Tree-only: the paths the branch changed since it left the base, compared by blob id. Changed on the
        // branch and untouched on the base = missing from the base; changed on both = differs, may conflict.
        try {
          const mb = git("merge-base", baseSha, b.name).trim();
          const touched = git("diff", "--name-only", "--no-renames", mb, b.name).trim().split("\n").filter(Boolean);
          const [atBase, atMb, atBr] = [baseSha, mb, b.name].map(c => blobsAt(git, c, touched));
          for (const f of touched) {
            if (atBr.get(f) === atBase.get(f)) continue;
            if (atBase.get(f) !== atMb.get(f)) conflicts = true;
            files.push({ file: f });
          }
        } catch { notLocal = true; }
      } else {
        // "+" lines of git cherry: commits whose change isn't in the base under another hash.
        unique = nonMerge; try { unique = git("cherry", baseSha, b.name).split("\n").filter(l => l.startsWith("+")).length; } catch {}
        // What the branch still has that the base doesn't: merge it in memory (git merge-tree) and list the
        // files that merge would change. Squash merges, re-done commits and files the base changed later don't
        // count, as they do in the commit counts (126 commits "ahead" can be 29 files).
        try {
          let tree;
          try { tree = git("merge-tree", "--write-tree", baseSha, b.name); } catch (e) { tree = String(e.stdout || ""); conflicts = true; }
          tree = tree.split("\n")[0].trim();
          if (/^[0-9a-f]{40}$/.test(tree)) files = git("diff", "--numstat", baseSha, tree).trim().split("\n").filter(Boolean)
            .map(l => { const [a, d, f] = l.split("\t"); return { file: f, added: +a || 0, removed: +d || 0 }; });
        } catch {}
      }
      const IMG = /\.(png|jpe?g|gif|webp|svg|snap)$/i, images = files.filter(f => IMG.test(f.file)).length;
      files = files.filter(f => !IMG.test(f.file));
      // `paths` is every file the branch still differs in (names only), so local-work.mjs can match a psst item's evidence file
      // to a branch even when the branch is big; `files` stays the first 60 with their counts, for the page. Capped below.
      out.push({ ...b, ahead, nonMerge, unique, filesDiffer: files.length, images, conflicts, notLocal, files: files.slice(0, 60), paths: files.map(f => f.file), subjects });
    }
  } finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
  // Memory and file size: 300 branches × 2,000 paths was a 30 MB branches.json that every reader parsed. At most PATHS_EACH names per branch and PATHS_TOTAL
  // in all, the most focused branches (fewest files) served first (a 2,000-file branch matches everything and proves nothing). A branch cut short says
  // so (`pathsTruncated`, `pathsTotal`) and never has fewer names than its `files` list (the first 60), so local-work still matches on those.
  capPaths(out);
  const list = out.sort((a, b) => b.filesDiffer - a.filesDiffer || b.date.localeCompare(a.date));
  const notLocal = out.filter(b => b.notLocal).map(b => b.name);
  list.meta = { treeless, notLocal: notLocal.length, notLocalNames: notLocal.slice(0, 20), partial, days, max, big, since, total: all.length, recent: recent.length, checked: refs.length, openPr: refs.filter(b => b.why === "open PR").length, farAhead: refs.filter(b => b.why === "far ahead").length };
  return list;
}

const KIND_RE = /^(feat|fix|docs|test|chore|refactor|polish|perf|style|build|ci|revert)\b/i;
export function commitFacts(repo, base, now) {
  const noFetch = noLazyFetchArgs(repo), git = (...a) => sh("git", ["-c", "core.quotepath=off", ...noFetch, "-C", repo, ...a], { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const monthStart = now.slice(0, 8) + "01", weekFrom = addDays(now, -7), weekTo = addDays(now, -1);
  const from = monthStart < weekFrom ? monthStart : weekFrom;
  // Author date in the author's own time zone, non-merge, with the files each touched (a treeless clone has no
  // trees to list files from: counts still come, areas are unknown, nothing is fetched).
  const logArgs = ["log", base, "--no-merges", "--no-renames", `--since=${addDays(from, -2)}`, "--date=format:%Y-%m-%d", "--format=@@%h\t%ad\t%an\t%s"];
  let raw, areasKnown = true;
  if (isPartialClone(repo) && isTreeless(repo)) { raw = git(...logArgs); areasKnown = false; }
  else { try { raw = git(...logArgs, "--name-only"); } catch { raw = git(...logArgs); areasKnown = false; } }
  const commits = [];
  for (const block of raw.split("@@").slice(1)) {
    const [head, ...files] = block.trim().split("\n");
    const [sha, date, author, subject = ""] = head.split("\t");
    if (date < from || date > now) continue;
    const areas = [...new Set(files.filter(Boolean).map(f => { const p = f.split("/"); return p[0] === "apps" && p[1] ? `apps/${p[1]}` : p.length > 1 ? p[0] : f; }))];
    commits.push({ sha, date, author, subject, kind: (subject.match(KIND_RE)?.[1] || "other").toLowerCase(), areas });
  }
  const tally = (list, key) => { const m = {}; for (const c of list) for (const k of [].concat(key(c))) m[k] = (m[k] || 0) + 1; return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])); };
  const windowOf = (lo, hi) => {
    const list = commits.filter(c => c.date >= lo && c.date <= hi), people = tally(list, c => c.author);
    return { from: lo, to: hi, total: list.length, byPerson: people, byDay: Object.fromEntries(Object.entries(tally(list, c => c.date)).sort()),
      byKind: tally(list, c => c.kind), byArea: tally(list, c => c.areas),
      byPersonKind: Object.fromEntries(Object.keys(people).map(p => [p, tally(list.filter(c => c.author === p), c => c.kind)])),
      byPersonArea: Object.fromEntries(Object.keys(people).map(p => [p, tally(list.filter(c => c.author === p), c => c.areas)])) };
  };
  const merges = git("log", base, "--merges", `--since=${addDays(weekFrom, -2)}`, "--date=format:%Y-%m-%d", "--format=%ad").split("\n").filter(d => d >= weekFrom && d <= weekTo).length;
  return { note: "non-merge commits on the integration branch, by author date in the author's own time zone", areasKnown, week: { ...windowOf(weekFrom, weekTo), merges }, month: windowOf(monthStart, now), commits };
}

// --- GitHub ------------------------------------------------------------------------------------------------
export function githubFacts(ghRepo) {
  const gh = args => JSON.parse(sh("gh", args));
  const clip = s => String(s || "").slice(0, 4000), who = a => a?.login || a?.name || "";
  const issues = gh(["issue", "list", "-R", ghRepo, "--state", "all", "--limit", "3000", "--json", "number,title,state,createdAt,closedAt,author,labels,assignees,body,comments"]);
  const prs = gh(["pr", "list", "-R", ghRepo, "--state", "all", "--limit", "3000", "--json", "number,title,state,createdAt,closedAt,mergedAt,author,headRefName,baseRefName,mergeCommit,isDraft,body,comments"]);
  const comments = cs => (cs || []).map(c => ({ by: who(c.author), at: (c.createdAt || "").slice(0, 10), body: clip(c.body) }));
  const LIMIT = 3000, list = [
    ...issues.map(i => ({ n: i.number, kind: "issue", state: i.state.toLowerCase(), title: i.title, by: who(i.author), created: i.createdAt?.slice(0, 10), closed: i.closedAt?.slice(0, 10) || null,
      labels: (i.labels || []).map(l => l.name), assignees: (i.assignees || []).map(who), body: clip(i.body), comments: comments(i.comments) })),
    ...prs.map(p => ({ n: p.number, kind: "pr", state: p.state.toLowerCase(), title: p.title, by: who(p.author), created: p.createdAt?.slice(0, 10), closed: p.closedAt?.slice(0, 10) || null,
      merged: p.mergedAt?.slice(0, 10) || null, mergeCommit: p.mergeCommit?.oid?.slice(0, 9) || null, branch: p.headRefName, base: p.baseRefName, draft: !!p.isDraft, body: clip(p.body), comments: comments(p.comments) })),
  ].sort((a, b) => b.n - a.n);
  // gh lists the newest first: at the limit, older ones exist and weren't read. Say so rather than imply "all".
  list.capped = { issues: issues.length >= LIMIT, prs: prs.length >= LIMIT };
  return list;
}

// --- the short page -----------------------------------------------------------------------------------------
export function renderFacts({ now, base, gh, branches, commits, ghError, ghRepo }) {
  const L = [`# Facts · ${now} · integration branch \`${base}\``, "",
    "Computed by script (`nosy facts`), not by an agent. Look things up here before searching; details in `pm/state/facts/*.json`; any word anywhere: `nosy find <word>`. In an answer, cite each section's git or gh command (below), not this file: the owner must be able to reproduce the number without Nosy.", ""];
  const top = (o, n = 8) => Object.entries(o).slice(0, n).map(([k, v]) => `${k} ${v}`).join(" · ");
  for (const [label, w] of [["Last 7 days", commits.week], ["This month", commits.month]]) {
    L.push(`## ${label} (${w.from} – ${w.to}): ${w.total} non-merge commits${w.merges !== undefined ? ` + ${w.merges} merge commits` : ""}`, "",
      `- Reproduce: \`git log ${base} --no-merges --since=${addDays(w.from, -2)} --date=format:%Y-%m-%d --format='%ad %an %s'\` and keep dates ${w.from}..${w.to} (author date in the author's own zone)`,
      `- By person: ${top(w.byPerson)}`, `- By kind (subject prefix): ${top(w.byKind, 12)}`, commits.areasKnown === false ? "- By area: unknown (a treeless clone has no file lists to read, and Nosy doesn't fetch them)" : `- By area (a commit counts in every area it touches): ${top(w.byArea, 12)}`);
    if (label === "Last 7 days") {
      L.push(`- By day: ${Object.entries(w.byDay).map(([d, v]) => `${d.slice(5)} ${v}`).join(" · ")}`);
      for (const p of Object.keys(w.byPerson).slice(0, 5)) L.push(`- ${p}: kinds ${top(w.byPersonKind[p], 6)}; areas ${top(w.byPersonArea[p], 5)}`);
    }
    L.push("");
  }
  const real = branches.filter(b => b.filesDiffer + b.images > 0), prOf = new Map((gh || []).filter(x => x.kind === "pr").map(x => [x.branch, x]));
  const M = branches.meta;
  L.push(`## Branches with content not in \`${base}\`: ${real.length} (${branches.length - real.length} more are "ahead" only by commits whose content already reached ${base})`, "",
    ...(M ? [`Checked ${M.checked} branch${M.checked === 1 ? "" : "es"} of ${M.total}: those with a commit since ${M.since}${M.recent > M.max ? ` (the ${M.max} newest of ${M.recent})` : ""}${M.openPr ? `, ${M.openPr} older one${M.openPr === 1 ? "" : "s"} with an open PR` : ""}${M.farAhead ? `, and the ${M.farAhead} unmerged furthest ahead` : ""}; the rest weren't looked at (\`--branch-days\`, \`--max-branches\`).${M.partial ? ` This is a partial clone: files compared by blob id without reading contents, so line counts and merge conflicts aren't known, and nothing is fetched${M.notLocal ? `; ${M.notLocal} branch${M.notLocal === 1 ? "'s" : "es'"} trees aren't in this clone${M.treeless ? " (a treeless clone)" : ""}, so ${M.notLocal === 1 ? "it wasn't" : "they weren't"} compared (${M.notLocalNames.slice(0, 5).join(", ")}${M.notLocal > 5 ? ", …" : ""})` : ""}.` : ""}`, ""] : []),
    `Reproduce one branch: \`git merge-tree --write-tree ${base} <branch>\`, then \`git diff --stat ${base} <tree printed on its first line>\`.`, "",
    "Commit counts overstate: squash merges and re-done work leave commits \"ahead\" whose content is already in. The files column is what's really missing: the files that merging the branch now would change (an in-memory git merge-tree; branches.json lists them).", "",
    "| Branch | Files still different | Ahead: commits (non-merge) | Tip | PR | Files (first) |", "|---|---|---|---|---|---|");
  for (const b of real.slice(0, 40)) { const p = prOf.get(b.name.replace(/^origin\//, "")); L.push(`| ${b.name} | ${b.filesDiffer}${b.images ? ` (+${b.images} images)` : ""} | ${b.ahead} (${b.nonMerge}) | ${b.tip} ${b.date} ${b.author} | ${p ? `#${p.n} ${p.merged ? "merged" : p.state}` : "none"}${b.conflicts ? (M?.partial ? " · changed on both sides" : " · conflicts with base") : ""} | ${b.files.slice(0, 4).map(f => f.file.split("/").slice(-2).join("/")).join(", ")} |`); }
  if (real.length > 40) L.push(`| … ${real.length - 40} more in branches.json | | | | |`);
  L.push("");
  if (gh) {
    const open = gh.filter(x => x.state === "open"), since = addDays(now, -7), recent = gh.filter(x => x.kind === "pr" && x.merged && x.merged >= since);
    const cap = gh.capped || {}, capNote = cap.issues || cap.prs ? ` (the newest ${[cap.issues && "issues", cap.prs && "PRs"].filter(Boolean).join(" and ")} only: the list stops at 3000, older ones weren't read; \`gh issue view <n>\` for one)` : "";
    L.push(`## GitHub: ${gh.filter(x => x.kind === "issue").length} issues, ${gh.filter(x => x.kind === "pr").length} PRs${capNote}. Issues and PRs share numbers: check the kind before calling #N an issue.`, "",
      `- Reproduce: \`gh pr view <n> -R ${ghRepo || "<issue.repo>"} --json state,mergedAt\` or \`gh issue view <n> -R ${ghRepo || "<issue.repo>"}\``,
      `- Open (${open.length}): ${open.slice(0, 50).map(x => `#${x.n} ${x.kind === "pr" ? "PR " : ""}${x.title.slice(0, 60)}${x.assignees?.length ? ` (${x.assignees.join(", ")})` : ""}`).join(" · ")}`,
      `- PRs merged in the last 7 days (${recent.length}): ${recent.map(x => `#${x.n} ${x.merged} ${x.title.slice(0, 50)}`).join(" · ")}`, "");
  } else L.push(`## GitHub: not read (${ghError || "no issue.repo in sources.json"})`, "");
  return L.join("\n");
}

// --- find --------------------------------------------------------------------------------------------------
const ALT = { i: "(i|ı|I|İ|î|Î)", a: "(a|A|â|Â)", s: "(s|ş|S|Ş)", g: "(g|ğ|G|Ğ)", u: "(u|ü|U|Ü|û|Û)", o: "(o|ö|O|Ö)", c: "(c|ç|C|Ç)" };
// An ERE for git grep: the term with Turkish letters either way and any case (bilirkisi ↔ Bilirkişi, İçtihat).
export function termPattern(term) {
  return [...fold(term)].map(ch => ALT[ch] || (/[a-z]/.test(ch) ? `(${ch}|${ch.toUpperCase()})` : /[.*+?^${}()|[\]\\]/.test(ch) ? "\\" + ch : ch)).join("");
}
const isDoc = f => /\.(md|mdx|txt|rst|adoc)$/i.test(f);
export function find(repo, gh, terms, { base = "HEAD" } = {}) {
  const noFetch = noLazyFetchArgs(repo), git = (...a) => { try { return sh("git", [...noFetch, "-C", repo, ...a], { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }); } catch { return ""; } };
  const partial = isPartialClone(repo); // blame reads old contents: in a partial clone that means network fetches
  return terms.map(term => {
    const f = fold(term), files = new Map(), pat = termPattern(term);
    for (const line of git("grep", "-n", "-I", "-E", pat).split("\n").filter(Boolean)) {
      const m = line.match(/^(.*?):(\d+):(.*)$/); if (!m || !fold(m[3]).includes(f)) continue;
      (files.get(m[1]) || files.set(m[1], []).get(m[1])).push({ line: +m[2], text: redactLine(m[1], m[3].trim()).slice(0, 160) }); // a committed secret prints as file:line with the value hidden
    }
    const fileList = [...files].map(([file, hits]) => ({ file, hits })).sort((a, b) => b.hits.length - a.hits.length);
    // When each shown file last changed: a document's "not built yet" is only as new as its last edit.
    for (const x of fileList.slice(0, 15)) {
      x.changed = git("log", "-1", "--format=%ad", "--date=short", base, "--", x.file).trim() || null;
      // For a document, when the matching line itself was written (a file edited yesterday can keep a month-old line).
      if (isDoc(x.file) && !partial) { const t = git("blame", "--porcelain", "-L", `${x.hits[0].line},${x.hits[0].line}`, base, "--", x.file).match(/^author-time (\d+)/m); if (t) x.written = new Date(+t[1] * 1000).toISOString().slice(0, 10); }
    }
    // Commits on the integration branch whose message mentions it, newest first: "Uygula writes a tracked change"
    // (25 Sep) beats a doc from 24 Sep that says tracking is still to do.
    const commits = git("log", base, "-i", "-E", `--grep=${pat}`, "--format=%h%x09%ad%x09%s", "--date=short", "-n", "60").split("\n").filter(Boolean)
      .map(l => { const [sha, date, subject] = l.split("\t"); return { sha, date, subject: redactLine("", subject) }; });
    const github = [];
    for (const x of gh || []) {
      const where = [fold(x.title).includes(f) && "title", fold(x.body).includes(f) && "body", (x.comments || []).some(c => fold(c.body).includes(f)) && "comments"].filter(Boolean);
      if (where.length) github.push({ n: x.n, kind: x.kind, state: x.merged ? "merged" : x.state, title: x.title, where, date: x.merged || x.closed || x.created });
    }
    return { term, files: fileList, commits, github };
  });
}
export function renderFind(res, { ghRead, base = "HEAD" }) {
  const L = [];
  for (const r of res) {
    const n = r.files.reduce((s, f) => s + f.hits.length, 0);
    L.push(`## "${r.term}": ${n} line${n === 1 ? "" : "s"} in ${r.files.length} file${r.files.length === 1 ? "" : "s"}, ${r.commits.length}${r.commits.length === 60 ? "+" : ""} commit${r.commits.length === 1 ? "" : "s"} on ${base}${ghRead ? `, ${r.github.length} issue/PR` : " (issues/PRs not searched: run `nosy facts` first)"}`);
    for (const f of r.files.slice(0, 15)) L.push(`- ${f.file}:${f.hits[0].line}${f.hits.length > 1 ? ` (+${f.hits.length - 1})` : ""}${f.written ? ` [line written ${f.written}]` : f.changed ? ` [last changed ${f.changed}]` : ""}  ${f.hits[0].text}`);
    if (r.files.length > 15) L.push(`- … ${r.files.length - 15} more files`);
    if (r.commits.length) { L.push(`- commits mentioning it (newest first):`); for (const c of r.commits.slice(0, 8)) L.push(`  - ${c.sha} ${c.date} ${c.subject.slice(0, 110)}`); }
    for (const g of r.github.slice(0, 15)) L.push(`- #${g.n} ${g.kind === "pr" ? "PR" : "issue"}, ${g.state}${g.date ? ` ${g.date}` : ""}: ${g.title.slice(0, 80)} (in ${g.where.join(", ")})`);
    if (r.github.length > 15) L.push(`- … ${r.github.length - 15} more issues/PRs`);
    // A document that talks about it but last changed before the newest commit that does: its status may be stale.
    const newest = r.commits[0], stale = newest ? r.files.slice(0, 15).filter(f => isDoc(f.file) && (f.written || f.changed) < newest.date) : [];
    if (stale.length) L.push(`- **check before repeating:** ${stale.slice(0, 4).map(f => `${f.file}:${f.hits[0].line} (written ${f.written || f.changed})`).join(", ")} ${stale.length === 1 ? "is" : "are"} older than ${newest.sha} (${newest.date}, "${newest.subject.slice(0, 60)}"). A "not built / not on main / missing" in ${stale.length === 1 ? "it" : "them"} may be out of date: read the commit first.`);
    if (!n && !r.github.length && !r.commits.length) L.push(`- nowhere: every tracked file (any case, Turkish letters either way, any suffix), every commit message on ${base}${ghRead ? " and every issue/PR title, body and comment" : ""}`);
    L.push("");
  }
  return L.join("\n").trim();
}

// --- CLI ---------------------------------------------------------------------------------------------------
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const flag = k => { const i = argv.indexOf(k); if (i >= 0) argv.splice(i, 1); return i >= 0; };
  const nowArg = take("--now"), branchDays = take("--branch-days"), maxBranches = take("--max-branches"), noGh = flag("--no-gh");
  const [pm = "pm", cmd = "build", ...terms] = argv;
  let K; try { K = readSources(pm); } catch { console.error(`Psst… ${sourcesProblem(pm) || `Couldn't read ${path.join(pm, "sources.json")}.`}`); process.exit(1); }
  const repo = path.resolve(K.repo || "."), dir = path.join(pm, "state", "facts");
  const base = K.integrationBranch || K.ref || "HEAD";
  try { sh("git", ["-C", repo, "rev-parse", "--verify", base]); } catch { console.error(`Psst… ${repoProblem({ ...K, ref: base, repoAsWritten: K.repoAsWritten }) || `Couldn't read ${base} in ${repo}. Check that \`ref\` in pm/sources.json is a branch of that repo (\`git branch -a\`).`}`); process.exit(1); }
  if (cmd === "find") {
    if (!terms.length) { console.error("Usage: node facts.mjs <pm> find <term> [more terms]"); process.exit(1); }
    let gh = null; try { gh = JSON.parse(fs.readFileSync(path.join(dir, "github.json"), "utf8")).items; } catch {}
    const res = find(repo, gh, terms, { base });
    console.log(renderFind(res, { ghRead: !!gh, base }));
    process.exitCode = res.every(r => !r.files.length && !r.github.length && !r.commits.length) ? 2 : 0;
  } else if (cmd === "build") {
    const now = nowArg || day(new Date());
    fs.mkdirSync(dir, { recursive: true });
    let gh = null, ghError = null;
    if (!noGh && K.issue?.repo) { try { gh = githubFacts(K.issue.repo); } catch (e) { ghError = String(e.stderr || e.message).trim().split("\n")[0]; } }
    const openPr = new Set((gh || []).filter(x => x.kind === "pr" && x.state === "open" && x.branch).map(x => x.branch));
    const branches = branchFacts(repo, base, { now, openPr, days: +(branchDays || 60), max: +(maxBranches || 200) }), commits = commitFacts(repo, base, now);
    const stamp = { generated: new Date().toISOString(), now, base, repo: K.repo };
    fs.writeFileSync(path.join(dir, "branches.json"), JSON.stringify({ ...stamp, scope: branches.meta, branches }, null, 1));
    fs.writeFileSync(path.join(dir, "commits.json"), JSON.stringify({ ...stamp, ...commits }, null, 1));
    if (gh) fs.writeFileSync(path.join(dir, "github.json"), JSON.stringify({ ...stamp, ghRepo: K.issue.repo, capped: gh.capped, items: gh }, null, 1));
    fs.writeFileSync(path.join(pm, "state", "facts.md"), renderFacts({ now, base, gh, branches, commits, ghError, ghRepo: K.issue?.repo }) + "\n");
    console.log(`Wrote ${path.join(pm, "state", "facts.md")} and ${dir}/: ${commits.week.total} commits in the last 7 days, ${branches.filter(b => b.filesDiffer + b.images).length} branches with content not in ${base}, ${gh ? `${gh.length} issues/PRs` : `GitHub not read${ghError ? ` (${ghError})` : ""}`}.`);
    if (ghError) process.exitCode = 1;
  } else { console.error(`Unknown: ${cmd}. Use build or find.`); process.exit(1); }
}
