// Contract tests for tools/build-waves.mjs: lowhanging.json (+ status/size/signal optional) gives wave
// names, a "· in PR" item lands in "When code lands", "Status may be stale" lands in "Documentation fix",
// a matrix decision:"notDoing" line lands in "outside", a decision saying "haven't decided yet" lands in
// owner_decision_of, and both matrix shapes (line/step) give inputs.matris:true. Fake product "Cargo".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";

let K, gh, tmp;

before(async () => { K = await fakeProductSetup(); gh = fakeGhSetup(K.gh); tmp = temporary("nosy-buildwaves-"); });
after(() => { clean(K.root); clean(gh.dir); clean(tmp); });

const WAVE_NAMES_OF = ["Now", "When code lands", "Needs backend", "Open requests", "Documentation fix", "After"];

test("line-shaped matrix (pm/matrix.json, OLD): wave names, a PR item lands in 'When code lands', decision:notDoing lands in 'outside'", () => {
  const lowPath = path.join(tmp, "lowhanging.json");
  const rLow = run(path.join(Tool, "lowhanging.mjs"), [K.pm, "--json", lowPath], { env: gh.env });
  assert.equal(rLow.code, 0, `lowhanging failed: ${rLow.error}`);

  const statusDir = path.join(K.pm, "state");
  fs.mkdirSync(statusDir, { recursive: true });
  fs.copyFileSync(lowPath, path.join(statusDir, "lowhanging.json"));

  const jsonPath = path.join(tmp, "waves.json");
  const r = run(path.join(Tool, "build-waves.mjs"), [K.pm, "--json", jsonPath]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(j.type, "waves");
  const names = j.waves.map(d => d.name);
  for (const name of WAVE_NAMES_OF) assert.ok(names.includes(name), `missing wave: ${name}`);

  // §22: sinks with " · in PR" in lowhanging (see lowhanging.test.mjs); build-waves should place it in "When code lands".
  const codeWhenItComes = j.waves.find(d => d.name === "When code lands");
  assert.ok(codeWhenItComes.tasks.some(i => i.ref === "§22" || /§22/.test(i.title)), "§22 (work in PR) should be in 'When code lands'");

  // pm/matrix.json (line shape): the "Route optimization" line has decision:"notDoing" - should be in "outside".
  assert.ok(j.outside.some(d => /Route optimization/.test(d.title)), "a decision:notDoing line should show up in 'outside'");
  assert.ok(j.inputs.matrix, "the line-shaped matrix should be recognized (inputs.matris true)");

  fs.rmSync(path.join(statusDir, "lowhanging.json"), { force: true });
});

test("§7 'Status may be stale' lands in 'Documentation fix'; the matrix.json built by build-matrix (step shape) also gives inputs.matris:true", () => {
  const lowPath = path.join(tmp, "lowhanging2.json");
  const rLow = run(path.join(Tool, "lowhanging.mjs"), [K.pm, "--json", lowPath], { env: gh.env });
  assert.equal(rLow.code, 0);
  const low = JSON.parse(fs.readFileSync(lowPath, "utf8"));
  assert.ok(low.items.some(m => m.type === "Status may be stale"), "precondition: lowhanging should produce the §7 signal");

  // Work on a copy of pm: switch to the matrix.json PRODUCED by build-matrix.mjs (step shape).
  const copyPm = temporary("nosy-buildwaves-step-");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  const rMt = run(path.join(Tool, "build-matrix.mjs"), [copyPm]);
  assert.equal(rMt.code, 0, `build-matrix failed: ${rMt.error}`);
  const kj = JSON.parse(fs.readFileSync(path.join(copyPm, "sources.json"), "utf8"));
  kj.matrix = path.join(copyPm, "matrix.json");
  fs.writeFileSync(path.join(copyPm, "sources.json"), JSON.stringify(kj, null, 1));

  const statusDir = path.join(copyPm, "state");
  fs.mkdirSync(statusDir, { recursive: true });
  fs.writeFileSync(path.join(statusDir, "lowhanging.json"), JSON.stringify(low, null, 1));

  const jsonPath = path.join(tmp, "waves-step.json");
  const r = run(path.join(Tool, "build-waves.mjs"), [copyPm, "--json", jsonPath]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.ok(j.inputs.matrix, "the step-shaped matrix.json (from build-matrix) should also be recognized");

  const document = j.waves.find(d => d.name === "Documentation fix");
  assert.ok(document.tasks.some(i => /§7/.test(i.ref || i.title)), "§7 (Status may be stale) should be in 'Documentation fix'");

  clean(copyPm);
});

test("work whose decisions.md says 'haven't decided yet' is listed in owner_decision_of", () => {
  const copyPm = temporary("nosy-buildwaves-waiting-");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  // lowhanging's "Issue opened against us" item carries ref #701 (see lowhanging.test.mjs); we add a
  // "haven't decided yet" block to decisions.md carrying the same ref (#701) to trigger build-waves's ref
  // matching (bestTextFind) with hard evidence, instead of relying on fuzzy title similarity.
  fs.writeFileSync(path.join(copyPm, "decisions.md"),
    "- **On #701 (Alex):** haven't decided yet, I'll talk to the owner.\n");

  const statusDir = path.join(copyPm, "state");
  fs.mkdirSync(statusDir, { recursive: true });
  const lowPath = path.join(tmp, "lowhanging3.json");
  const rLow = run(path.join(Tool, "lowhanging.mjs"), [K.pm, "--json", lowPath], { env: gh.env });
  assert.equal(rLow.code, 0);
  fs.copyFileSync(lowPath, path.join(statusDir, "lowhanging.json"));

  const jsonPath = path.join(tmp, "waves-waiting.json");
  const r = run(path.join(Tool, "build-waves.mjs"), [copyPm, "--json", jsonPath]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.ok(j.owner_decision_of.some(s => /Bulk shipment export request|#701/.test(s.title) || /haven't decided yet/.test(s.reason)),
    `expected an item matching "haven't decided yet" in owner_decision_of: ${JSON.stringify(j.owner_decision_of)}`);

  clean(copyPm);
});

// text similarity never marks something shipped/present: bestFind()'s title-similarity
// fallback used to be indistinguishable from an explicit ref match - a psst item whose title merely SOUNDS
// like a matrix row with code "b" got the same plain "backend ready" wording as a real ref match. bestFind
// now exposes matchedBy ("ref" | "text"); a text-only match must read as "candidate - confirm", never as a
// settled backend-ready/present-in-rivals fact. A ref match (the matrix's own "Bulk export" / "§3" row,
// added automatically from matrixLine) must still read as plain fact, unchanged.
test("matrix match by title similarity only reads as 'candidate — confirm', not 'backend ready'; a ref match is unaffected", () => {
  const copyPm = temporary("nosy-buildwaves-provenance-");
  fs.cpSync(K.pm, copyPm, { recursive: true });

  // No ref anywhere in title/evidence - only close enough wording to the matrix's "Bulk export" row
  // (code "b" for Cargo) to pass build-waves' own title-similarity threshold.
  const fuzzyItem = {
    score: 1, effort: "M", type: "Common among rivals, partial for us",
    title: "Shipment bulk export screen for reports",
    evidence: "no explicit reference here, only similar wording to the matrix row",
    detail: [], ref: null, demand: null,
  };
  const statusDir = path.join(copyPm, "state");
  fs.mkdirSync(statusDir, { recursive: true });
  fs.writeFileSync(path.join(statusDir, "lowhanging.json"), JSON.stringify({ type: "lowHanging", items: [fuzzyItem] }, null, 1));

  const jsonPath = path.join(tmp, "waves-provenance.json");
  const r = run(path.join(Tool, "build-waves.mjs"), [copyPm, "--json", jsonPath]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const allTasks = j.waves.flatMap(d => d.tasks);
  const fuzzy = allTasks.find(t => t.title === fuzzyItem.title);
  assert.ok(fuzzy, `expected the fuzzy-titled item to produce a task: ${JSON.stringify(allTasks.map(t => t.title))}`);
  assert.match(fuzzy.reason_now, /candidate — confirm/, "a title-similarity-only matrix match must be labeled a candidate");
  assert.doesNotMatch(fuzzy.reason_now, /^backend ready \(|[^—]backend ready \(/, "must not assert 'backend ready' from a text-only match");
  assert.doesNotMatch(fuzzy.reason_now, /(?<!confirm: possibly )present in \d+ rivals/, "a rival-presence claim off the same text-only match must also read as a candidate");

  // The matrix's own "Bulk export" row is a REF match (§3, from its own `not` text) and is added as its own
  // task independent of the fuzzy item above; that one keeps the plain, unhedged wording.
  const refMatched = allTasks.find(t => t.title === "Bulk export");
  assert.ok(refMatched, `expected the matrix's own ref-matched 'Bulk export' task: ${JSON.stringify(allTasks.map(t => t.title))}`);
  assert.match(refMatched.reason_now, /backend ready \(/, "an explicit ref match must keep the plain 'backend ready' wording");
  assert.doesNotMatch(refMatched.reason_now, /candidate — confirm/, "a ref match must not be hedged as a candidate");

  clean(copyPm);
});

// the suggested capacity used to be "every status.json author x 5 days" - on a real
// OSS repo that's bots and one-off drive-by contributors counted the same as core team members. Works on an
// ISOLATED copy of the repo (fs.cpSync of Cargo's .git) so the extra commits below don't leak into the
// shared fixture other tests in this file rely on; `origin/main` is repointed locally (no push to the
// shared bare repo).
test("suggested capacity excludes bots and drive-by authors, and states the basis", () => {
  const copyRepo = temporary("nosy-buildwaves-capacity-repo-");
  fs.rmSync(copyRepo, { recursive: true, force: true });
  fs.cpSync(K.repo, copyRepo, { recursive: true });
  const gitC = (args, env) => execFileSync("git", args, { cwd: copyRepo, encoding: "utf8", env: { ...process.env, ...env } });
  const commit = (author, email, message, file, content) => {
    fs.writeFileSync(path.join(copyRepo, file), content);
    gitC(["add", "-A"]);
    gitC(["commit", "-q", "-m", message], { GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: email });
  };
  // A bot with SEVERAL commits (proves exclusion is structural, not the drive-by commit-count rule)...
  commit("github-actions[bot]", "41898282+github-actions[bot]@users.noreply.github.com", "chore: ci bump 1", "ci1.txt", "1");
  commit("github-actions[bot]", "41898282+github-actions[bot]@users.noreply.github.com", "chore: ci bump 2", "ci2.txt", "2");
  commit("github-actions[bot]", "41898282+github-actions[bot]@users.noreply.github.com", "chore: ci bump 3", "ci3.txt", "3");
  // ...and a one-commit human drive-by.
  commit("Dana Driveby", "dana@cargo.test", "fix: typo", "typo.txt", "x");
  gitC(["update-ref", "refs/remotes/origin/main", "main"]); // repoint origin/main locally, no push

  const copyPm = temporary("nosy-buildwaves-capacity-pm-");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  const kj = JSON.parse(fs.readFileSync(path.join(copyPm, "sources.json"), "utf8"));
  kj.repo = copyRepo;
  fs.writeFileSync(path.join(copyPm, "sources.json"), JSON.stringify(kj, null, 1));
  const statusDir = path.join(copyPm, "state");
  fs.mkdirSync(statusDir, { recursive: true });
  // Only needs to be non-empty to turn on the capacity suggestion; the actual authors now come from git, not this file.
  fs.writeFileSync(path.join(statusDir, "status.json"), JSON.stringify({ groups: [{ ref: "K1", who: ["Alice Moore"] }], prs: [] }, null, 1));
  fs.writeFileSync(path.join(statusDir, "lowhanging.json"), JSON.stringify({ type: "lowHanging", items: [] }, null, 1));

  const jsonPath = path.join(tmp, "waves-capacity.json");
  const r = run(path.join(Tool, "build-waves.mjs"), [copyPm, "--json", jsonPath]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const cap = j.capacity;
  assert.ok(cap, "expected a capacity suggestion");
  assert.equal(cap.applied, false);
  assert.ok(cap.bots >= 1, `expected at least 1 bot excluded: ${JSON.stringify(cap)}`);
  assert.ok(cap.driveBy >= 1, `expected at least 1 drive-by author excluded: ${JSON.stringify(cap)}`);
  assert.equal(cap.suggested_day, cap.regular * 5);
  assert.match(cap.source, /^capacity: \d+ regular authors? \(\d+ excluded: \d+ bots?, \d+ drive-by\)$/, `unexpected capacity basis wording: ${cap.source}`);
  // Alice and Ben are Cargo's real multi-commit, multi-day contributors (fake-product.mjs) - they must stay
  // counted as regular. Cara only has 2 commits in the whole fixture, so she - like the new one-commit Dana -
  // correctly falls under the drive-by threshold; that's the rule working, not a test bug.
  assert.ok(cap.regular >= 2, `expected Alice and Ben to remain regular authors: ${JSON.stringify(cap)}`);
  assert.equal(cap.bots, 2, `expected exactly 2 bots excluded (dependabot from the fixture + github-actions added here): ${JSON.stringify(cap)}`);

  clean(copyRepo);
  clean(copyPm);
});

test("held items wait on the owner, refuted ones go outside, checked ones lead Now as their own tasks", () => {
  const st = path.join(K.pm, "state"); fs.mkdirSync(st, { recursive: true });
  const saved = Object.fromEntries(["lowhanging.json", "lowhanging.filtered.json", "receipts.json", "psst-final.json"].map(f => [f, fs.existsSync(path.join(st, f)) ? fs.readFileSync(path.join(st, f)) : null]));
  try {
    fs.rmSync(path.join(st, "lowhanging.filtered.json"), { force: true });
    fs.writeFileSync(path.join(st, "lowhanging.json"), JSON.stringify({ items: [
      { score: 3, effort: "S", type: "Backend ready, not on screen", title: "#385 record · 2 fields", evidence: "web/mapper.ts:46", detail: [], ref: "#385" },
      { score: 3, effort: "S", type: "Backend ready, not on screen", title: "review · 1 fields", evidence: "web/review.ts:24", detail: [], ref: null },
      { score: 3, effort: "S", type: "Endpoint exists, no screen", title: "exports · 1 endpoints", evidence: "api/routes.go:9", detail: [], ref: null },
    ] }));
    fs.writeFileSync(path.join(st, "receipts.json"), JSON.stringify({ items: [
      { rank: 1, title: "#385 record · 2 fields", gate: { held: true, because: [{ at: "web/mapper.ts:46", refs: ["#385"], decisions: [] }] } },
      { rank: 2, title: "review · 1 fields", gate: null },
    ] }));
    fs.writeFileSync(path.join(st, "psst-final.json"), JSON.stringify({
      items: [{ id: "a", title: "Strike the stale §28 lines", verdict: "stands", size: "S", evidence: ["docs/NEEDS.md:565"], receipt: 2 },
              { id: "b", title: "Review history", verdict: "weakened", size: "S", fix: "M: needs a roster lookup", evidence: ["web/review.ts:24"], receipt: 2 }],
      dropped: [{ id: "c", title: "Source section", why: "parked (#385)" }] }));
    const jsonPath = path.join(tmp, "waves-134.json");
    const r = run(path.join(Tool, "build-waves.mjs"), [K.pm, "--json", jsonPath]);
    assert.equal(r.code, 0, r.error);
    const j = JSON.parse(fs.readFileSync(jsonPath, "utf8")), now = j.waves.find(w => w.name === "Now").tasks;
    assert.deepEqual(now.slice(0, 2).map(t => [t.title, t.checked, t.effort]), [["Strike the stale §28 lines", "stands", "S"], ["Review history", "weakened", "M"]]);
    assert.ok(!now.some(t => /#385 record/.test(t.title)), "held item is not in Now");
    assert.ok(j.owner_decision_of.some(o => /#385 record/.test(o.title) && /held on purpose/.test(o.reason)));
    assert.ok(j.outside.some(o => o.title === "Source section" && /refuted after checking/.test(o.reason)));
    assert.ok(now.some(t => t.title === "review · 1 fields"), "the raw item a draft used as a receipt stays its own task");
    assert.match(j.waves.flatMap(w => w.tasks).find(t => /exports/.test(t.title)).reason_now, /^unchecked \(no receipt yet\)/);
  } finally {
    for (const [f, b] of Object.entries(saved)) { const p = path.join(st, f); if (b) fs.writeFileSync(p, b); else fs.rmSync(p, { force: true }); }
  }
});
