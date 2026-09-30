#!/usr/bin/env node
// Nosy · SessionStart hook.
//
// Its only job: if pm/ exists in the working folder, print the first pick of
// skill/tools/next.mjs as one "Psst…" line (what to run next and why), or print
// nothing when nothing is stale. It used to whisper only psst's list; now it's
// whatever next.mjs ranks first, psst included. Reads pm/ and runs a few local `git log` calls; no
// network, no gh, never writes to the project. Any failure stays silent: never block SessionStart.
// The file keeps its name so hooks.json and existing installs don't change.
//
// One exception to "quiet where there is no pm/": the FIRST session after install says three lines once
// (skill/tools/loaded.mjs: Nosy is loaded and N commands, which hooks are on, whether pm/ exists and what to run
// next), because "installed" is not "loaded" and a stranger needs to see that it worked. "Once" is a marker in the
// plugin's data folder (or the temp folder); when it can't be written, or the summary is off, nothing is said.
//
// To turn it off (see docs/INSTALL.md, f):
//   - Check "Disable startup summary" via `/plugin configure nosy@<marketplace-name>`, OR
//   - Env var: NOSY_NO_PSST=1  (also silences the first-run lines)
//   - To silence the plugin entirely: `/plugin disable nosy` (this also disables commands).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readStdinCwd() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    if (!raw) return null;
    const input = JSON.parse(raw);
    return typeof input.cwd === "string" && input.cwd ? input.cwd : null;
  } catch {
    return null;
  }
}

function hookDisabled() {
  // Either switch turns it off: an option Claude Code exports as "false" (its default) must not hide a NOSY_NO_* you set yourself.
  const on = v => ["1", "true", "on", "yes"].includes(String(v ?? "").toLowerCase());
  return on(process.env.CLAUDE_PLUGIN_OPTION_DISABLE_PSST_HOOK) || on(process.env.NOSY_NO_PSST);
}

async function main() {
  if (hookDisabled()) return;

  const cwd = readStdinCwd() || process.cwd();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pm = path.join(cwd, "pm");

  // The first session after install: three lines, once.
  let hello = null;
  try {
    const M = await import(path.join(here, "..", "skill", "tools", "loaded.mjs"));
    if (M.claimFirstRun()) hello = M.render(M.status({ cwd }), { prefix: "/nosy:" });
  } catch {}

  // Not moved in: stay quiet (bar the first-run lines and a to-do list that exists). Nosy shouldn't nag in every repo the owner opens.
  let whisper = null;
  if (fs.existsSync(path.join(pm, "sources.json"))) {
    try {
      process.chdir(cwd); // sources.json's repo path is relative to the project folder
      const { next } = await import(path.join(here, "..", "skill", "tools", "next.mjs"));
      const pick = next(pm).picks[0];
      // "stakeout" is next.mjs's "nothing is stale" answer: nothing to whisper.
      if (pick && pick.command !== "stakeout") whisper = `Psst… next: /nosy:${pick.command} (${pick.reason}). More: /nosy:nosy`;
    } catch {
      // stay silent; never block SessionStart
    }
  }

  // What waits on a person (skill/tools/todo.mjs, pm/todo/): said at every start, because the point is that it isn't forgotten.
  // Local files only. Nothing to say when nothing is open.
  let waiting = null;
  try {
    if (fs.existsSync(path.join(pm, "todo"))) {
      const { todoSummary, todoLine } = await import(path.join(here, "..", "skill", "tools", "todo.mjs"));
      const { nosyCommand } = await import(path.join(here, "..", "skill", "tools", "hints.mjs"));
      const said = todoLine(todoSummary(pm));
      if (said) waiting = `Psst… ${said}. These are for a person, not for you. \`${nosyCommand("todo")}\` lists them, \`${nosyCommand("todo done <id>")}\` closes one.`;
    }
  } catch {
    // stay silent; never block SessionStart
  }
  const say = [whisper, waiting].filter(Boolean).join("\n");

  if (hello) {
    // systemMessage is what the owner sees; the agent gets the whisper (if any) as context, as before.
    process.stdout.write(JSON.stringify({ systemMessage: hello,
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: say ? `${say}\n` : "Nosy's first-run lines were shown to the owner; no need to repeat them." } }));
  } else if (say) process.stdout.write(say + "\n");
}

main();
