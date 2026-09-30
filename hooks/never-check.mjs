#!/usr/bin/env node
// Nosy · PostToolUse hook on Bash: after the agent runs `git commit` or `gh pr create`, check what just went in
// against the product's never rules (pm/sources.json `preread.never`) with skill/tools/never-check.mjs, and
// check the git/gh command itself too (a rule like "git add -A" is about how work is done). A match comes back
// to the agent as a PostToolUse "block" reason: the command has already run, nothing is undone or stopped; the
// agent is told, so it can tell the owner before anything is pushed. No match, no pm/, any error: silent.
// Off: "Turn off the never-rule check" in `/plugin configure`, or NOSY_NO_NEVER_CHECK=1. Runs next to after-commit.mjs
// (the product nudge); this one is only about the owner's never rules.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";

// Either switch turns it off: an option Claude Code exports as "false" (its default) must not hide a NOSY_NO_* you set yourself.
const off = v => ["1", "true", "on", "yes"].includes(String(v ?? "").toLowerCase());
async function main() {
  if (off(process.env.CLAUDE_PLUGIN_OPTION_DISABLE_NEVER_CHECK) || off(process.env.NOSY_NO_NEVER_CHECK)) return;
  let input; try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { return; }
  const cmd = String(input?.tool_input?.command || ""), cwd = input?.cwd || process.cwd();
  if (!/\b(git|gh)\s/.test(cmd)) return;
  // pm/ next to where the command ran, or at the repo root (the same lookup as after-commit.mjs).
  let top = cwd; try { top = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
  const pm = [process.env.NOSY_PM && path.resolve(cwd, process.env.NOSY_PM), path.join(cwd, "pm"), path.join(top, "pm")].filter(Boolean).find(p => fs.existsSync(path.join(p, "sources.json")));
  if (!pm) return;
  let K; try { K = JSON.parse(fs.readFileSync(path.join(pm, "sources.json"), "utf8").replace(/^\uFEFF/, "")); } catch { return; }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const { check, diffOf, rulesOf, render } = await import(path.join(here, "..", "skill", "tools", "never-check.mjs"));
  const rules = rulesOf(K); if (!rules.length) return;
  const parts = [];
  // The command itself (only git/gh commands, so a rule about "mock" doesn't fire on every test run).
  const cmdHits = rules.filter(r => r.re.test(cmd));
  if (cmdHits.length) parts.push(`Psst… this command matches this product's never list: ${cmdHits.map(r => `**${r.name}**`).join(", ")} (\`${cmd.slice(0, 120)}\`).`);
  // What just went in.
  const commit = /\bgit\b(?:\s+-C\s+\S+)?(?:\s+-c\s+\S+)*\s+commit\b/.test(cmd), pr = /\bgh\s+pr\s+create\b/.test(cmd);
  if (commit || pr) {
    const repo = path.resolve(path.dirname(pm), K.repo || "."), base = K.integrationBranch || K.ref || "main";
    try {
      process.chdir(path.dirname(pm));
      const R = check(K, diffOf(repo, commit ? { mode: "last-commit" } : { mode: "base", base }));
      if (R.hits.length) parts.push(render(R, { what: commit ? "the commit you just made" : `this PR's changes since ${base}` }));
    } catch {}
  }
  if (!parts.length) return;
  const reason = parts.join("\n\n") + "\n\n(Nosy never-check; nothing was undone. Tell the owner before pushing or merging.)";
  process.stdout.write(JSON.stringify({ decision: "block", reason, hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: reason } }));
}
main().catch(() => {});
