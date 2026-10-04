// Every script the docs name must exist (BlogFactory incident, 4 Oct 2026: help pointed an agent at skill/tools/decision.mjs, which the dispatcher serves as
// `nosy decision` and next-decision.mjs, so the agent tried a path that isn't there). A command file, SKILL.md, AGENTS.md or a doc that names tools/<x>.mjs is wrong the day
// <x>.mjs is renamed; this test is the day.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Tool } from "./helpers.mjs";

const repo = path.join(Tool, "..", "..");
const docs = [
  "AGENTS.md", "README.md", "llms.txt", path.join("skill", "SKILL.md"), path.join("skill", "rules.md"),
  ...["docs", path.join("skill", "commands"), "commands", "agents"].flatMap(d => { try { return fs.readdirSync(path.join(repo, d)).filter(f => f.endsWith(".md")).map(f => path.join(d, f)); } catch { return []; } }),
].filter(f => fs.existsSync(path.join(repo, f)) && !/RENAMES\.md$/.test(f)); // RENAMES.md lists the old names on purpose

test("every tools/<name>.mjs and hooks/<name>.mjs a doc names is a file that exists", () => {
  const missing = [];
  for (const f of docs) {
    const text = fs.readFileSync(path.join(repo, f), "utf8");
    for (const m of text.matchAll(/(?<![\w./-])((?:skill\/)?tools\/|(?:\$\{CLAUDE_PLUGIN_ROOT\}\/)?hooks\/)([a-z0-9][a-z0-9-]*)\.mjs\b/gi)) {
      const dir = /hooks/.test(m[1]) ? "hooks" : path.join("skill", "tools"), file = path.join(repo, dir, `${m[2]}.mjs`);
      if (!fs.existsSync(file)) missing.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual([...new Set(missing)], [], "docs name scripts that aren't there");
});

test("every command a doc runs as `nosy <command>` is one the dispatcher knows", async () => {
  const src = fs.readFileSync(path.join(Tool, "nosy.mjs"), "utf8");
  const known = new Set([...src.matchAll(/^\s{2}"?([a-z][a-z0-9-]*)"?:\s*(?:\(\)|async|\{)/gm)].map(m => m[1]));
  for (const k of ["help", "version", "mcp"]) known.add(k);
  const unknown = [];
  for (const f of docs.filter(f => /README|INSTALL|AGENTS|SKILL|CLI-CONTRACT/.test(f))) {
    const text = fs.readFileSync(path.join(repo, f), "utf8");
    for (const m of text.matchAll(/(?<![\w/.-])`?nosy ([a-z][a-z0-9-]+)\b/g)) if (!known.has(m[1]) && /^(?:setup|check|explain|doctor|install|update|uninstall|peek|psst|canwe|shipped|score|bet|page|weekly|notify|publish|tiers|watch|sweep|facts|find|decision|todo|handoff|roadmap|tour|atlas|recent|notes|inventory|gates|metrics|fields|frontyard|signals|next|rivals-week|rivals-import|ship-notes|board-status|matrix-proposals|page-adopt|page-validate|history|backfill)$/.test(m[1])) unknown.push(`${f}: nosy ${m[1]}`);
  }
  assert.deepEqual([...new Set(unknown)], [], "docs run `nosy <command>` that the dispatcher doesn't have");
});
