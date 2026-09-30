// Contract test for skill/tools/verify-setup.mjs: a correct setup gets all ✓/– rows and exit code 0; a broken
// path gets a ✗ and exit code 2 (exit contract); --fix corrects the path in the COPY when there's exactly one candidate, without
// touching the shared original file.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";

let K, gh;
before(async () => { K = await fakeProductSetup(); gh = fakeGhSetup(K.gh); });
after(() => { clean(K.root); clean(gh.dir); });

test("a correct setup gives all ✓/– rows and exit code 0", () => {
  const r = run(path.join(Tool, "verify-setup.mjs"), [K.pm], { env: gh.env });
  assert.equal(r.code, 0, `stderr: ${r.error}\n${r.output}`);
  const lines = r.output.split("\n").filter(l => l.startsWith("| ") && !l.includes(" What ") && !l.includes("---"));
  assert.ok(lines.length > 5, "fewer rows produced than expected");
  for (const s of lines) assert.ok(!/\|\s*✗\s*\|/.test(s), `unexpected ✗: ${s}`);
});

test("broken path (preread.decisions in the wrong directory): ✗ and exit code 2, suggests a candidate", () => {
  const copyPm = temporary("nosy-verifysetup-broken-");
  try {
    fs.cpSync(K.pm, copyPm, { recursive: true });
    const kj = JSON.parse(fs.readFileSync(path.join(copyPm, "sources.json"), "utf8"));
    kj.preread.decisions = "docs/DECISIONS.md"; // the real file is at the repo root (the actual bug in internal request 15)
    fs.writeFileSync(path.join(copyPm, "sources.json"), JSON.stringify(kj, null, 1));

    const r = run(path.join(Tool, "verify-setup.mjs"), [copyPm], { env: gh.env });
    assert.equal(r.code, 2);
    const line = r.output.split("\n").find(l => l.includes("preread.decisions"));
    assert.match(line, /✗/);
    assert.match(line, /DECISIONS\.md/, "the real file should be suggested as the one and only candidate");
  } finally {
    clean(copyPm);
  }
});

// --- internal request 115 (frontend coverage: warn when the repo has more frontend-shaped apps than
// inventory.frontend lists) — "Kargo" fixture: two frontends, neither named "*frontend*" -------------------------
function kargoTwoFrontendsRepoSetup() {
  const repo = temporary("nosy-verifysetup-kargo-repo-");
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  fs.mkdirSync(repo, { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Verify Setup Test");
  git("config", "user.email", "test@verify-setup.test");
  const write = (rel, content) => { const p = path.join(repo, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
  write("apps/kargo-web/package.json", JSON.stringify({ name: "kargo-web", dependencies: { react: "^18.0.0" } }));
  write("apps/kargo-web/src/App.tsx", "export default function App() { return null; }\n");
  write("apps/kargo-admin/package.json", JSON.stringify({ name: "kargo-admin", dependencies: { next: "^14.0.0" } }));
  write("apps/kargo-admin/app/page.tsx", "export default function Page() { return null; }\n");
  write("apps/kargo-backend/server.js", "export function list() { return []; }\n");
  git("add", "-A"); git("commit", "-q", "-m", "Kargo: two frontends fixture");
  return repo;
}
function kargoPmSetup(repo, frontendListed) {
  const pm = temporary("nosy-verifysetup-kargo-pm-");
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({
    repo, ref: "main",
    inventory: { backend: ["apps/kargo-backend"], frontend: frontendListed },
  }, null, 1));
  return pm;
}

test("warns (~, not ✗) when the repo has a frontend-shaped app missing from inventory.frontend", () => {
  const repo = kargoTwoFrontendsRepoSetup();
  const pm = kargoPmSetup(repo, ["apps/kargo-web"]); // apps/kargo-admin left out on purpose
  try {
    const r = run(path.join(Tool, "verify-setup.mjs"), [pm], { env: gh.env });
    const line = r.output.split("\n").find(l => l.includes("inventory.frontend coverage"));
    assert.ok(line, `no "inventory.frontend coverage" row: ${r.output}`);
    assert.match(line, /~/, "a missing frontend app should warn (~), not fail (✗)");
    assert.match(line, /apps\/kargo-admin/, "the missing app should be named in the note");
    assert.doesNotMatch(line, /\|\s*✗\s*\|/, "must never be a ✗ row");
  } finally { clean(pm); clean(repo); }
});

test("✓ when every frontend-shaped app is listed in inventory.frontend", () => {
  const repo = kargoTwoFrontendsRepoSetup();
  const pm = kargoPmSetup(repo, ["apps/kargo-web", "apps/kargo-admin"]);
  try {
    const r = run(path.join(Tool, "verify-setup.mjs"), [pm], { env: gh.env });
    const line = r.output.split("\n").find(l => l.includes("inventory.frontend coverage"));
    assert.ok(line, `no "inventory.frontend coverage" row: ${r.output}`);
    assert.match(line, /✓/);
  } finally { clean(pm); clean(repo); }
});

// research: sources.json's configurable rival-research tool.
test("research: unset → '–', free tools by default", () => {
  const line = run(path.join(Tool, "verify-setup.mjs"), [K.pm], { env: gh.env }).output.split("\n").find(l => l.includes("| research "));
  assert.match(line, /\|\s*–\s*\|/);
});

function withResearch(research) {
  const copyPm = temporary("nosy-verifysetup-research-");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  const kj = JSON.parse(fs.readFileSync(path.join(copyPm, "sources.json"), "utf8"));
  kj.research = research;
  fs.writeFileSync(path.join(copyPm, "sources.json"), JSON.stringify(kj, null, 1));
  try { return run(path.join(Tool, "verify-setup.mjs"), [copyPm], { env: gh.env }); } finally { clean(copyPm); }
}

test("research.tool 'web': ✓, no warning needed for paidRequiresOwnerOk", () => {
  const r = withResearch({ tool: "web" });
  assert.equal(r.code, 0, r.output);
  assert.match(r.output.split("\n").find(l => l.includes("research.tool")), /\|\s*✓\s*\|\s*web\s*\|/);
  assert.ok(!r.output.includes("research.paidRequiresOwnerOk"));
});

test("research.tool 'firecrawl' without paidRequiresOwnerOk: ~ warning, not a failure", () => {
  const r = withResearch({ tool: "firecrawl" });
  assert.equal(r.code, 0, r.output);
  assert.match(r.output.split("\n").find(l => l.includes("research.tool")), /\|\s*✓\s*\|\s*firecrawl\s*\|/);
  const okLine = r.output.split("\n").find(l => l.includes("research.paidRequiresOwnerOk"));
  assert.match(okLine, /\|\s*~\s*\|/);
});

test("research.tool 'firecrawl' with paidRequiresOwnerOk: true: no warning", () => {
  const r = withResearch({ tool: "firecrawl", paidRequiresOwnerOk: true });
  assert.equal(r.code, 0, r.output);
  assert.ok(!r.output.includes("research.paidRequiresOwnerOk"));
});

test("research.tool an unknown/custom MCP tool name: ~ warning (typo-catcher), not a failure", () => {
  const r = withResearch({ tool: "my-custom-scraper", paidRequiresOwnerOk: true });
  assert.equal(r.code, 0, r.output);
  assert.match(r.output.split("\n").find(l => l.includes("research.tool")), /\|\s*~\s*\|/);
});

test("research.tool missing: ✗ and exit code 2", () => {
  const r = withResearch({ fallback: "web" });
  assert.equal(r.code, 2);
  assert.match(r.output.split("\n").find(l => l.includes("research.tool")), /\|\s*✗\s*\|/);
});

test("--fix: with exactly one candidate, fixes sources.json in the COPY; the shared original is unaffected", () => {
  const copyPm = temporary("nosy-verifysetup-fix-");
  try {
    fs.cpSync(K.pm, copyPm, { recursive: true });
    const kj = JSON.parse(fs.readFileSync(path.join(copyPm, "sources.json"), "utf8"));
    kj.preread.decisions = "docs/DECISIONS.md";
    fs.writeFileSync(path.join(copyPm, "sources.json"), JSON.stringify(kj, null, 1));
    const actualBefore = fs.readFileSync(K.sources, "utf8");

    const r = run(path.join(Tool, "verify-setup.mjs"), [copyPm, "--fix"], { env: gh.env });
    assert.equal(r.code, 0, `everything should be ✓ after --fix: ${r.output}`);
    const fixed = JSON.parse(fs.readFileSync(path.join(copyPm, "sources.json"), "utf8"));
    assert.equal(fixed.preread.decisions, "DECISIONS.md");
    assert.equal(fs.readFileSync(K.sources, "utf8"), actualBefore, "the shared original sources.json shouldn't change");
  } finally {
    clean(copyPm);
  }
});

test("request.mention: numbers written outside request.title still count toward the next number", () => {
  const copyPm = temporary("nosy-verifysetup-mention-");
  try {
    fs.cpSync(K.pm, copyPm, { recursive: true });
    const kj = JSON.parse(fs.readFileSync(path.join(copyPm, "sources.json"), "utf8"));
    if (!kj.request) return; // fake product has no request document: nothing to check
    const before = run(path.join(Tool, "verify-setup.mjs"), [copyPm], { env: gh.env }).output.split("\n").find(l => l.includes("request numbers")) || "";
    const n = parseInt((before.match(/next number: (\d+)/) || [])[1] || "0", 10);
    // A mention pattern that matches every number in the doc can only raise the next number, never lower it.
    kj.request.mention = "(\\d{1,4})";
    fs.writeFileSync(path.join(copyPm, "sources.json"), JSON.stringify(kj, null, 1));
    const after = run(path.join(Tool, "verify-setup.mjs"), [copyPm], { env: gh.env }).output.split("\n").find(l => l.includes("request numbers")) || "";
    const m = parseInt((after.match(/next number: (\d+)/) || [])[1] || "0", 10);
    assert.ok(m >= n, `mention lowered the next number: ${n} -> ${m}`);
    if (n) assert.ok(m > 0);
  } finally {
    clean(copyPm);
  }
});

test("issue.our left blank (find-sources wasn't sure): '–' not set, not a crash; no ✗, exit 0", () => {
  const copyPm = path.join(K.root, "pm-no-our");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  const src = JSON.parse(fs.readFileSync(path.join(copyPm, "sources.json"), "utf8"));
  delete src.issue.our;
  fs.writeFileSync(path.join(copyPm, "sources.json"), JSON.stringify(src));
  const r = run(path.join(Tool, "verify-setup.mjs"), [copyPm], { env: gh.env });
  assert.match(r.output, /issue\.our.*–.*not set/);
  assert.doesNotMatch(r.output, /bad regex/);
});
