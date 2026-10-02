// Contract tests for skill/tools/collect-status.mjs. Runs against the fake product "Cargo" (see fake-product.mjs),
// with a fake `gh` (no network). Not exact text; validates JSON keys, group membership and counts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";

let K, gh, tmp, output;

before(async () => {
  K = await fakeProductSetup();
  gh = fakeGhSetup(K.gh);
  tmp = temporary("nosy-status-");
  const jsonPath = path.join(tmp, "status.json");
  // "2020-01-01": a fixed start date that covers every commit (not dependent on relative day windows).
  const r = run(path.join(Tool, "collect-status.mjs"),
    [K.repo, "2020-01-01", "origin/main", "--json", jsonPath], { env: gh.env });
  assert.equal(r.code, 0, `collect-status: unexpected exit code, stderr: ${r.error}`);
  output = { markdown: r.output, json: JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
});
after(() => { clean(K.root); clean(gh.dir); clean(tmp); });

test("--json carries the expected keys", () => {
  for (const k of ["type", "generated", "range", "main", "pr", "lastMain", "prs", "groups", "dependency", "withoutReference"])
    assert.ok(k in output.json, `${k} missing from JSON output`);
  assert.equal(output.json.type, "state");
});

test("groups by K/§/# references; K-sub-item numbers (m.N) roll up into the decision", () => {
  const g = Object.fromEntries(output.json.groups.map(x => [x.ref, x]));
  // K12: locally m.1/m.4/m.6 (3 commits) + open PR #615's commit (K12 includes m.9) = 4.
  assert.equal(g.K12?.n, 4, "the K12 group should contain 4 commits (3 local sub-items + 1 open PR)");
  assert.equal(g["§3"]?.n, 1);
  assert.equal(g["§7"]?.n, 1);
  assert.equal(g["§22"]?.n, 2, "§22: 1 local + 1 open-PR commit");
  assert.equal(g["#80"]?.n, 1);
});

test("dependency updates (chore(deps)) are counted separately and don't form a ref group", () => {
  assert.equal(output.json.dependency, 2);
  assert.ok(!output.json.groups.some(g => g.ref === "#101" || g.ref === "#103"),
    "issue numbers inside chore(deps) commits must not form a separate ref group");
});

test("open PR commits arrive in the 'yer' field with #N (not mixed in with main)", () => {
  const k12 = output.json.groups.find(g => g.ref === "K12");
  assert.ok(k12.where.includes("#615"), "K12 group's yer should include #615");
  assert.ok(k12.where.includes("main"), "K12 group's yer should also include main");
  assert.equal(output.json.pr, 2, "the two open PRs should total 2 commits");
});

test("a PR commit title GitHub truncated with '…' is rejoined with its body", () => {
  // #777 only appears in the part of the title that overflowed into the body: without the rejoin, this group would not form at all.
  // Since the group's only commit is the truncated one, the topic is independent of sort order (K12's topic used to vary
  // depending on which commit was considered "last").
  const g = output.json.groups.find(g => g.ref === "#777");
  assert.ok(g, "truncated title was not rejoined with the body: #777 in the body never made it into the title");
  assert.ok(g.topic.includes("broadening the scope"), `truncated title + body not joined correctly: ${g.topic}`);
  assert.ok(!g.topic.includes("…"), `joined title still has a '…' remnant: ${g.topic}`);
});

test("count of commits without a reference", () => {
  assert.equal(output.json.withoutReference, 5);
});

test("markdown output's Open PRs section includes the PR title and author", () => {
  assert.match(output.markdown, /#615/);
  assert.match(output.markdown, /alice/);
});

// fixed by d5/tools in cycle 5: the group "Last" column must show the date of the newest commit, not the
// first one in the array. In group §22, the open-PR commit (~2 days ago) is newer than the local commit (~9 days ago); "last"
// should be the PR commit's.
test("group 'last' field reflects the newest commit",
  () => {
    const local = d => new Date(d).toLocaleString("en-US", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      .replace(/[,/]/g, m => m === "/" ? "." : "");
    const g22 = output.json.groups.find(x => x.ref === "§22");
    const prCommit = K.gh.prListNoR.find(p => p.number === 615).commits[0];
    assert.equal(g22.last, local(prCommit.committedDate),
      "under correct behavior, 'last' should show the date of the newest commit, the open-PR one");
  });

// when the end-ref argument is omitted, collect-status.mjs detects the integration branch
// itself (integration-branch.mjs) from --pm's sources.json (ref + issue.repo), instead of assuming origin/main.
// Separate `before`/`after`: a second fixture (prListMerged) and a run without the explicit third argument.
let autoK, autoGh, autoTmp, autoOutput;
before(async () => {
  autoK = await fakeProductSetup();
  // Cargo's default branch (sources.json ref) is "origin/main"; only "main" has merged PRs in the window,
  // so detection should conclude "default branch" and endRef should equal sources.json's ref.
  autoK.gh.prListMerged = [
    { baseRefName: "main", mergedAt: new Date().toISOString() },
    { baseRefName: "main", mergedAt: new Date().toISOString() },
  ];
  autoGh = fakeGhSetup(autoK.gh);
  autoTmp = temporary("nosy-status-auto-");
  const jsonPath = path.join(autoTmp, "status.json");
  const r = run(path.join(Tool, "collect-status.mjs"),
    [autoK.repo, "2020-01-01", "--pm", autoK.pm, "--json", jsonPath], { env: autoGh.env });
  assert.equal(r.code, 0, `collect-status (auto end-ref): unexpected exit code, stderr: ${r.error}`);
  autoOutput = { markdown: r.output, json: JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
});
after(() => { clean(autoK.root); clean(autoGh.dir); clean(autoTmp); });

test("no end-ref argument -> detected end ref + reason are in the JSON and markdown", () => {
  assert.equal(autoOutput.json.endRef, "origin/main", "should fall back to sources.json's ref (main has the most merged PRs)");
  assert.ok(autoOutput.json.endRefReason, "endRefReason should be populated when the end-ref was auto-detected");
  assert.match(autoOutput.markdown, /End ref:.*origin\/main/);
});

test("an explicit end-ref argument is still used as-is (no detection note)", () => {
  // output/K come from the file's main before(): collect-status.mjs was called with an explicit "origin/main".
  assert.equal(output.json.endRef, undefined, "explicit end-ref runs don't add an endRef/endRefReason key");
  assert.doesNotMatch(output.markdown, /End ref:/);
});

// --- no remote / no gh -> a quiet note + local branches, never "PR could not be read" ---
let noRemoteK, noRemoteGh, noRemoteTmp, noRemoteOutput;
before(async () => {
  noRemoteK = await fakeProductSetup();
  const git = (...a) => execFileSync("git", ["-C", noRemoteK.repo, ...a], { encoding: "utf8" });
  git("checkout", "-q", "-b", "side/r54");
  fs.writeFileSync(path.join(noRemoteK.repo, "backend", "extra.js"), "export const extra = 1;\n");
  git("add", "-A"); git("commit", "-q", "-m", "K12 m.9 extend the file-move backend, local only");
  git("checkout", "-q", "-b", "side/nb-bet", "main");
  fs.writeFileSync(path.join(noRemoteK.repo, "backend", "extra2.js"), "export const extra2 = 1;\n");
  git("add", "-A"); git("commit", "-q", "-m", "work in progress\n\nBet: nb-260928-example-bet");
  git("checkout", "-q", "main");
  noRemoteK.gh.fail = true; // simulated total gh failure (no remote, not a GitHub repo, offline)
  noRemoteGh = fakeGhSetup(noRemoteK.gh);
  noRemoteTmp = temporary("nosy-status-noremote-");
  const jsonPath = path.join(noRemoteTmp, "status.json");
  const r = run(path.join(Tool, "collect-status.mjs"),
    [noRemoteK.repo, "2020-01-01", "origin/main", "--pm", noRemoteK.pm, "--json", jsonPath], { env: noRemoteGh.env });
  assert.equal(r.code, 0, `collect-status (no remote): unexpected exit code, stderr: ${r.error}`);
  noRemoteOutput = { markdown: r.output, json: JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
});
after(() => { clean(noRemoteK.root); clean(noRemoteGh.dir); clean(noRemoteTmp); });

test("gh failing doesn't stop the run or print 'PR could not be read'", () => {
  assert.equal(noRemoteOutput.json.noRemote, true);
  assert.doesNotMatch(noRemoteOutput.markdown, /PR could not be read/);
  assert.match(noRemoteOutput.markdown, /no remote: PRs not read; local branches used/);
});

test("unmerged local branches appear as 'close to merging (local branches)', with their refs", () => {
  const branches = Object.fromEntries(noRemoteOutput.json.localBranches.map(b => [b.branch, b]));
  assert.ok(branches["side/r54"], "side/r54 should be listed");
  assert.deepEqual(branches["side/r54"].refs, ["K12"]);
  assert.ok(branches["side/nb-bet"], "side/nb-bet should be listed");
  assert.deepEqual(branches["side/nb-bet"].refs, ["nb-260928-example-bet"]);
  assert.match(noRemoteOutput.markdown, /Close to merging \(local branches\)/);
  assert.match(noRemoteOutput.markdown, /side\/r54/);
});

// --- the by-reference table's Wave column, from pm/waves.md's N-sections ---
let waveK, waveGh, waveTmp, waveOutput;
before(async () => {
  waveK = await fakeProductSetup();
  fs.writeFileSync(path.join(waveK.pm, "waves.md"), "# Waves\n\n## Direction\n\n- **N1 · Test wave** · size M · K12 §3.\n");
  waveGh = fakeGhSetup(waveK.gh);
  waveTmp = temporary("nosy-status-wave-");
  const jsonPath = path.join(waveTmp, "status.json");
  const r = run(path.join(Tool, "collect-status.mjs"),
    [waveK.repo, "2020-01-01", "origin/main", "--pm", waveK.pm, "--json", jsonPath], { env: waveGh.env });
  assert.equal(r.code, 0, `collect-status (waves): unexpected exit code, stderr: ${r.error}`);
  waveOutput = { markdown: r.output, json: JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
});
after(() => { clean(waveK.root); clean(waveGh.dir); clean(waveTmp); });

test("a ref a wave names gets that wave in the by-reference table and JSON", () => {
  const g = Object.fromEntries(waveOutput.json.groups.map(x => [x.ref, x]));
  assert.equal(g.K12.wave, "N1");
  assert.equal(g["§3"].wave, "N1");
  assert.match(waveOutput.markdown, /\| K12 \|.*\| N1 \|/);
});

test("a ref no wave names gets '—', not left blank or omitted", () => {
  const g = Object.fromEntries(waveOutput.json.groups.map(x => [x.ref, x]));
  assert.equal(g["§7"].wave, "—");
  assert.equal(g["#80"].wave, "—");
});

test("no pm/waves.md at all -> no Wave column, no 'wave' key", () => {
  // output/K come from the file's main before(): no waves.md was written for that fixture.
  assert.doesNotMatch(output.markdown, /\| Wave \|/);
  assert.ok(!("wave" in output.json.groups[0]), "no waves file: groups should carry no 'wave' key at all");
});

// the first real run showed "307 open PRs" for a repo with 2. `pr` is not a PR count: it is every entry of the log that is
// not a plain main commit, so it also holds the merge commits on main. The honest numbers are `openPrs` and `prCommits`, written beside it.
test("openPrs counts the open PRs and prCommits their commits (the old `pr` is kept)", () => {
  assert.equal(output.json.openPrs, 2, "two open PRs were listed");
  assert.equal(output.json.prCommits, 2, "one commit each");
  assert.equal(output.json.pr, 2, "the old field keeps its value when main has no merge commits in range");
  assert.match(output.markdown, /on open PRs/);
});

let mergedK, mergedGh, mergedTmp, mergedJson;
before(async () => {
  mergedK = await fakeProductSetup();
  const git = (...a) => execFileSync("git", ["-C", mergedK.repo, ...a], { encoding: "utf8" });
  // A merge-commit workflow: three merges of already-closed PRs land on main inside the range.
  for (const n of [1, 2, 3]) {
    git("checkout", "-q", "-b", `side/merged-${n}`, "main");
    fs.writeFileSync(path.join(mergedK.repo, `merged-${n}.txt`), `${n}\n`);
    git("add", "-A"); git("commit", "-q", "-m", `work for pull request ${n}`);
    git("checkout", "-q", "main");
    git("merge", "--no-ff", "-q", `side/merged-${n}`, "-m", `Merge pull request #${900 + n} from fake/side-merged-${n}`);
  }
  mergedGh = fakeGhSetup(mergedK.gh);
  mergedTmp = temporary("nosy-status-merged-");
  const jsonPath = path.join(mergedTmp, "status.json");
  const r = run(path.join(Tool, "collect-status.mjs"), [mergedK.repo, "2020-01-01", "main", "--json", jsonPath], { env: mergedGh.env });
  assert.equal(r.code, 0, `collect-status (merged): unexpected exit code, stderr: ${r.error}`);
  mergedJson = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
});
after(() => { clean(mergedK.root); clean(mergedGh.dir); clean(mergedTmp); });

test("merge commits on main inflate `pr` but not openPrs or prCommits", () => {
  assert.equal(mergedJson.openPrs, 2, "still two open PRs");
  assert.equal(mergedJson.prCommits, 2, "still two commits on them");
  assert.equal(mergedJson.pr, 5, "the old field counted the 3 merge commits on main as well: it never was a PR count");
});

test("openPrs is null, not 0, when gh could not be read", () => {
  assert.equal(noRemoteOutput.json.openPrs, null);
  assert.equal(noRemoteOutput.json.prCommits, 0);
});

// ---- a deleted author, and a list that hit gh's limit (review) ----
test("a PR whose author account is gone is read (as ghost) and does not turn every PR into 'could not read'; 30 listed PRs are said to be capped", async () => {
  const K2 = await fakeProductSetup(), dirs = [K2.root];
  try {
    const fx = JSON.parse(JSON.stringify(K2.gh));
    fx.prListNoR[0].author = null;                       // gh's answer for a deleted account
    fx.prListNoR[0].commits[0].authors = [];
    const g1 = fakeGhSetup(fx); dirs.push(g1.dir);
    const t = temporary("nosy-status-ghost-"); dirs.push(t);
    const a = path.join(t, "a.json");
    assert.equal(run(path.join(Tool, "collect-status.mjs"), [K2.repo, "2020-01-01", "origin/main", "--json", a], { env: g1.env }).code, 0);
    const J = JSON.parse(fs.readFileSync(a, "utf8"));
    assert.equal(J.noRemote, false, "gh was read");
    assert.equal(J.openPrs, fx.prListNoR.length);
    assert.equal(J.prs.find(p => p.n === 615).a, "ghost");
    assert.ok(!("openPrsCapped" in J), "two PRs are not a full list");
    // 30 PRs: the list is as long as gh was asked for, so it may be longer
    while (fx.prListNoR.length < 30) { const c = JSON.parse(JSON.stringify(fx.prListNoR[1])); c.number = 700 + fx.prListNoR.length; fx.prListNoR.push(c); }
    const g2 = fakeGhSetup(fx); dirs.push(g2.dir);
    const b = path.join(t, "b.json");
    assert.equal(run(path.join(Tool, "collect-status.mjs"), [K2.repo, "2020-01-01", "origin/main", "--json", b], { env: g2.env }).code, 0);
    const C = JSON.parse(fs.readFileSync(b, "utf8"));
    assert.equal(C.openPrs, 30);
    assert.equal(C.openPrsCapped, true);
  } finally { for (const d of dirs) clean(d); }
});
