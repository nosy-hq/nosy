// Contract test for skill/tools/ai-note.mjs. Reuses dresscode.test.mjs's "Cargo web"
// fixture product (registry.ts: button/table/old-select) instead of building a new one.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const REGISTRY = `export const registry = [
  { module: "button", exports: ["Button"], category: "actions", status: "stable", use: "Every action.", notFor: "Navigation.", a11y: "Native button." },
  { module: "table", exports: ["Table"], category: "data", status: "beta", use: "Rows.", a11y: "Native table." },
  { module: "old-select", exports: ["OldSelect"], category: "inputs", status: "legacy", insteadOf: "select", use: "Do not use." },
];
`;
const TOKENS = JSON.stringify({ color: { primary: { $value: "#0b5563" }, destructive: { $value: "#b42318" } }, density: { "row-h": { $value: "44px" } }, radius: { control: { $value: "6px" } } });
const DESIGN = "# Design System: Cargo\n\n## Colors\nPrimary is petrol.\n";

function gitRepo(dir, files) {
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); }
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (!fs.existsSync(path.join(dir, ".git"))) g("init", "-q", "-b", "main");
  g("add", "."); g("commit", "-q", "-m", "ds");
}

let root, repo, pm;
before(() => {
  root = temporary("nosy-ai-note-"); repo = path.join(root, "repo"); pm = path.join(root, "pm");
  gitRepo(repo, {
    "apps/web/DESIGN.md": DESIGN,
    "apps/web/design-tokens.json": TOKENS,
    "apps/web/src/components/ui/registry.ts": REGISTRY,
    "apps/web/src/components/ui/button.tsx": "export {}\n",
  });
  fs.mkdirSync(pm, { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "main" }));
});
after(() => clean(root));

function outputFile(dir, text) { const f = path.join(dir, "out.md"); fs.writeFileSync(f, text); return f; }

test("on-record names are ✓, exit 0", () => {
  const d = temporary("nosy-ai-note-run-");
  try {
    const f = outputFile(d, "Build this with `button` and `table`. See apps/web/DESIGN.md:4 for color.");
    const r = run(path.join(Tool, "ai-note.mjs"), [pm, f]);
    assert.equal(r.code, 0, r.error);
    assert.match(r.output, /`button` \| ✓ \| component/);
    assert.match(r.output, /`table` \| ✓ \| component/);
    assert.match(r.output, /\*\*2 on record · 0 close · 0 invented\.\*\*/);
    assert.ok(!r.output.includes("DESIGN.md"), "a file:line citation is not a candidate name");
  } finally { clean(d); }
});

test("a plainly invented name is ✗ and exits 2", () => {
  const d = temporary("nosy-ai-note-run-");
  try {
    const f = outputFile(d, "Use `frobnicator` for the bulk bar.");
    const r = run(path.join(Tool, "ai-note.mjs"), [pm, f]);
    assert.equal(r.code, 2);
    assert.match(r.output, /`frobnicator` \| ✗ \|/);
    assert.match(r.output, /1 invented/);
    assert.match(r.output, /Invented \(not on record, no close match\): `frobnicator`/);
  } finally { clean(d); }
});

test("a near-miss (typo/rename) is flagged 'did you mean' - not counted as invented, exit 0", () => {
  const d = temporary("nosy-ai-note-run-");
  try {
    const f = outputFile(d, "Use `buttton` and `tables`."); // 1-edit typo; plural of table (same stem)
    const r = run(path.join(Tool, "ai-note.mjs"), [pm, f]);
    assert.equal(r.code, 0, r.error);
    assert.match(r.output, /`buttton` \| did you mean `button`\? \|/);
    assert.match(r.output, /`tables` \| did you mean `table`\? \|/);
    assert.match(r.output, /\*\*0 on record · 2 close \(possible typo\/rename\) · 0 invented\.\*\*/);
  } finally { clean(d); }
});

test("a JSX tag also counts as a candidate; a token name matches too", () => {
  const d = temporary("nosy-ai-note-run-");
  try {
    const f = outputFile(d, "```tsx\n<Button />\n```\nToken: `density.row-h`.");
    const r = run(path.join(Tool, "ai-note.mjs"), [pm, f]);
    assert.equal(r.code, 0, r.error);
    assert.match(r.output, /`Button` \| ✓ \| component/);
    assert.match(r.output, /`density\.row-h` \| ✓ \| token/);
  } finally { clean(d); }
});

test("--json writes the graded list and summary", () => {
  const d = temporary("nosy-ai-note-run-");
  try {
    const f = outputFile(d, "Use `button` and `frobnicator`.");
    const jf = path.join(d, "out.json");
    const r = run(path.join(Tool, "ai-note.mjs"), [pm, f, "--json", jf]);
    assert.equal(r.code, 2);
    const j = JSON.parse(fs.readFileSync(jf, "utf8"));
    assert.equal(j.summary.on_record, 1); assert.equal(j.summary.invented, 1);
    assert.deepEqual(j.graded.map(g => g.name), ["button", "frobnicator"]);
  } finally { clean(d); }
});

test("no design system found: exit 1, doesn't crash", () => {
  const d = temporary("nosy-ai-note-run-"), emptyPm = path.join(d, "pm");
  try {
    fs.mkdirSync(emptyPm, { recursive: true });
    fs.writeFileSync(path.join(emptyPm, "sources.json"), JSON.stringify({ repo: path.join(d, "nope"), ref: "main" }));
    const f = outputFile(d, "Use `button`.");
    const r = run(path.join(Tool, "ai-note.mjs"), [emptyPm, f]);
    assert.equal(r.code, 1);
  } finally { clean(d); }
});
