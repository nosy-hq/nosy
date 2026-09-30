#!/usr/bin/env node
// Nosy · the reference check, run for the agent instead of left to it. The owner's 20-question test showed
// agents read "run cite-check before the answer goes out" and skip it anyway, so it runs here:
//   Stop / SubagentStop  the answer the agent just gave (its last message in the transcript)
//   PostToolUse Write|Edit|MultiEdit  a markdown/text file the agent just wrote (an answer or a draft)
//   PostToolUse Bash  the same, when the file was written from the shell (`cat > a.md <<EOF`, `echo … >> a.md`,
//                     `tee a.md`, `mv draft.md a.md`): the owner's hook run found agents write answers that way
//                     more often than with Write, and those went unchecked
// Every file:line, quote, commit and #ref is checked with skill/tools/cite-check.mjs against the product's repo
// (pm/sources.json `repo`; #refs against `issue.repo` when gh works). Something that doesn't hold up comes
// back as a "block" reason: on Stop the agent has to fix or drop those lines before it finishes (once; a
// second stop goes through, so it can never loop), on a write it's told the file needs fixing. Nothing to
// check, no pm/, any error: silent.
// A file can opt out with `<!-- nosy: no-cite-check -->` (a runbook or notes about this check, not an answer).
// Off: "Turn off the reference check" in `/plugin configure`, or NOSY_NO_CITE_CHECK=1. #refs: NOSY_CITE_GH=0 skips GitHub.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";

const off = v => ["1", "true", "on", "yes"].includes(String(v ?? "").toLowerCase());

// The text of the last assistant message in a Claude Code transcript (JSONL).
export function lastAnswer(transcriptPath) {
  let lines; try { lines = fs.readFileSync(transcriptPath, "utf8").trim().split("\n"); } catch { return ""; }
  for (let i = lines.length - 1; i >= 0; i--) {
    let d; try { d = JSON.parse(lines[i]); } catch { continue; }
    const m = d.message || {};
    if ((d.type === "assistant" || m.role === "assistant") && Array.isArray(m.content)) {
      const text = m.content.filter(c => c.type === "text").map(c => c.text).join("\n").trim();
      if (text) return text;
    }
    if (d.type === "user" && typeof (d.message?.content) === "string") return ""; // a new user turn: nothing answered since
  }
  return "";
}

// pm/ next to where the agent works, at the repo root, or above the file it just wrote (an answer draft under
// pm/state/, or an answers folder next to pm/): the first one with a sources.json.
function pmFor(cwd, file = null) {
  let top = cwd; try { top = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
  const up = [];
  if (file) for (let d = path.dirname(path.resolve(cwd, file)); ; d = path.dirname(d)) { up.push(path.basename(d) === "pm" ? d : path.join(d, "pm")); if (path.dirname(d) === d) break; }
  return [process.env.NOSY_PM && path.resolve(cwd, process.env.NOSY_PM), ...up, path.join(cwd, "pm"), path.join(top, "pm")].filter(Boolean).find(p => fs.existsSync(path.join(p, "sources.json")));
}

// Markdown/text files a shell command writes: redirections (> and >>, heredocs included), tee, and the target of
// cp/mv. Relative paths resolve against the working directory and any `cd <dir> &&` at the start. Only files that
// exist and changed in the last two minutes count, so a command that merely names a file checks nothing.
export function filesWrittenBy(cmd, cwd, { now = Date.now() } = {}) {
  const EXT = "(?:md|markdown|txt)", P = `(['"]?)([^\\s'";|&<>()]+\\.${EXT})\\1`;
  const found = [];
  for (const m of cmd.matchAll(new RegExp(`(?:^|[^<>&\\d])>>?\\s*${P}`, "g"))) found.push(m[2]);
  for (const m of cmd.matchAll(/\btee\b((?:\s+-{1,2}[a-z]+)*)((?:\s+['"]?[^\s'";|&<>()]+['"]?)+)/g))
    for (const a of m[2].trim().split(/\s+/)) { const f = a.replace(/^['"]|['"]$/g, ""); if (new RegExp(`\\.${EXT}$`).test(f)) found.push(f); }
  for (const m of cmd.matchAll(new RegExp(`\\b(?:cp|mv)\\s+(?:-\\S+\\s+)*\\S+\\s+${P}`, "g"))) found.push(m[2]);
  const dirs = [cwd, ...[...cmd.matchAll(/(?:^|&&|;)\s*cd\s+(['"]?)([^\s'";&|]+)\1/g)].map(m => path.resolve(cwd, m[2].replace(/^~(?=\/)/, process.env.HOME || "~")))];
  const out = [];
  for (const f of new Set(found)) {
    const f2 = f.replace(/^~(?=\/)/, process.env.HOME || "~");
    for (const d of dirs) {
      const abs = path.resolve(d, f2);
      try { if (now - fs.statSync(abs).mtimeMs < 120000 && !out.includes(abs)) { out.push(abs); break; } } catch {}
    }
  }
  return out;
}

export async function run(input, { lookup } = {}) {
  if (input.hook_event_name === "PostToolUse" && input.tool_name === "Bash") {
    const cwd = input.cwd || process.cwd(), files = filesWrittenBy(String(input.tool_input?.command || ""), cwd);
    const reasons = [];
    for (const f of files) { const r = await run({ ...input, tool_name: "Write", tool_input: { file_path: f } }, { lookup }); if (r) reasons.push(r.reason); }
    return reasons.length ? { event: "PostToolUse", reason: reasons.join("\n\n") } : null;
  }
  const event = input.hook_event_name || "", cwd = input.cwd || process.cwd();
  const pm = pmFor(cwd, event === "PostToolUse" ? input.tool_input?.file_path : null); if (!pm) return null;
  let K; try { K = JSON.parse(fs.readFileSync(path.join(pm, "sources.json"), "utf8").replace(/^\uFEFF/, "")); } catch { return null; }
  let text = "", name = "your answer";
  if (event === "Stop" || event === "SubagentStop") {
    if (input.stop_hook_active) return null;
    text = lastAnswer(input.agent_transcript_path || input.transcript_path);
  } else if (event === "PostToolUse") {
    const f = input.tool_input?.file_path || "";
    if (!/\.(md|markdown|txt)$/i.test(f)) return null;
    try { text = fs.readFileSync(path.resolve(cwd, f), "utf8"); } catch { return null; }
    name = path.basename(f);
  } else return null;
  if (!text || !/(:\d|#\d|\b[0-9a-f]{7,}\b)/.test(text)) return null;
  // A file that talks about references rather than making claims (a runbook, notes on this very check) opts out.
  if (/<!--\s*nosy:\s*no-cite-check\s*-->/i.test(text)) return null;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const C = await import(path.join(here, "..", "skill", "tools", "cite-check.mjs"));
  const repo = path.isAbsolute(K.repo || "") ? K.repo : path.resolve(path.dirname(pm), K.repo || "."), ghRepo = K.issue?.repo || "";
  const useGh = ghRepo && process.env.NOSY_CITE_GH !== "0";
  let R; try { R = C.check(text, { repo, lookup: lookup || (useGh ? C.ghLookup(ghRepo) : null), ghRepo, outside: C.outsideIndex(C.outsideRootsOf(K, pm)) }); } catch { return null; }
  if (!R.problems.length) return null;
  const body = C.render(R, { name });
  const tail = event === "PostToolUse" ? "Fix those lines in the file (or drop them) before you give it to the owner." : "Fix or drop those lines, then give the corrected answer.";
  return { event, reason: `${body}\n\n(Nosy reference check. ${tail})` };
}

async function main() {
  if (off(process.env.CLAUDE_PLUGIN_OPTION_DISABLE_CITE_CHECK) || off(process.env.NOSY_NO_CITE_CHECK)) return;
  let input; try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { return; }
  const r = await run(input); if (!r) return;
  const out = r.event === "PostToolUse"
    ? { decision: "block", reason: r.reason, hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: r.reason } }
    : { decision: "block", reason: r.reason };
  process.stdout.write(JSON.stringify(out));
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {});
