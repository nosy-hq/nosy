// Publishes the dashboard files of pm/ to Nosy Cloud (a free dashboard; runs no model). Opt-in, three times over:
// you configure a target, you pass --yes (or answer the question in a terminal), and a token you made is in the environment.
// It sends counts and structure, never quotes: the shipped record, the diff and the list are cut down first
// (publish-safe.mjs: no commit subjects, author names, PR titles or issue titles), then everything that would leave goes
// through the privacy scan, and a secret or personal data stops the send. `--dry-run` prints exactly what would be sent.
// The files go straight from disk to the cloud, never through a model's context. Sent: matrix, status, lowhanging,
// diff, run history, the first section of the summary, the rival watch list (state/watch.json: public rival page URLs,
// so Cloud's cron can check them daily), the rivals' price lines (rival-facts.mjs), customer demand cut down to counts
// (demand-facts.mjs), and the page's first screen (glance.mjs). Nothing else in pm/ (decisions, signal/, rivals) leaves.
// docs/DATA.md lists every key.
// Usage: node publish.mjs <pm> [--project <name>] [--url <cloud url>] [--dry-run [--full]] [--yes] [--allow-sensitive]
//   Target: --url, else NOSY_CLOUD_URL, else sources.json cloud.url. No default: without one, nothing is sent.
//   Token: NOSY_CLOUD_TOKEN only (make one on the dashboard home page, or ask the cloud MCP for a one-hour one).
//   Project: --project, else sources.json cloud.project, else the repo folder's name.
//   --yes: send without asking (a script, or an agent you told to publish). In a terminal without it, you are asked.
//   --allow-sensitive: go on although the privacy scan found a secret or personal data (read its list first).
// Writes outward, so run it only when the owner asked. Exit code 1 on refusal or failure.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { glance } from "./glance.mjs";
import { rivalFacts } from "./rival-facts.mjs";
import { demandForCloud } from "./demand-facts.mjs";
import { netError } from "./hints.mjs";
import { readSources } from "./sources-file.mjs";

import readline from "node:readline";
import { safeStatus, safeDiff, safeLowhanging, safeGlance, safeSummary, authorNames, PayloadKeys } from "./publish-safe.mjs";

export const Files = ["matrix.json", "state/status.json", "state/lowhanging.json", "state/diff.json", "history/runs.jsonl", "summary.md", "state/watch.json"];
const Tool = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const al = name => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = name => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };
const projectArg = al("--project"), urlArg = al("--url"), dry = flag("--dry-run"), full = flag("--full"), yes = flag("--yes"), allowSensitive = flag("--allow-sensitive");
const pm = argv[0] || process.env.NOSY_PM || "pm";

const fail = msg => { console.error(`Psst… ${msg}`); process.exit(1); };
let sources = {};
try { sources = readSources(pm); } catch {}
const cloud = sources.cloud || {};
// No built-in default: a send needs a target you configured (--url, NOSY_CLOUD_URL, or cloud.url in sources.json).
const target = urlArg || process.env.NOSY_CLOUD_URL || cloud.url || null;
const base = target ? target.replace(/\/+$/, "") : null;
const project = projectArg || cloud.project || path.basename(path.resolve(pm, ".."));
if (!/^[A-Za-z0-9][\w.-]{0,63}$/.test(project)) fail(`"${project}" isn't a valid project name (letters, digits, . _ -). Pass --project <name>.`);

const readJson = f => JSON.parse(fs.readFileSync(f, "utf8"));
// Local files that hold quotes are cut down first (publish-safe.mjs); a file that cannot be read is left out, never sent raw.
const Cut = { "state/status.json": t => JSON.stringify(safeStatus(JSON.parse(t)), null, 1), "state/diff.json": t => JSON.stringify(safeDiff(JSON.parse(t)), null, 1),
  "state/lowhanging.json": t => JSON.stringify(safeLowhanging(JSON.parse(t)), null, 1), "summary.md": t => safeSummary(t) };
const send = []; // {key, text}
for (const f of Files) {
  const file = path.join(pm, f);
  if (!fs.existsSync(file)) continue;
  try { const raw = fs.readFileSync(file, "utf8"); send.push({ key: `pm/${f}`, text: Cut[f] ? Cut[f](raw) : raw }); }
  catch (e) { console.error(`(${f} left out: it can't be read or cut down safely: ${e.message})`); }
}
if (!send.some(x => x.key === "pm/matrix.json")) fail(`${pm}/matrix.json is missing: the dashboard is built around it. Run neighbors (or nosy weekly) first.`);
// The computed files: the first screen (references, not commit subjects), the rivals' price lines, and customer demand as counts.
try { const G = glance(pm, { refsOnly: true }); if (G && Object.keys(G).length) send.push({ key: "pm/state/glance.json", text: JSON.stringify({ generated: new Date().toISOString(), ...safeGlance(G) }) }); }
catch (e) { console.error(`(first screen skipped: ${e.message})`); }
try { const R = rivalFacts(pm); if (Object.keys(R).length) send.push({ key: "pm/state/rival-facts.json", text: JSON.stringify({ generated: new Date().toISOString(), rivals: R }) }); }
catch (e) { console.error(`(rival facts skipped: ${e.message})`); }
try { const D = demandForCloud(pm); if (D) send.push({ key: "pm/state/demand.json", text: JSON.stringify(D) }); } // no quotes, no decision or request titles
catch (e) { console.error(`(demand skipped: ${e.message})`); }

// "Never your data": the outgoing text is written to a temp folder and scanned there. A secret or personal data (an
// e-mail, a phone number, an IBAN, a card number, an ID number, a name from private.json or the people who wrote your
// commits) stops the send unless you pass --allow-sensitive.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nosy-publish-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
for (const x of send) { const f = path.join(tmp, x.key); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, x.text); }
const names = authorNames(pm);
const scan = spawnSync(process.execPath, [path.join(Tool, "privacy-scan.mjs"), ...send.map(x => x.key), "--pm", path.resolve(pm), ...(names.length ? ["--names", names.join(",")] : [])], { encoding: "utf8", cwd: tmp });
// Fails closed: 2 = a finding, anything else non-zero = the scan couldn't run. Only a finding can be overridden.
if (scan.status === 2 && allowSensitive) console.error(`${scan.stdout || ""}\n--allow-sensitive: sending although the scan found the above.`);
else if (scan.status !== 0) { process.stderr.write(scan.stdout || scan.stderr || ""); fail(scan.status === 2 ? "the privacy scan found a secret or personal data in the files above; nothing was sent. Fix it at the source, or (only if you have read the list and it is fine to send) run again with --allow-sensitive." : "the privacy scan couldn't run; nothing was sent."); }

const files = Object.fromEntries(send.map(x => [x.key, x.text]));
const kb = s => `${(Buffer.byteLength(s) / 1024).toFixed(1)} KB`;
console.log(`${dry ? "Would publish" : "Publishing"} ${send.length} file(s) to ${base || "(no target configured)"} as "${project}":`);
for (const x of send) console.log(`  ${x.key} (${kb(files[x.key])}): ${PayloadKeys[x.key] || ""}`);
const missing = Files.filter(f => !send.some(x => x.key === `pm/${f}`));
// (glance.json, rival-facts.json and demand.json aren't in Files: they're always computed, so they're never "missing".)
if (missing.length) console.log(`  not found, will be cleared on the dashboard: ${missing.map(f => `pm/${f}`).join(", ")}`);
console.log("Counts and structure only: no commit subjects, author names, PR titles, issue titles or customer quotes. Nothing else in pm/ leaves.");
if (full) for (const x of send) console.log(`\n--- ${x.key} ---\n${x.text}`);
if (dry) { if (!base) console.log("No target yet: set cloud.url in pm/sources.json, or NOSY_CLOUD_URL, or pass --url. A real run stops until you do."); process.exit(0); }

if (!base) fail("no target configured, so nothing was sent. Set `cloud.url` in pm/sources.json (or NOSY_CLOUD_URL, or --url <address>). Nosy has no default address: publishing is opt-in. `nosy publish --dry-run` shows what would go.");
const token = process.env.NOSY_CLOUD_TOKEN;
if (!token) fail(`NOSY_CLOUD_TOKEN is not set. Make a token on ${base} (Connect Claude → Make a token) and export it; never commit it.`);
if (!yes) {
  if (!process.stdin.isTTY) fail(`not sent: this needs your yes. Read the list above (or run --dry-run --full), then run again with --yes.`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise(r => rl.question(`Send these ${send.length} file(s) to ${base}? [y/N] `, r)); rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) fail("not sent.");
}

let res;
try {
  res = await fetch(`${base}/api/publish`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "user-agent": "nosy-publish" },
    body: JSON.stringify({ project, files, replace: true }),
  });
} catch (e) { fail(`couldn't reach ${base}: ${netError(e)}. Nothing was sent; check your connection (or --url / NOSY_CLOUD_URL) and run it again.`); }
const body = await res.json().catch(() => ({}));
if (!res.ok) fail(`${base} answered ${res.status}: ${body.error || "no details"}.${res.status === 401 || res.status === 403 ? " The token was refused: make a new one on the site (Connect Claude → Make a token) and export NOSY_CLOUD_TOKEN again." : res.status >= 500 ? " The service is having trouble: nothing was changed, try again in a few minutes." : ""}`);
console.log(`Published. Dashboard: ${body.url}`);
