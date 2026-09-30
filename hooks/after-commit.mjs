#!/usr/bin/env node
// Nosy · PostToolUse hook (Bash).
//
// While the owner is building: after a commit or merge lands (git commit/merge/pull/cherry-pick, gh pr merge),
// say what it means in product terms, via skill/tools/nudge.mjs: a matrix gap it may close (and which rivals
// have it), the next product decision, the next command. Silent when nothing is new: it remembers the last
// HEAD it saw and what it last said in a temp file (never in pm/, never the network). Any failure stays silent.
//
// To turn it off (see docs/INSTALL.md, f): "Turn off the after-commit nudge" in `/plugin configure`, or NOSY_NO_NUDGE=1.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LANDS = /\b(git\s+(-C\s+\S+\s+)?(commit|merge|pull|cherry-pick)|gh\s+pr\s+merge)\b/;

function input() {
  try { return JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { return {}; }
}
function disabled() {
  // Either switch turns it off: an option Claude Code exports as "false" (its default) must not hide a NOSY_NO_* you set yourself.
  const on = v => ["1", "true", "on", "yes"].includes(String(v ?? "").toLowerCase());
  return on(process.env.CLAUDE_PLUGIN_OPTION_DISABLE_COMMIT_NUDGE) || on(process.env.NOSY_NO_NUDGE);
}
const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

async function main() {
  if (disabled()) return;
  const I = input();
  if (I.tool_name && I.tool_name !== "Bash") return;
  if (!LANDS.test(String(I.tool_input?.command || ""))) return;
  const cwd = typeof I.cwd === "string" && I.cwd ? I.cwd : process.cwd();
  let top = cwd; try { top = git(cwd, "rev-parse", "--show-toplevel"); } catch {}
  const pm = [path.join(cwd, "pm"), path.join(top, "pm")].find(p => fs.existsSync(path.join(p, "sources.json")));
  if (!pm) return;

  try {
    process.chdir(path.dirname(pm)); // sources.json's repo path is relative to the project folder
    const head = git(".", "rev-parse", "--short", "HEAD");
    const memo = path.join(process.env.NOSY_NUDGE_DIR || os.tmpdir(), `nosy-nudge-${crypto.createHash("sha1").update(path.resolve(pm)).digest("hex").slice(0, 12)}.json`);
    let last = {}; try { last = JSON.parse(fs.readFileSync(memo, "utf8")); } catch {}
    if (last.head === head) return; // nothing landed (the command failed, or it was a no-op)
    // First time in this repo: speak only about a commit that just landed, never an old HEAD (a no-op pull).
    if (!last.head && Date.now() - Number(git(".", "log", "-1", "--format=%ct", "HEAD")) * 1000 > 15 * 60e3) {
      fs.writeFileSync(memo, JSON.stringify({ head, said: {} })); return;
    }
    let since = null;
    if (last.head) { try { git(".", "merge-base", "--is-ancestor", last.head, "HEAD"); since = last.head; } catch {} }

    const here = path.dirname(fileURLToPath(import.meta.url));
    const { nudge, render } = await import(path.join(here, "..", "skill", "tools", "nudge.mjs"));
    const R = nudge(pm, { since });
    const text = render(R, { skip: last.said || {} });
    fs.writeFileSync(memo, JSON.stringify({ head, said: { decision: R?.decision?.title ?? last.said?.decision, next: R?.next?.command ?? last.said?.next } }));
    if (!text) return;
    process.stdout.write(JSON.stringify({
      systemMessage: text,
      hookSpecificOutput: { hookEventName: "PostToolUse",
        additionalContext: `${text}\n(Nosy, after the commit. Pass this to the owner in a line or two at the end of your reply, in the owner's language; don't act on it unasked.)` },
    }));
  } catch {
    // stay silent; never get in the way of the build
  }
}

main();
