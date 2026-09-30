// Contract test for skill/tools/audit-package.mjs: do the local-path links in AGENTS.md
// and the adapters exist, does the command list match between AGENTS.md ↔ SKILL.md. Never touches the real
// repo; builds a small fake "package" folder tree (AGENTS.md, .cursor/rules/nosy.mdc, .gemini/settings.json,
// skill/SKILL.md, skill/commands/*.md, skill/rules.md).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const AGENTS_MD = `# Nosy

See \`<skill>/SKILL.md\`, rules at \`<skill>/rules.md\`. Commands live at \`skill/commands/<name>.md\`.

| Command | What it does | Steps |
|---|---|---|
| \`move-in\` | Learns your product | \`<skill>/commands/move-in.md\` |
| \`peek\` | What shipped | \`<skill>/commands/peek.md\` |

Test: \`node --test skill/test/*.test.mjs\`.
`;

const SKILL_MD = `---
name: nosy
---
| Command | What it does | Detail |
|---|---|---|
| \`move-in\` | Learns your product | \`commands/move-in.md\` |
| \`peek\` | What shipped | \`commands/peek.md\` |
`;

const CURSOR_MDC = `---
description: Nosy
alwaysApply: false
---
See \`AGENTS.md\` and \`skill/commands/<name>.md\`.
`;

const README_MD = `# Nosy

| Command | What it does |
|---|---|
| \`/nosy:move-in\` | Learns your product |
| \`/nosy:peek\` | What shipped |
`;

function packageSetup(root) {
  fs.mkdirSync(path.join(root, ".cursor", "rules"), { recursive: true });
  fs.mkdirSync(path.join(root, ".gemini"), { recursive: true });
  fs.mkdirSync(path.join(root, "skill", "commands"), { recursive: true });
  fs.mkdirSync(path.join(root, "commands"), { recursive: true });
  fs.writeFileSync(path.join(root, "AGENTS.md"), AGENTS_MD);
  fs.writeFileSync(path.join(root, "README.md"), README_MD);
  fs.writeFileSync(path.join(root, ".cursor", "rules", "nosy.mdc"), CURSOR_MDC);
  fs.writeFileSync(path.join(root, ".gemini", "settings.json"), JSON.stringify({ context: { fileName: ["AGENTS.md", "GEMINI.md"] } }));
  fs.writeFileSync(path.join(root, "skill", "SKILL.md"), SKILL_MD);
  fs.writeFileSync(path.join(root, "skill", "rules.md"), "# rules\n");
  fs.writeFileSync(path.join(root, "skill", "commands", "move-in.md"), "# move-in\n");
  fs.writeFileSync(path.join(root, "skill", "commands", "peek.md"), "# peek\n");
  fs.writeFileSync(path.join(root, "commands", "move-in.md"), "# move-in\n");
  fs.writeFileSync(path.join(root, "commands", "peek.md"), "# peek\n");
}

let root;
before(() => { root = temporary("nosy-audit-package-"); packageSetup(root); });
after(() => clean(root));

test("a correct package: every row ✓, exit code 0", () => {
  const r = run(path.join(Tool, "audit-package.mjs"), [root]);
  assert.equal(r.code, 0, `stderr: ${r.error}\n${r.output}`);
  assert.doesNotMatch(r.output, /✗/);
  assert.match(r.output, /AGENTS\.md and SKILL\.md match/);
});

test("a broken path in AGENTS.md: ✗ and exit code 2", () => {
  const root2 = temporary("nosy-audit-package-broken-");
  try {
    packageSetup(root2);
    fs.writeFileSync(path.join(root2, "AGENTS.md"), AGENTS_MD.replace("<skill>/commands/peek.md", "<skill>/commands/missing.md"));
    const r = run(path.join(Tool, "audit-package.mjs"), [root2]);
    assert.equal(r.code, 2);
    assert.match(r.output, /missing\.md.*✗|✗.*missing\.md|not in the repo/s);
  } finally {
    clean(root2);
  }
});

test("command list mismatch: a command in SKILL.md but not AGENTS.md gives ✗", () => {
  const root3 = temporary("nosy-audit-package-diff-");
  try {
    packageSetup(root3);
    const skillExcess = SKILL_MD + `| \`scoop\` | Roadmap | \`commands/scoop.md\` |\n`;
    fs.writeFileSync(path.join(root3, "skill", "SKILL.md"), skillExcess);
    const r = run(path.join(Tool, "audit-package.mjs"), [root3]);
    assert.equal(r.code, 2);
    assert.match(r.output, /missing.*scoop|scoop.*missing/i);
  } finally {
    clean(root3);
  }
});

test("a command in the README but not commands/ or skill/commands/ gives ✗", () => {
  const root5 = temporary("nosy-audit-package-readme-");
  try {
    packageSetup(root5);
    fs.writeFileSync(path.join(root5, "README.md"), README_MD + `\n| \`/nosy:nopath\` | Missing |\n`);
    const r = run(path.join(Tool, "audit-package.mjs"), [root5]);
    assert.equal(r.code, 2);
    assert.match(r.output, /README\.md → commands\/.*✗|✗.*README\.md → commands\//s);
    assert.match(r.output, /nopath/);
  } finally {
    clean(root5);
  }
});

test("✗ when the commands/ and skill/commands/ command sets differ", () => {
  const root6 = temporary("nosy-audit-package-parity-");
  try {
    packageSetup(root6);
    fs.writeFileSync(path.join(root6, "commands", "commands-only.md"), "# commands only\n");
    const r = run(path.join(Tool, "audit-package.mjs"), [root6]);
    assert.equal(r.code, 2);
    assert.match(r.output, /missing from skill\/commands\/.*commands-only|commands-only.*skill\/commands/s);
  } finally {
    clean(root6);
  }
});

test("a command in commands/ that's never mentioned in the README gives ✗", () => {
  const root7 = temporary("nosy-audit-package-reverse-");
  try {
    packageSetup(root7);
    fs.writeFileSync(path.join(root7, "commands", "hidden.md"), "# hidden\n");
    fs.writeFileSync(path.join(root7, "skill", "commands", "hidden.md"), "# hidden\n");
    const r = run(path.join(Tool, "audit-package.mjs"), [root7]);
    assert.equal(r.code, 2);
    assert.match(r.output, /commands\/ → README\.md.*✗.*\/nosy:hidden/s);
  } finally {
    clean(root7);
  }
});

test("a correct package (including README + commands/): README command parity is also ✓", () => {
  const r = run(path.join(Tool, "audit-package.mjs"), [root]);
  assert.equal(r.code, 0, `stderr: ${r.error}\n${r.output}`);
  assert.match(r.output, /README\.md → commands\/.*✓|✓.*README\.md → commands\//s);
  assert.match(r.output, /commands\/ ↔ skill\/commands\/.*✓|✓.*commands\/ ↔ skill\/commands\//s);
  assert.match(r.output, /commands\/ → README\.md.*✓/s);
});

test(".gemini/settings.json not listing AGENTS.md gives ✗", () => {
  const root4 = temporary("nosy-audit-package-gemini-");
  try {
    packageSetup(root4);
    fs.writeFileSync(path.join(root4, ".gemini", "settings.json"), JSON.stringify({ context: { fileName: ["GEMINI.md"] } }));
    const r = run(path.join(Tool, "audit-package.mjs"), [root4]);
    assert.equal(r.code, 2);
    assert.match(r.output, /\.gemini\/settings\.json.*✗|✗.*\.gemini\/settings\.json/s);
  } finally {
    clean(root4);
  }
});
