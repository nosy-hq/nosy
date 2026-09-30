// health: `nosy doctor --check`. "Is my install healthy?" (doctor without --check is about a pm/ from an older Nosy.)
// Local only: reads files, runs `git --version`, `gh --version` and a few read-only `git rev-parse` calls. No network,
// no gh auth call, writes nothing. Every line that isn't fine carries the command or link that fixes it.
//   ✓ fine   ✗ hard failure (Nosy can't work like this; exit 2)   ! fix it, Nosy still runs   – for your information
// Usage: node health.mjs [<pm folder>] [--json <file>]      (or: nosy doctor --check)
// Exit: 0 no hard failure (warnings and notes don't count) · 2 at least one ✗ · 1 bad flags.
//
// The Node floor (MIN_NODE) comes from a scan of skill/tools/*.mjs and hooks/*.mjs on 30 Sep 2026: the newest thing
// they need is `fs.readdirSync(dir, { recursive: true })` (gather-evidence, interview-themes, audit-prd), added in
// Node 18.17 and 20.1; on 18.0-18.16 the option is silently ignored and rival/interview files in subfolders go
// unread, with no error. Everything else predates 18 (`Array.at` 16.6, global `fetch` 18.0, top-level await 14.8,
// `fs.rmSync` 14.14). Node 19 never had it. Verified by running on 22 and 24 only.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { spawnSync } from "node:child_process"; import { fileURLToPath } from "node:url";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MIN_NODE = "18.17";
export const nodeOk = v => {
  const [M, m] = String(v).replace(/^v/, "").split(".").map(Number);
  return M === 18 ? m >= 17 : M === 20 ? m >= 1 : M >= 21; // 19.x never had recursive readdir
};

const readJson = f => { try { return { value: JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "")) }; } catch (e) { return { error: String(e.message).split("\n")[0].slice(0, 90) }; } };
const mdCount = d => { try { return fs.readdirSync(d).filter(f => f.endsWith(".md")).length; } catch { return 0; } };
const lstat = f => { try { return fs.lstatSync(f); } catch { return null; } };
// The files of a skill folder the way `nosy install` copies them (test/ left out; the marker and .DS_Store aren't files of the skill).
const filesOf = (dir, rel = "") => { try { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => { const r = rel ? `${rel}/${e.name}` : e.name; if ((!rel && e.name === "test") || e.name === ".nosy-install.json" || e.name === ".DS_Store") return []; return e.isDirectory() ? filesOf(path.join(dir, e.name), r) : [r]; }); } catch { return []; } };
const REINSTALL = "reinstall: `/plugin uninstall nosy@nosy` then `/plugin install nosy@nosy` (or `npx github:nosy-hq/nosy install`)";

// Runs a program the way the real tools do (no shell); { status, stdout } or { missing: true }.
const defaultRun = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd, timeout: 8000, stdio: ["ignore", "pipe", "pipe"] });
  return r.error ? { missing: r.error.code === "ENOENT", status: null, stdout: "" } : { status: r.status, stdout: (r.stdout || "").trim() };
};

export async function check({ cwd = process.cwd(), pm: pmArg, env = process.env, home = os.homedir(), node = process.versions.node, skill = SKILL, run = defaultRun } = {}) {
  const lines = [], add = (level, what, fix = null) => lines.push({ level, what, fix });
  const root = path.resolve(skill, ".."), soft = async f => { try { return await import(new URL(`./${f}`, import.meta.url)); } catch { return null; } };
  const pkgFile = path.join(root, "package.json"), pluginFile = path.join(root, ".claude-plugin", "plugin.json");
  const pkgRead = readJson(pkgFile), pluginRead = readJson(pluginFile);
  const isObject = v => !!v && typeof v === "object" && !Array.isArray(v);
  const pkg = isObject(pkgRead.value) ? pkgRead.value : undefined, plugin = isObject(pluginRead.value) ? pluginRead.value : undefined;
  // A file that is there but won't read is a failure of its own, never "no manifest, fine for a skill-only install".
  const pluginBroken = fs.existsSync(pluginFile) && !plugin;
  const H = await soft("hints.mjs"), command = sub => (H?.nosyCommand ? H.nosyCommand(sub) : `nosy ${sub}`); // the command that runs here (there may be no global `nosy`)
  const marker = readJson(path.join(skill, ".nosy-install.json")).value;
  const version = pkg?.version || plugin?.version || marker?.version || "unknown";

  // 1. Node.
  if (!nodeOk(node)) add("fail", `Node ${node} found, needs ${MIN_NODE}+`, "install from https://nodejs.org (the current LTS is fine)");
  else add("ok", `Node ${node} (needs ${MIN_NODE}+)`);

  // 2. git (required: every command reads history with it) and gh (optional: issues and PRs).
  const g = run("git", ["--version"], cwd);
  if (g.missing || g.status !== 0) add("fail", "git not found", "install from https://git-scm.com/downloads, then open a new terminal (Nosy reads your history with it)");
  else add("ok", g.stdout.replace(/^git version /, "git "));
  const h = run("gh", ["--version"], cwd);
  const ghFound = !h.missing && h.status === 0;
  if (!ghFound) add("note", "gh (GitHub CLI) not found, optional: issues and PRs are skipped without it", "install from https://cli.github.com, then `gh auth login`");
  else add("ok", `${h.stdout.split("\n")[0].replace(/ \(.*/, "").replace(/^gh version /, "gh ")} (sign-in isn't checked here: \`gh auth status\`)`);

  // 3. The skill's own files, where the agent reads them.
  const need = ["SKILL.md", "rules.md", "tools/nosy.mjs", "tools/next.mjs", "data/rules.json", "data/lang/tr/renames.json"].filter(f => !fs.existsSync(path.join(skill, f)));
  const skillText = (() => { try { return fs.readFileSync(path.join(skill, "SKILL.md"), "utf8"); } catch { return ""; } })();
  const cmds = mdCount(path.join(skill, "commands"));
  if (need.length) add("fail", `Nosy's skill folder is missing ${need.join(", ")} (${skill})`, REINSTALL);
  else if (!/^name:\s*nosy\s*$/m.test(skillText)) add("fail", `${path.join(skill, "SKILL.md")} has no \`name: nosy\` header, so an agent won't load it`, REINSTALL);
  else if (!cmds) add("fail", `${path.join(skill, "commands")} has no command files`, REINSTALL);
  else add("ok", `skill files found: SKILL.md, ${cmds} commands, ${fs.readdirSync(path.join(skill, "tools")).filter(f => f.endsWith(".mjs")).length} tools (${skill})`);

  // 4. The plugin: manifest, commands next to the skill's, version agreement.
  if (pluginBroken) add("fail", `.claude-plugin/plugin.json isn't valid${pluginRead.error ? ` (${pluginRead.error})` : ": not a JSON object"}, so Claude Code can't load the plugin`, REINSTALL);
  else if (fs.existsSync(pkgFile) && !pkg) add("warn", `package.json isn't valid${pkgRead.error ? ` (${pkgRead.error})` : ": not a JSON object"}, so this copy can't say which version it is`, REINSTALL);
  if (plugin) {
    const skillPaths = [].concat(plugin.skills || []);
    const gone = skillPaths.filter(p => !fs.existsSync(path.resolve(root, p)));
    const pluginCmds = mdCount(path.join(root, "commands"));
    if (gone.length) add("fail", `plugin.json points at ${gone.join(", ")}, which isn't there`, REINSTALL);
    else if (pluginCmds && cmds && pluginCmds !== cmds) add("warn", `the plugin has ${pluginCmds} commands but the skill documents ${cmds}`, REINSTALL);
    else add("ok", `plugin manifest read (${[plugin.name || "nosy", plugin.version].filter(Boolean).join(" ")}): ${pluginCmds} /nosy:<command> commands`);
    if (pkg?.version && plugin.version && pkg.version !== plugin.version) add("warn", `package.json says ${pkg.version} but the plugin manifest says ${plugin.version}`, REINSTALL);
  } else if (!marker && !pluginBroken) add("note", "no plugin manifest next to this skill: fine for a skill-only install (Codex, Cursor…); Claude Code's /nosy:<command> and hooks come with the plugin", "/plugin marketplace add nosy-hq/nosy, then /plugin install nosy@nosy");

  // 5. Copies `nosy install` made, in this project and the user folders (where each agent expects them).
  const I = await soft("install.mjs");
  if (I?.PROVIDERS) {
    const seen = []; let trouble = false;
    for (const [where, base, key] of [["here", cwd, "dir"], ["your user folder", home, "global"]])
      for (const [k, p] of Object.entries(I.PROVIDERS)) {
        if (!p[key]) continue;
        const target = path.join(base, p[key], "nosy"), l = lstat(target);
        if (!l) continue;
        const label = `${p.name} ${where} (${path.relative(base, target) || "."})`;
        if (l.isSymbolicLink() && !fs.existsSync(target)) { trouble = true; add("fail", `${label} is a broken link`, `remove it (\`rm ${target}\`) and run \`npx github:nosy-hq/nosy install\``); continue; }
        const m = readJson(path.join(target, ".nosy-install.json")).value;
        if (!fs.existsSync(path.join(target, "SKILL.md"))) { trouble = true; add("fail", `${label} has no SKILL.md, so the agent can't load it`, `remove it and run \`npx github:nosy-hq/nosy install\``); continue; }
        // A copy is judged by its marker (the version, and how many files it was written with) and by what is actually in it.
        const have = filesOf(target), haveSet = new Set(have);
        if (m?.version && version !== "unknown" && m.version !== version) { trouble = true; add("warn", `${label} is version ${m.version}, this Nosy is ${version}`, `\`${command("update")}\``); }
        else if (Number.isInteger(m?.files) && have.length < m.files) {
          // Same version as this Nosy: name what is gone from the copy that is running now.
          const gone = m.version === version ? filesOf(skill).filter(f => !haveSet.has(f)) : [];
          trouble = true; add("warn", `${label} is damaged: ${have.length} of its ${m.files} files are there${gone.length ? ` (missing ${gone.slice(0, 3).join(", ")}${gone.length > 3 ? ", …" : ""})` : ""}`, `\`${command("update")}\` puts them back`);
        }
        else seen.push(label);
      }
    if (seen.length) add("ok", `skill copies found: ${seen.join(", ")}`);
    else if (!plugin && !trouble) add("note", "no skill folder in this project or your user folder (.claude/skills/nosy, .agents/skills/nosy, …), so an agent that reads skills from there won't see Nosy", "`npx github:nosy-hq/nosy install`");
  }

  // 5b. The plugin registered but switched off (Claude Code keeps that in its own settings; read-only, one key).
  try {
    const registered = /"nosy@[^"]*"/.exec(fs.readFileSync(path.join(home, ".claude", "plugins", "installed_plugins.json"), "utf8"));
    if (registered) {
      const off = readJson(path.join(home, ".claude", "settings.json")).value?.enabledPlugins?.[registered[0].slice(1, -1)] === false;
      if (off) add("fail", `the plugin ${registered[0].slice(1, -1)} is installed but disabled, so /nosy:<command> and the hooks aren't loaded`, `\`/plugin enable nosy\``);
    }
  } catch {}

  // 6. Hooks: the file, valid JSON, every script it names present and parseable; which are switched off.
  const hooksFile = path.join(root, "hooks", "hooks.json");
  if (!fs.existsSync(hooksFile)) add("note", "no hooks here (the skill without the plugin): no opening summary, after-commit nudge or checks by themselves", "Claude Code: /plugin install nosy@nosy adds them. Any agent: `nosy git-hooks install` adds the after-commit nudge and the never-rule check as git hooks");
  else {
    const hj = readJson(hooksFile);
    if (hj.error || !hj.value?.hooks) add("fail", `hooks/hooks.json isn't valid: ${hj.error || "no \"hooks\" key"}`, REINSTALL);
    else {
      const scripts = [...new Set(JSON.stringify(hj.value).match(/hooks\/[\w.-]+\.mjs/g) || [])];
      const gone = scripts.filter(s => !fs.existsSync(path.join(root, s)));
      const bad = scripts.filter(s => !gone.includes(s) && run(process.execPath, ["--check", path.join(root, s)], cwd).status !== 0);
      if (gone.length) add("fail", `hooks/hooks.json names ${gone.join(", ")}, which isn't there`, REINSTALL);
      else if (bad.length) add("fail", `${bad.join(", ")} doesn't parse on Node ${node}`, `update Node (https://nodejs.org) or ${REINSTALL}`);
      else {
        const L = await soft("loaded.mjs"), off = L ? L.HOOKS.filter(x => L.hookOff(x, env)) : [];
        add("ok", `hooks: ${scripts.length} scripts wired, file valid${off.length ? "" : ", all on"}`);
        if (off.length) add("note", `switched off by you: ${off.map(x => `${x.name} (${x.env})`).join(", ")}`, "docs/INSTALL.md (f) turns them back on");
      }
    }
  }

  // 7. pm/ here: absent is fine (not moved in yet); present must be readable.
  const pm = path.resolve(cwd, pmArg || env.NOSY_PM || "pm"), rel = path.relative(cwd, pm) || "pm";
  const src = path.join(pm, "sources.json");
  if (fs.existsSync(src)) {
    const s = readJson(src);
    if (s.error) add("fail", `${rel}/sources.json isn't valid JSON (${s.error})`, `fix that spot by hand, or move it aside and run \`/nosy:move-in\` (or \`nosy setup .\`)`);
    else if (!s.value || typeof s.value !== "object" || Array.isArray(s.value)) add("fail", `${rel}/sources.json isn't a JSON object`, "move it aside and run `/nosy:move-in` (or `nosy setup .`)");
    else {
      const K = s.value, repo = path.resolve(path.dirname(pm), K.repo || "."), ref = K.ref || "HEAD";
      if (g.missing || g.status !== 0) add("warn", `${rel}/sources.json read, but its repo can't be checked without git`, "install git (above)");
      else if (!fs.existsSync(repo) || run("git", ["-C", repo, "rev-parse", "--git-dir"], cwd).status !== 0) add("fail", `${rel}/sources.json \`repo\` (${K.repo || "."}) isn't a git repo (looked in ${repo})`, `fix \`repo\` in ${rel}/sources.json: a path to the product's git folder, relative to ${path.dirname(pm) === cwd ? "this folder" : path.dirname(pm)}`);
      else if (run("git", ["-C", repo, "rev-parse", "--verify", "--quiet", "HEAD"], cwd).status !== 0) add("fail", `${repo} has no commits yet, so there's nothing to read`, "make a first commit (`git commit --allow-empty -m start`), then run this again");
      else if (run("git", ["-C", repo, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd).status !== 0) add("fail", `${rel}/sources.json \`ref\` (${ref}) isn't a branch or commit in ${repo}`, `\`git -C ${repo} branch -a\` lists them; fix \`ref\`, or \`git fetch\` if it is a remote branch`);
      else add("ok", `${rel}/sources.json reads; repo ${K.repo || "."} at ${ref} resolves`);
      if (K.issue?.repo && !ghFound) add("warn", `${rel}/sources.json has issue.repo (${K.issue.repo}) but gh isn't installed: issues and PRs are skipped`, "install gh (above), or remove `issue` to silence this");
    }
  } else if (fs.existsSync(path.join(pm, "kaynaklar.json"))) add("warn", `${rel}/ is from an older Nosy (kaynaklar.json)`, "`nosy doctor --fix`");
  else if (fs.existsSync(pm)) add("warn", `${rel}/ exists but has no sources.json`, "`/nosy:move-in` (or `nosy setup .`)");
  else add("note", `no ${rel}/ here, so Nosy hasn't moved in (fine outside a product repo)`, "`/nosy:move-in` in your agent, or `nosy setup .`");

  return { version, node, lines };
}

const SYMBOL = { ok: "✓", fail: "✗", warn: "!", note: "–" };
export function render(R) {
  const out = [`Nosy ${R.version} · install check (Node ${R.node}, ${process.platform})`];
  for (const l of R.lines) out.push(`  ${SYMBOL[l.level]} ${l.what}${l.fix ? `: ${l.fix}` : ""}`);
  const n = lv => R.lines.filter(l => l.level === lv).length, bad = n("fail"), warn = n("warn");
  out.push("", bad ? `${bad} thing${bad === 1 ? "" : "s"} to fix first (✗)${warn ? `, then ${warn} more (!)` : ""}. Nothing was changed.` : warn ? `Runs, with ${warn} thing${warn === 1 ? "" : "s"} to fix (!).` : "Healthy. (Whether your agent has loaded it: type /nosy:nosy for the plugin, /nosy for a skill-only install; it prints the loaded lines.)");
  return out.join("\n");
}
export const exitCode = R => (R.lines.some(l => l.level === "fail") ? 2 : 0);

export async function main(argv) {
  const take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const jsonOut = take("--json"), pm = take("--pm");
  const rest = argv.filter(a => a !== "--check");
  const bad = rest.filter(a => a.startsWith("-"));
  if (bad.length) { console.error(`Unknown option ${bad[0]}. Usage: nosy doctor --check [--pm <folder>] [--json <file>]`); return 1; }
  const R = await check({ pm: rest[0] || pm || undefined });
  if (jsonOut) { fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify({ type: "health", generated: new Date().toISOString(), ...R }, null, 1)); }
  console.log(render(R));
  return exitCode(R);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
