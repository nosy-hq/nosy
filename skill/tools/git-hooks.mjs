// git-hooks: the after-commit nudge and the never-rule check, for agents that have no hooks of their own.
//
// In Claude Code the plugin runs these two after a commit (hooks/after-commit.mjs, hooks/never-check.mjs). Codex, Cursor, Gemini CLI,
// Copilot, OpenCode and Kiro have nothing like that, and the skill can only ask the agent to remember. A git hook needs no agent:
// its output lands in the result of `git commit` and `git pull`, which every agent reads, and it also runs when a person commits.
//
//   nosy git-hooks install     writes .git/hooks/post-commit and post-merge (an existing hook is kept: our block is added to it)
//   nosy git-hooks uninstall   removes only our block, and the file when nothing else is in it
//   nosy git-hooks status      which of the two carry our block
//   --dry-run                  say what would be written, write nothing
//
// What the hook runs, in this order, from the repo root and only where pm/sources.json exists: never-check.mjs (says which "never"
// rule a commit trips, exit code ignored) then nudge.mjs (the matrix gap the commit may close, the next decision, the next command).
// Both only print. The hook never fails a commit (post-commit can't, and every line ends `|| true`), sends nothing anywhere, and
// touches nothing but .git/hooks. Off for one run: NOSY_NO_GIT_HOOKS=1, or NOSY_NO_NUDGE=1 / NOSY_NO_NEVER_CHECK=1 for one half.
// The hooks folder is whatever git says (`git rev-parse --git-path hooks`), so core.hooksPath and worktrees are respected.
// Exit: 0 done or nothing to do, 1 could not run (not a repo, a hook we can't add to).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
export const HOOK_NAMES = ["post-commit", "post-merge"];
export const START = "# >>> nosy git-hook (written by `nosy git-hooks install`; `nosy git-hooks uninstall` removes this block)";
export const END = "# <<< nosy git-hook";

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** The two folders this needs: the repo's top level and its hooks folder, as git resolves them. Throws with a plain message outside a repo. */
export function locate(cwd = process.cwd()) {
  let root;
  try { root = git(["rev-parse", "--show-toplevel"], cwd); } catch { throw new Error("not inside a git repository: run this in your project's folder"); }
  const hooks = path.resolve(root, git(["rev-parse", "--git-path", "hooks"], root));
  return { root, hooks };
}

/** The shell text of our block. The tools are named relative to the repo root when the skill lives inside the repo (.agents/skills/nosy), else by absolute path. */
export function block({ root, tools = TOOLS, pm = "pm" }) {
  const rel = path.relative(root, tools);
  const at = rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? `"$NOSY_ROOT/${rel.split(path.sep).join("/")}` : `"${tools}`;
  return [START,
    'NOSY_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)',
    `if [ -n "$NOSY_ROOT" ] && [ -z "$NOSY_NO_GIT_HOOKS" ] && [ -f "$NOSY_ROOT/${pm}/sources.json" ]; then`,
    `  cd "$NOSY_ROOT" || true`,
    `  [ -z "$NOSY_NO_NEVER_CHECK" ] && node ${at}/never-check.mjs" ${pm} --last-commit 2>&1 || true`,
    `  [ -z "$NOSY_NO_NUDGE" ] && node ${at}/nudge.mjs" ${pm} 2>&1 || true`,
    "fi",
    END, ""].join("\n");
}

const blockRe = () => new RegExp(`\\n?${START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`, "g");
const read = f => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };
const isShell = text => { const first = text.split("\n", 1)[0]; return !first.startsWith("#!") || /\b(ba|z|da|k)?sh\b/.test(first); };

/** What each hook file would become, without writing it. */
export function plan(action, { root, hooks, pm = "pm", tools = TOOLS }) {
  return HOOK_NAMES.map(name => {
    const file = path.join(hooks, name), text = read(file), ours = text !== null && text.includes(START);
    if (action === "status") return { name, file, state: ours ? "installed" : text === null ? "absent" : "other hook, without ours" };
    if (action === "install") {
      if (ours) return { name, file, state: "already installed", write: null };
      if (text === null) return { name, file, state: "would create", write: "#!/bin/sh\n" + block({ root, pm, tools }) };
      if (!isShell(text)) return { name, file, state: "refused: an existing hook that is not a shell script", refuse: true };
      return { name, file, state: "would add our block to your existing hook", write: text.replace(/\n*$/, "\n\n") + block({ root, pm, tools }) };
    }
    if (!ours) return { name, file, state: "nothing to remove", write: null };
    const rest = text.replace(blockRe(), "\n").replace(/^\s+|\s+$/g, "");
    return { name, file, state: rest === "#!/bin/sh" || rest === "" ? "would remove the file" : "would remove our block", write: rest === "#!/bin/sh" || rest === "" ? "" : rest + "\n", remove: rest === "#!/bin/sh" || rest === "" };
  });
}

export function apply(steps) {
  for (const s of steps) {
    if (s.refuse || s.write === null || s.write === undefined) continue;
    if (s.remove) fs.rmSync(s.file, { force: true });
    else { fs.mkdirSync(path.dirname(s.file), { recursive: true }); fs.writeFileSync(s.file, s.write); fs.chmodSync(s.file, 0o755); }
  }
}

function main(argv) {
  const action = ["install", "uninstall", "status"].includes(argv[0]) ? argv[0] : null;
  const dry = argv.includes("--dry-run"), pmIdx = argv.indexOf("--pm"), pm = pmIdx >= 0 ? argv[pmIdx + 1] : process.env.NOSY_PM || "pm";
  if (!action) { console.log("Usage: nosy git-hooks <install|uninstall|status> [--dry-run] [--pm <folder>]\n  The after-commit nudge and the never-rule check as git hooks, for agents without hooks of their own (Codex, Cursor, Gemini CLI…).\n  Claude Code's plugin already does this: you don't need it there."); return 0; }
  let where;
  try { where = locate(); } catch (e) { console.error(`Psst… ${e.message}.`); return 1; }
  const steps = plan(action, { ...where, pm });
  if (!dry && action !== "status") apply(steps);
  const past = s => dry || action === "status" ? s.state : s.state.replace("would create", "created").replace("would add our block to your existing hook", "added our block to your existing hook").replace("would remove the file", "removed the file").replace("would remove our block", "removed our block");
  for (const s of steps) console.log(`${path.relative(where.root, s.file) || s.file}: ${past(s)}`);
  if (steps.some(s => s.refuse)) { console.error("Psst… an existing hook here is not a shell script, so nothing was added to it. Call `node <skill>/tools/never-check.mjs pm --last-commit` and `node <skill>/tools/nudge.mjs pm` from it yourself."); return 1; }
  if (action === "install" && !dry) console.log("From now on, after a commit or a pull here, these lines come back in the output of `git commit` / `git pull` (only in a repo with pm/sources.json). Off: `nosy git-hooks uninstall`, or NOSY_NO_GIT_HOOKS=1 for one run.");
  return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
