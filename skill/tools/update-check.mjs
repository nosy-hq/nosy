// update-check: is there a newer Nosy than the one running? One line for the owner, at session start, at most once a day.
//
// Why it exists: a plugin installed from GitHub is not updated for you (Claude Code leaves third-party marketplaces on manual
// update), so people stay on the version they installed. The session-start hook (hooks/psst-summary.mjs) calls this.
//
// The one network call (docs/DATA.md, "Network"): a plain GET of the public file .claude-plugin/plugin.json on github.com/nosy-hq/nosy
// (raw.githubusercontent.com), at most once every 24 hours, 2 second limit. The request carries no version, no identifier, no
// cookie and nothing from your repo; GitHub sees an address asking for a public file, like any `git clone`. The answer is one
// version number, kept in the plugin's data folder (or the temp folder) next to the "said" time. Any failure stays silent.
// Off: `NOSY_NO_UPDATE_CHECK=1`, the plugin option "Turn off the update notice", or NOSY_NO_PSST=1 (the whole hook).
import fs from "node:fs";
import path from "node:path";
import { stateDir, versionOf } from "./loaded.mjs";

export const LATEST_URL = "https://raw.githubusercontent.com/nosy-hq/nosy/main/.claude-plugin/plugin.json";
export const CHECK_EVERY_MS = 24 * 3600 * 1000;   // how often the network is asked
export const RETRY_AFTER_MS = 6 * 3600 * 1000;    // after a failed ask (offline, GitHub down): try again later, not at every session
export const SAY_EVERY_MS = 24 * 3600 * 1000;     // how often the same notice is said while the owner stays behind
const TIMEOUT_MS = 2000;

const truthy = v => ["1", "true", "on", "yes"].includes(String(v ?? "").toLowerCase());
export const updateCheckOff = (env = process.env) => truthy(env.CLAUDE_PLUGIN_OPTION_DISABLE_UPDATE_CHECK) || truthy(env.NOSY_NO_UPDATE_CHECK);

/** "0.17.0" vs "0.14.4": 1 when a is newer, -1 when older, 0 when equal or either is not a plain N.N.N (then nothing is said). */
export function compareVersions(a, b) {
  const p = v => (/^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? "").trim()) || []).slice(1).map(Number);
  const x = p(a), y = p(b);
  if (x.length !== 3 || y.length !== 3) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

export const cacheFile = (env = process.env) => path.join(stateDir(env), "nosy-update.json");
const readCache = file => { try { const c = JSON.parse(fs.readFileSync(file, "utf8")); return c && typeof c === "object" ? c : {}; } catch { return {}; } };
const writeCache = (file, c) => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(c) + "\n"); } catch {} };

/** The version on GitHub's main, or null. Never throws. `fetchImpl` is for tests. */
export async function fetchLatest(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(LATEST_URL, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const v = JSON.parse(await res.text())?.version;
    return /^\d+\.\d+\.\d+$/.test(String(v)) ? String(v) : null;
  } catch { return null; }
}

/** How to update, in the words of however this copy was installed. */
export function howToUpdate({ plugin }) {
  return plugin
    ? "Update: `/plugin marketplace update nosy`, then `/plugin update nosy@nosy`, then start a new session."
    : "Update: run `npx github:nosy-hq/nosy update` in each project where you installed the skill (plain `nosy update` re-copies from the Nosy you already have).";
}

/**
 * The notice to show now, or null. Asks the network at most once a day, says the same notice at most once a day
 * (`always`: the owner asked what is loaded, so it is said whenever they are behind, still without asking the network more than once a day).
 * @returns {Promise<string|null>}
 */
export async function updateNotice({ env = process.env, now = Date.now(), installed = versionOf(), fetchImpl, plugin = !!env.CLAUDE_PLUGIN_ROOT, always = false } = {}) {
  try {
    if (updateCheckOff(env) || installed === "unknown") return null;
    const file = cacheFile(env);
    let c = readCache(file);
    const age = now - (Number(c.checked) || 0);
    if (age >= (c.failed ? RETRY_AFTER_MS : CHECK_EVERY_MS)) {
      const latest = await fetchLatest(fetchImpl);
      c = latest ? { ...c, checked: now, latest, failed: false } : { ...c, checked: now, failed: true };
      writeCache(file, c);
    }
    if (!c.latest || compareVersions(c.latest, installed) <= 0) return null;
    if (!always && c.said === c.latest && now - (Number(c.saidAt) || 0) < SAY_EVERY_MS) return null;
    writeCache(file, { ...c, said: c.latest, saidAt: now });
    return `Psst… Nosy ${c.latest} is out; this is ${installed}. ${howToUpdate({ plugin })} What changed: https://github.com/nosy-hq/nosy/blob/main/CHANGELOG.md. Turn this notice off: NOSY_NO_UPDATE_CHECK=1.`;
  } catch { return null; } // never block SessionStart
}
