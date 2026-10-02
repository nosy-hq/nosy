// No test may reach the repository's own pm/ (the live owner state). `nosy.mjs` looks for pm/ by walking up from the folder it runs in
// (sources-file.mjs findPm), and a test process started from the repo root runs in the repo root: a call to nosy.mjs with no --pm,
// no NOSY_PM and no cwd of its own would read, and for some commands write, the live pm/.
// This test reads the test sources (a heuristic on purpose: it can't prove a call safe, it catches the shape that went wrong before) and fails on a
// `run(...nosy.mjs...)` call that has no --pm, no NOSY_PM and no `cwd:`, unless its command never reads pm/ (help, version, install, update, uninstall,
// mcp: whose calls name their pm). It also fails on a `cwd:` that points into the repo. A call that is fine for a reason this test can't see goes in SAFE.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const NEVER_READS_PM = /^(help|--help|-h|--version|-v|-V|version|install|update|uninstall|mcp)$/;
// "<file>: <exact call text>" for a call that is safe for a reason the heuristic can't see.
const SAFE = new Set([
  "install.test.mjs: run(NOSY, a, { env: ENV })", // the wrapper `nosy("install" | "update" | "uninstall", "--dir", d)`: it never reads pm/
]);

const files = fs.readdirSync(here).filter(f => f.endsWith(".test.mjs") && f !== "no-live-pm.test.mjs");

// Each call's text: from `run(` / `runTool(` up to the matching close paren.
function calls(src) {
  const out = [], re = /\b(run|runTool)\s*\(/g; let m;
  while ((m = re.exec(src))) {
    let depth = 1, i = m.index + m[0].length;
    for (; i < src.length && depth; i++) { const c = src[i]; if (c === "(") depth++; else if (c === ")") depth--; else if (c === '"' || c === "'" || c === "`") { const q = c; for (i++; i < src.length && src[i] !== q; i++) if (src[i] === "\\") i++; } }
    out.push(src.slice(m.index, i));
  }
  return out;
}

test("every call of nosy.mjs in the suite names its pm, its folder or a command that doesn't read pm/", () => {
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(here, f), "utf8");
    for (const call of calls(src)) {
      // Any tool run with the literal relative "pm" and no folder of its own reads <process folder>/pm: the repo's own.
      if (/^\w+\s*\(\s*[^,]+,\s*\[\s*["']pm["']/.test(call) && !/cwd/.test(call)) { bad.push(`${f}: ${call.replace(/\s+/g, " ").slice(0, 140)}`); continue; }
      if (!/\b(NOSY|NEXT_CLI)\b|nosy\.mjs/.test(call.split(",")[0])) continue; // the first argument is the script
      if (SAFE.has(`${f}: ${call}`)) continue;
      const arr = /^\w+\s*\(\s*[^,]+,\s*\[([^\]]*)\]/.exec(call), first = arr && (/^\s*["']([^"']+)["']/.exec(arr[1]) || [])[1];
      if (/--pm|NOSY_PM|\bpm\b\s*[:,}]|cwd/.test(call)) continue; // a pm argument, a pm: property, or its own folder
      if (first && NEVER_READS_PM.test(first)) continue;
      bad.push(`${f}: ${call.replace(/\s+/g, " ").slice(0, 140)}`);
    }
  }
  assert.deepEqual(bad, [], `these calls would run nosy.mjs in the process's folder and find the repo's own pm/ by walking up; pass --pm <temp pm> (or cwd: <temp folder>):\n${bad.join("\n")}`);
});

test("no cwd: in the suite points into the repository (a temp folder or a fixture folder only)", () => {
  const repoRoot = path.resolve(here, "..", "..");
  const bad = [];
  for (const f of files.concat(["helpers.mjs", "fake-product.mjs"])) {
    const src = fs.readFileSync(path.join(here, f), "utf8");
    // `here` is this test's own folder only where the file says so (cold-install.test.mjs's `here` is a temp project).
    const hereIsRepo = /\b(const|let)\s+here\s*=\s*path\.(dirname|resolve|join)\([^)]*(import\.meta|__dirname|fileURLToPath)/.test(src);
    for (const m of src.matchAll(/\bcwd:\s*([^,}\n]+)/g)) {
      const v = m[1].trim();
      if (/\b(REPO|repoRoot|Tool|__dirname|SKILL|REAL_SKILL)\b|process\.cwd\(\)|import\.meta/.test(v) || (hereIsRepo && /^here\b/.test(v))) bad.push(`${f}: cwd: ${v}`);
    }
  }
  assert.deepEqual(bad, [], `cwd inside ${repoRoot}:\n${bad.join("\n")}`);
});

test("the hazard is real: findPm called from inside this repo finds the repo's own pm/, which is why the first test exists", async () => {
  const { findPm } = await import("../tools/sources-file.mjs");
  const repoRoot = path.resolve(here, "..", "..");
  if (!fs.existsSync(path.join(repoRoot, "pm", "sources.json"))) return; // an export or a fresh clone has no pm/: nothing to find
  assert.equal(findPm(path.join(repoRoot, "skill", "test")), path.join(repoRoot, "pm"));
  assert.equal(findPm(repoRoot), "pm");
});
