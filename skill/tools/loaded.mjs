// loaded: "installed" is not "loaded". Three short lines that say what this Nosy is right now: its version and how
// many commands it brought, which of its four hooks are on or off, and whether this folder has a pm/ (and the one
// command to run next when it doesn't). Read-only, no network, never throws.
//
// Two callers, both existing surfaces (nothing new speaks on its own):
//   - the top-level skill with no command (next.mjs) prints the lines above its picks, every time: the owner asked.
//     Claude Code plugin: `/nosy:nosy` (every plugin skill is namespaced). Skill-only install: `/nosy`. Codex: `$nosy`.
//   - the SessionStart hook (hooks/psst-summary.mjs) says them ONCE per install, in the first session, so a fresh user
//     sees that the plugin loaded even in a folder with no pm/. After that it is back to its old quiet self.
//     "Once" is a marker file (claimFirstRun); if the marker can't be written the hook stays silent, never nags.
// Off switches: the same ones the hooks have (docs/INSTALL.md, f). NOSY_NO_PSST silences the hook, so the first-run
// lines too; the skill with no command still prints them, and shows the opening summary as off.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The four hooks and how each is turned off: the Claude Code plugin option (`/plugin configure`) or the env var.
// Kept next to each other so a test can check them against the hook files.
export const HOOKS = [
  { name: "opening summary", option: "CLAUDE_PLUGIN_OPTION_DISABLE_PSST_HOOK", env: "NOSY_NO_PSST", file: "psst-summary.mjs" },
  { name: "after-commit nudge", option: "CLAUDE_PLUGIN_OPTION_DISABLE_COMMIT_NUDGE", env: "NOSY_NO_NUDGE", file: "after-commit.mjs" },
  { name: "never-check", option: "CLAUDE_PLUGIN_OPTION_DISABLE_NEVER_CHECK", env: "NOSY_NO_NEVER_CHECK", file: "never-check.mjs" },
  { name: "reference check", option: "CLAUDE_PLUGIN_OPTION_DISABLE_CITE_CHECK", env: "NOSY_NO_CITE_CHECK", file: "cite-check.mjs" },
];
const truthy = v => ["1", "true", "on", "yes"].includes(String(v ?? "").toLowerCase());
// The same rule the hooks use: off when either switch says so. An option Claude Code exports as "false" (its default for a
// boolean nobody changed) must not hide a NOSY_NO_* you set yourself, so neither one shadows the other.
export const hookOff = (h, env = process.env) => truthy(env[h.option]) || truthy(env[h.env]);

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };
const mdCount = d => { try { return fs.readdirSync(d).filter(f => f.endsWith(".md")).length; } catch { return 0; } };

// The version this copy is: the repo's package.json, the plugin manifest, or the marker `nosy install` wrote.
export function versionOf(skill = SKILL) {
  const root = path.resolve(skill, "..");
  return readJson(path.join(root, "package.json"))?.version || readJson(path.join(root, ".claude-plugin", "plugin.json"))?.version
    || readJson(path.join(skill, ".nosy-install.json"))?.version || "unknown";
}

// What is here. pm: ready (sources.json reads) · older (an older Nosy's kaynaklar.json) · broken (sources.json won't
// parse) · empty (a pm/ with no sources.json) · none.
export function status({ cwd = process.cwd(), env = process.env, skill = SKILL } = {}) {
  const root = path.resolve(skill, "..");
  // The plugin's commands/ when there is one, else the skill's own command docs (a skill-only install).
  const commands = mdCount(path.join(root, "commands")) || mdCount(path.join(skill, "commands"));
  const hooksInstalled = !!readJson(path.join(root, "hooks", "hooks.json"))?.hooks;
  const hooks = HOOKS.map(h => ({ name: h.name, on: !hookOff(h, env), off: h.env }));
  const pm = path.resolve(cwd, env.NOSY_PM || "pm");
  let state = "none";
  if (fs.existsSync(path.join(pm, "sources.json"))) state = readJson(path.join(pm, "sources.json")) ? "ready" : "broken";
  else if (fs.existsSync(path.join(pm, "kaynaklar.json"))) state = "older";
  else if (fs.existsSync(pm)) state = "empty";
  return { version: versionOf(skill), commands, hooksInstalled, hooks, pm: { path: pm, state } };
}

// How the owner runs the top-level skill here: a plugin namespaces it (`/nosy:nosy`); a skill-only install is `/nosy`.
// The plugin is what sets CLAUDE_PLUGIN_ROOT (hooks and plugin commands run with it).
export const invoke = (env = process.env) => (env.CLAUDE_PLUGIN_ROOT ? "/nosy:nosy" : "/nosy");

// prefix: how commands are typed here ("/nosy:" in the plugin, "/nosy " as a skill, "nosy " on the command line).
// nextStep: say the command to run when there is no pm/ (off where the picks right below already say it).
// moveIn: what to type to set up (`nosy setup .` on the command line, where move-in has no script half).
export function render(L, { prefix = "/nosy:", nextStep = true, moveIn = `${prefix}move-in` } = {}) {
  const on = L.hooks.filter(h => h.on).map(h => h.name), off = L.hooks.filter(h => !h.on);
  const hooks = !L.hooksInstalled
    ? "Hooks: none, this is the skill without the plugin. Any agent: `nosy git-hooks install` adds the after-commit nudge and never-rule check as git hooks (Claude Code: /plugin install nosy@nosy adds all four hooks)."
    : `Hooks on: ${on.join(", ") || "none"}.${off.length ? ` Off: ${off.map(h => `${h.name} (${h.off})`).join(", ")}.` : ""}`;
  const at = { ready: "pm/ found: Nosy has moved in here.",
    none: nextStep ? `No pm/ here yet: run ${moveIn} to set Nosy up for this repo.` : "No pm/ here yet: Nosy hasn't moved in.",
    empty: nextStep ? `pm/ has no sources.json yet: run ${moveIn}.` : "pm/ has no sources.json yet.",
    older: `pm/ is from an older Nosy: run ${prefix}doctor.`,
    broken: "pm/sources.json can't be read (not valid JSON): `nosy doctor --check` says where; fix it or redo it with " + `${moveIn}.` }[L.pm.state];
  return [`Nosy ${L.version} is loaded: ${L.commands} commands (${/:$/.test(prefix) ? "/nosy:nosy" : prefix.trim()} lists them).`, hooks, at].join("\n");
}

// Once per install. The marker lives where Claude Code keeps the plugin's own data (CLAUDE_PLUGIN_DATA, removed with
// the plugin), else the temp folder; NOSY_STATE_DIR overrides both (tests). True only for the run that wrote it.
export const stateDir = (env = process.env) => env.NOSY_STATE_DIR || env.CLAUDE_PLUGIN_DATA || os.tmpdir();
export const firstRunFile = (env = process.env) => path.join(stateDir(env), "nosy-loaded.json");
export function claimFirstRun({ env = process.env, version = versionOf() } = {}) {
  try {
    const file = firstRunFile(env);
    if (fs.existsSync(file)) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version, at: new Date().toISOString() }) + "\n", { flag: "wx" }); // wx: two sessions starting at once, one speaks
    return true;
  } catch { return false; } // can't remember it, so don't say it: a greeting that repeats is a nag
}
