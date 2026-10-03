// Publishes the dashboard files of pm/ to Nosy Cloud (a free dashboard; runs no model). Opt-in, three times over:
// you configure a target, you pass --yes (or answer the question in a terminal), and a token you made is in a file only you can read (or the environment).
// It sends counts and structure, never quotes: the shipped record, the diff and the list are cut down first
// (publish-safe.mjs: no commit subjects, author names, PR titles or issue titles), then everything that would leave goes
// through the privacy scan, and a secret or personal data stops the send. `--dry-run` prints exactly what would be sent.
// The files go straight from disk to the cloud, never through a model's context. Sent: matrix, status, lowhanging,
// diff, psst's checked list when it is as new as the raw one (psst-final.json: the refuter's survivors, title/size/verdict/references only), run history (five fields a line), the first section of the summary, the rival watch list (state/watch.json: public rival page URLs,
// so Cloud's cron can check them daily), the rivals' price lines (rival-facts.mjs), customer demand cut down to counts
// (demand-facts.mjs), the page's first screen (glance.mjs), and, only if you made them, the lines of your roadmap (state/roadmap.json: a title, a #N and a
// GitHub link per line, publish-safe.mjs safeRoadmap) and the public numbers about your rivals (state/rival-signals.json: stars, downloads, open roles,
// ratings, publish-safe.mjs safeRivalSignals). Nothing else in pm/ (decisions, signal/ and so your own notes on rivals, rivals) leaves.
// docs/DATA.md lists every key.
// Usage: node publish.mjs <pm> [--project <name>] [--url <cloud url>] [--token-file <path>] [--dry-run [--full]] [--yes] [--allow-sensitive]
//   Target: --url, else NOSY_CLOUD_URL, else sources.json cloud.url. No default: without one, nothing is sent.
//   Token (a key typed on a command line stays in the shell history and the chat log, so it lives in a file):
//     make one on the dashboard home page (or ask the cloud MCP for a one-hour one), save it to a file only you can read, and
//     publish finds it: NOSY_CLOUD_TOKEN in the environment first, then --token-file <path>, then NOSY_CLOUD_TOKEN_FILE, then the
//     default file ~/.config/nosy/token ($XDG_CONFIG_HOME/nosy/token when that is set). The file's content is the token (surrounding
//     whitespace trimmed). On macOS and Linux a token file that group or others can read (mode & 0o077) is refused with the `chmod 600`
//     to run, and nothing is sent; Windows has no such check. The token is never printed.
//   Project: --project, else sources.json cloud.project, else the repo folder's name.
//   --yes: send without asking (a script, or an agent you told to publish). In a terminal without it, you are asked.
//   --allow-sensitive: go on although the privacy scan found a secret or personal data (read its list first).
//   Where it sends: https, or your own machine (localhost, 127.0.0.1); plain http to another host is refused, and a redirect is not followed (it would
//   replay the files). A file over Cloud's 1.5 million characters, or a request over 8 MB, is refused here with its size. The names of the people who wrote
//   your commits or your own branches, and the names of your unmerged branches, go to the privacy scan: one in the text that leaves stops the send.
//   After the send, the dashboard's answer says what it drew (`reads`); a matrix it drew nothing from exits 1 although the files arrived.
// Writes outward, so run it only when the owner asked. Exit code 1 on refusal or failure.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { glance } from "./glance.mjs";
import { rivalFacts } from "./rival-facts.mjs";
import { demandForCloud } from "./demand-facts.mjs";
import { forCloud as rivalDemandForCloud } from "./rival-demand.mjs";
import { netError } from "./hints.mjs";
import { readSources } from "./sources-file.mjs";
import { preflightMatrix, describe as describeMatrix } from "./matrix-preflight.mjs";

import readline from "node:readline";
import { safeStatus, safeDiff, safeLowhanging, safePsstFinal, finalIsCurrent, safeGlance, safeSummary, safeRuns, safeRoadmap, safeRivalSignals, authorNames, branchNames, PayloadKeys } from "./publish-safe.mjs";

export const Files = ["matrix.json", "state/status.json", "state/lowhanging.json", "state/diff.json", "history/runs.jsonl", "summary.md", "state/watch.json"];
const Tool = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const al = name => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = name => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };
const projectArg = al("--project"), urlArg = al("--url"), tokenFileArg = al("--token-file"), dry = flag("--dry-run"), full = flag("--full"), yes = flag("--yes"), allowSensitive = flag("--allow-sensitive");
const pm = argv[0] || process.env.NOSY_PM || "pm";

const fail = msg => { console.error(`Psst… ${msg}`); process.exit(1); };
// What an error says about a file: never a piece of the file (a JSON error quotes the text around the spot), and one line.
const why = e => (e instanceof SyntaxError ? "it isn't valid JSON" : String(e?.message ?? e).split("\n")[0].slice(0, 160));
let sources = {};
try { sources = readSources(pm); } catch {}
const cloud = sources.cloud || {};
// No built-in default: a send needs a target you configured (--url, NOSY_CLOUD_URL, or cloud.url in sources.json).
const target = urlArg || process.env.NOSY_CLOUD_URL || cloud.url || null;
const base = target ? target.replace(/\/+$/, "") : null;
const project = projectArg || cloud.project || path.basename(path.resolve(pm, ".."));
if (!/^[A-Za-z0-9][\w.-]{0,63}$/.test(project)) fail(`"${project}" isn't a valid project name (letters, digits, . _ -). Pass --project <name>.`);

// The token and your files cross the network: only over https, except to your own machine (a local Cloud, or a test). Checked before anything is
// listed, so a dry run says it too.
if (base) { let u; try { u = new URL(base); } catch {}
  if (!u || !/^https?:$/.test(u.protocol)) fail(`"${base}" isn't a web address (https://...). Check --url, NOSY_CLOUD_URL or cloud.url in pm/sources.json. Nothing was sent.`);
  if (u.protocol === "http:" && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) && !u.hostname.endsWith(".localhost")) fail(`${base} is plain http: your token and your files would cross the network unencrypted. Use the https address. Nothing was sent.`); }

const readJson = f => JSON.parse(fs.readFileSync(f, "utf8"));
const readJsonQuiet = f => { try { return readJson(f); } catch { return null; } };
// Local files that hold quotes are cut down first (publish-safe.mjs); a file that cannot be read is left out, never sent raw.
const Cut = { "state/status.json": t => JSON.stringify(safeStatus(JSON.parse(t)), null, 1), "state/diff.json": t => JSON.stringify(safeDiff(JSON.parse(t)), null, 1),
  "state/lowhanging.json": t => JSON.stringify(safeLowhanging(JSON.parse(t), readJsonQuiet(path.join(pm, "state", "receipts.json"))), null, 1), "summary.md": t => safeSummary(t), "history/runs.jsonl": t => safeRuns(t) };
const send = []; // {key, text}
for (const f of Files) {
  const file = path.join(pm, f);
  if (!fs.existsSync(file)) continue;
  try { const raw = fs.readFileSync(file, "utf8"); send.push({ key: `pm/${f}`, text: Cut[f] ? Cut[f](raw) : raw }); }
  catch (e) { console.error(`(${f} left out: it can't be read or cut down safely: ${why(e)})`); }
}
if (!send.some(x => x.key === "pm/matrix.json")) fail(`${pm}/matrix.json is missing: the dashboard is built around it. Run neighbors (or nosy weekly) first.`);
// Will the dashboard draw it? (internal request 196.) Cloud reads two shapes and five codes; on the first run on a real product it said nothing
// about a matrix it could not read and "Published" was printed anyway. The same reader as every other tool runs first, the owner's code
// words are mapped (sources.json → matrixCodes), and a matrix it could not draw stops the send here.
let matrixLine = "", expectedAreas = 0;
{ const m = send.find(x => x.key === "pm/matrix.json"), P = preflightMatrix(m.text, { codes: sources.matrixCodes || {} });
  if (!P.ok) fail(P.problem);
  m.text = P.text; matrixLine = describeMatrix(P.report); expectedAreas = P.report.areas; }
// The computed files: the first screen (references, not commit subjects), the rivals' price lines, and customer demand as counts.
try { const G = glance(pm, { refsOnly: true }); if (G && Object.keys(G).length) send.push({ key: "pm/state/glance.json", text: JSON.stringify({ generated: new Date().toISOString(), ...safeGlance(G) }) }); }
catch (e) { console.error(`(first screen skipped: ${why(e)})`); }
try { const R = rivalFacts(pm); if (Object.keys(R).length) send.push({ key: "pm/state/rival-facts.json", text: JSON.stringify({ generated: new Date().toISOString(), rivals: R }) }); }
catch (e) { console.error(`(rival facts skipped: ${why(e)})`); }
try { const D = demandForCloud(pm); if (D) send.push({ key: "pm/state/demand.json", text: JSON.stringify(D) }); } // no quotes, no decision or request titles
catch (e) { console.error(`(demand skipped: ${why(e)})`); }
// psst's checked list: when the refuter has run since the raw list was made, the dashboard shows what survived
// it under "Could come next", not the draft. An older checked list is not sent (it may no longer hold) and the dashboard keeps the raw one.
const notes = [];
try {
  if (finalIsCurrent(pm)) send.push({ key: "pm/state/psst-final.json", text: JSON.stringify(safePsstFinal(readJson(path.join(pm, "state", "psst-final.json"))), null, 1) });
  else if (fs.existsSync(path.join(pm, "state", "psst-final.json"))) notes.push("pm/state/psst-final.json is older than pm/state/lowhanging.json, so it is not sent and the dashboard shows the raw list: run psst again to check the new one.");
} catch (e) { console.error(`(checked list skipped: ${why(e)})`); }
{ const low = send.find(x => x.key === "pm/state/lowhanging.json"); let left = 0; try { left = JSON.parse(low.text).leftOut || 0; } catch {}
  if (left) notes.push(`${left} item${left === 1 ? "" : "s"} on the list ${left === 1 ? "is" : "are"} held on purpose (pm/state/receipts.json), so ${left === 1 ? "it was" : "they were"} left out of the list sent.`); }
// Rival demand is public tracker data about your rivals, only if you ran `nosy rival-demand`. Never your customers' words.
const rdFile = path.join(pm, "state", "rival-demand.json");
try { if (fs.existsSync(rdFile)) { const RD = rivalDemandForCloud(readJson(rdFile)); if (RD.repos.length) send.push({ key: "pm/state/rival-demand.json", text: JSON.stringify(RD) }); } }
catch (e) { console.error(`(rival demand skipped: ${why(e)})`); }
// The roadmap (roadmap.mjs) and the public numbers about rivals (rival-signals.mjs) go up only if you ran them: titles, #numbers and GitHub links; numbers
// and their public sources. Each is cut down to those fields first (publish-safe.mjs); pm/signal/ (your own rival notes included) is never read here.
for (const [name, cutFor] of [["roadmap.json", safeRoadmap], ["rival-signals.json", safeRivalSignals]]) {
  const f = path.join(pm, "state", name);
  try { if (fs.existsSync(f)) send.push({ key: `pm/state/${name}`, text: JSON.stringify(cutFor(readJson(f)), null, 1) }); }
  catch (e) { console.error(`(${name} skipped: ${why(e)})`); }
}

// Nosy Cloud's limits (its store.ts and index.ts): 1.5 million characters a file, 8 MB a request. Said here, before anything is scanned or sent,
// so a huge file is named with its size instead of a bare "413 Body too large" after the privacy scan has run.
const MaxFile = 1_500_000, MaxBody = 8_000_000;
for (const x of send) if (x.text.length > MaxFile) fail(`${x.key} is ${x.text.length.toLocaleString("en-US")} characters once cut down; Nosy Cloud takes at most ${MaxFile.toLocaleString("en-US")} per file. Shorten that file (older rows of a log, rival pages you do not need), then publish again. Nothing was sent.`);
{ const bytes = Buffer.byteLength(JSON.stringify({ project, files: Object.fromEntries(send.map(x => [x.key, x.text])), replace: true }));
  if (bytes > MaxBody) fail(`the request would be ${(bytes / 1e6).toFixed(1)} MB; Nosy Cloud takes at most ${MaxBody / 1e6} MB. Shorten the largest files (--dry-run lists their sizes). Nothing was sent.`); }

// "Never your data": the outgoing text is written to a temp folder and scanned there. A secret or personal data (an
// e-mail, a phone number, an IBAN, a card number, an ID number, a name from private.json, the people who wrote your
// commits or your own branches, or the name of one of your unmerged branches) stops the send unless you pass --allow-sensitive.
// The names go to the scan in a private.json of the temp folder (your own, plus these), not on the command line: a long list would not fit on Windows.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nosy-publish-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
for (const x of send) { const f = path.join(tmp, x.key); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, x.text); }
const scanPm = path.join(tmp, ".scan-pm"); fs.mkdirSync(scanPm);
{ const own = readJsonQuiet(path.join(pm, "private.json")), o = own && typeof own === "object" && !Array.isArray(own) ? own : {};
  fs.writeFileSync(path.join(scanPm, "private.json"), JSON.stringify({ ...o, names: [...(Array.isArray(o.names) ? o.names : []), ...authorNames(pm), ...branchNames(pm)] })); }
const scan = spawnSync(process.execPath, [path.join(Tool, "privacy-scan.mjs"), ...send.map(x => x.key), "--pm", scanPm], { encoding: "utf8", cwd: tmp, maxBuffer: 64 << 20 });
// Fails closed: 2 = a finding, anything else non-zero = the scan couldn't run. Only a finding can be overridden.
if (scan.status === 2 && allowSensitive) console.error(`${scan.stdout || ""}\n--allow-sensitive: sending although the scan found the above.`);
else if (scan.status !== 0) { process.stderr.write(scan.stdout || scan.stderr || ""); await new Promise(r => process.stderr.write("", r)); fail(scan.status === 2 ? "the privacy scan found a secret or personal data in the files above; nothing was sent. Fix it at the source, or (only if you have read the list and it is fine to send) run again with --allow-sensitive." : "the privacy scan couldn't run; nothing was sent."); }

// The token: environment, then a file. Read only when a real send is about to happen (a dry run only says where it would come from);
// never printed or logged. Returns { token, from } or { problem } (what to tell the owner; nothing was sent).
const defaultTokenFile = path.join(process.env.XDG_CONFIG_HOME && path.isAbsolute(process.env.XDG_CONFIG_HOME) ? process.env.XDG_CONFIG_HOME : path.join(os.homedir(), ".config"), "nosy", "token");
// A token is one run of printable ASCII. Anything else (a space or a line break inside it, a curly quote from a word processor) is a paste gone wrong,
// and would reach `fetch` as a header error that quotes it: stop here, naming where it came from, never the token.
const oneToken = (t, from) => (/^[\x21-\x7e]+$/.test(t) ? { token: t, from } : { problem: `the token in ${from} has a space, a line break or a character a token never has (a paste gone wrong?). Make a new one on ${base} and save it again. Nothing was sent.` });
function findToken() {
  const env = (process.env.NOSY_CLOUD_TOKEN || "").trim();
  if (env) return oneToken(env, "NOSY_CLOUD_TOKEN");
  const named = tokenFileArg || process.env.NOSY_CLOUD_TOKEN_FILE || null, file = named || defaultTokenFile;
  let st;
  try { st = fs.statSync(file); } catch (e) {
    if (named) return { problem: `the token file ${file} can't be read (${e.code || e.message}). Nothing was sent.` };
    return { short: `NOSY_CLOUD_TOKEN is not set and there is no token file at ${defaultTokenFile}`, problem: `no Cloud token: NOSY_CLOUD_TOKEN is not set and there is no token file. Make a token on ${base || "your Nosy Cloud"} (Connect your agent → Make a token) and save it in ${defaultTokenFile}: paste it into a text editor and save, then run \`chmod 600 ${defaultTokenFile}\`. From a shell: \`mkdir -p "$(dirname ${defaultTokenFile})" && printf '%s' '<token>' > ${defaultTokenFile} && chmod 600 ${defaultTokenFile}\` (that way the token appears in your shell history, so use the editor if you prefer). Another place: --token-file <path> or NOSY_CLOUD_TOKEN_FILE; NOSY_CLOUD_TOKEN in the environment also works. Never commit it.` };
  }
  if (!st.isFile()) return { problem: `the token file ${file} is not a plain file. Nothing was sent.` };
  // A key anyone on the machine can read isn't a secret: refuse it (macOS and Linux; Windows has no such mode bits).
  if (process.platform !== "win32" && st.mode & 0o077) return { problem: `the token file ${file} can be read by other users (mode ${(st.mode & 0o777).toString(8)}). Run \`chmod 600 ${file}\` and publish again. Nothing was sent.` };
  let text; try { text = fs.readFileSync(file, "utf8").trim(); } catch (e) { return { problem: `the token file ${file} can't be read (${e.code || e.message}). Nothing was sent.` }; }
  if (!text) return { problem: `the token file ${file} is empty. Save your token in it, then publish again. Nothing was sent.` };
  if (/\s/.test(text)) return { problem: `the token file ${file} holds more than one word; it should hold only the token. Nothing was sent.` };
  return oneToken(text, `the token file ${file}`);
}
const files = Object.fromEntries(send.map(x => [x.key, x.text]));
const kb = s => `${(Buffer.byteLength(s) / 1024).toFixed(1)} KB`;
console.log(`${dry ? "Would publish" : "Publishing"} ${send.length} file(s) to ${base || "(no target configured)"} as "${project}":`);
for (const x of send) console.log(`  ${x.key} (${kb(files[x.key])}): ${PayloadKeys[x.key] || ""}`);
const missing = Files.filter(f => !send.some(x => x.key === `pm/${f}`));
// (glance.json, rival-facts.json, demand.json and psst-final.json aren't in Files: they're always computed, so they're never "missing".)
if (missing.length) console.log(`  not found, will be cleared on the dashboard: ${missing.map(f => `pm/${f}`).join(", ")}`);
if (matrixLine) console.log(`  matrix: ${matrixLine}`);
for (const n of notes) console.log(`  ${n}`);
if (dry) { const T = findToken(); console.log(`  token: ${T.problem ? `not usable yet, a real run would stop (${T.short || T.problem.replace(/ Nothing was sent\.$/, "")})` : `found in ${T.from}; it is read only in a real run and never printed`}`); }
// What is not a count: said, per file, in the line that promises "counts and structure only".
const apart = [["pm/state/rival-demand.json", "titles and links of public issues on your rivals' trackers (their public data)"],
  ["pm/state/roadmap.json", "the titles, #numbers and GitHub links of your roadmap lines (the file you committed)"],
  ["pm/state/rival-signals.json", "public numbers about your rivals (stars, downloads, open roles, ratings; not your notes on them)"]].filter(([k]) => send.some(x => x.key === k));
console.log(apart.length
  ? `Counts and structure only, apart from ${apart.map(([k, d]) => `${k}: ${d}`).join("; ")}. No commit subjects, author names, PR titles, your own issue titles or customer quotes. Nothing else in pm/ leaves.`
  : "Counts and structure only: no commit subjects, author names, PR titles, issue titles or customer quotes. Nothing else in pm/ leaves.");
if (full) for (const x of send) console.log(`\n--- ${x.key} ---\n${x.text}`);
// A pipe holds about 64 KB: a big --full printout is still queued when process.exit runs, and the end of it was cut (a reader that is slow, an agent
// capturing the output). Wait until everything written so far has been handed over, then every exit below is safe.
await new Promise(r => process.stdout.write("", r));
if (dry) {
  if (!base) console.log("No target yet: set cloud.url in pm/sources.json, or NOSY_CLOUD_URL, or pass --url. A real run stops until you do."); process.exit(0); }

if (!base) fail("no target configured, so nothing was sent. Set `cloud.url` in pm/sources.json (or NOSY_CLOUD_URL, or --url <address>). Nosy has no default address: publishing is opt-in. `nosy publish --dry-run` shows what would go.");
const T = findToken();
if (T.problem) fail(T.problem);
const token = T.token, tokenFrom = T.from.replace(/^the token file /, "");
if (!yes) {
  if (!process.stdin.isTTY) fail(`not sent: this needs your yes. Read the list above (or run --dry-run --full), then run again with --yes.`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise(r => rl.question(`Send these ${send.length} file(s) to ${base}? [y/N] `, r)); rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) fail("not sent.");
}

let res;
try {
  res = await fetch(`${base}/api/publish`, {
    method: "POST", redirect: "manual", // a redirect would replay the files without asking: say where it points and stop
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "user-agent": "nosy-publish" },
    body: JSON.stringify({ project, files, replace: true }),
  });
} catch (e) { fail(`couldn't reach ${base}: ${netError(e)}. Nothing was sent; check your connection (or --url / NOSY_CLOUD_URL) and run it again.`); }
if (res.status >= 300 && res.status < 400) fail(`${base} answered ${res.status} and points to ${String(res.headers.get("location") || "somewhere else").slice(0, 200)}. Nothing was changed. Use that address as --url (the files are not sent to a place you did not choose).`);
const body = await res.json().catch(() => ({}));
const refused = ` The token was refused (it came from ${tokenFrom === "NOSY_CLOUD_TOKEN" ? "NOSY_CLOUD_TOKEN in your environment, which wins over any token file: unset it, or put the new token there" : `the token file ${tokenFrom}`}). Make a new one on the site (Connect your agent → Make a token) and save it there again.`;
if (!res.ok) fail(`${base} answered ${res.status}: ${body.error || "no details"}.${res.status === 401 || res.status === 403 ? refused : res.status >= 500 ? " The service is having trouble: nothing was changed, try again in a few minutes." : ""}`);
// What the dashboard says it read: "Published" only means the files arrived. A Cloud that answers with `reads`
// (what it parsed) gets it printed, and a matrix it drew nothing from is said plainly; an older Cloud has no `reads`, and that is said too.
const reads = body.reads;
console.log(`Published. Dashboard: ${body.url}`);
if (reads) {
  const m = reads.matrix;
  const drawn = m && (m.areas > 0 || expectedAreas === 0);
  console.log(drawn ? `The dashboard read: matrix ${m.areas} areas × ${m.rivals ?? 0} rivals${m.unknown ? `, ${m.unknown} cell${m.unknown === 1 ? "" : "s"} unknown to it` : ""}${m.declined ? `, ${m.declined} decided against` : ""}${reads.status ? `; status ${reads.status.main ?? "?"} on main` : ""}${reads.lowhanging != null ? `; ${reads.lowhanging} list item${reads.lowhanging === 1 ? "" : "s"}${reads.checked ? " (the refuter's checked list)" : ""}` : ""}${reads.roadmap ? `; roadmap ${reads.roadmap.now ?? 0} now, ${reads.roadmap.next ?? 0} next, ${reads.roadmap.later ?? 0} later, ${reads.roadmap.shipped ?? 0} shipped` : ""}${reads.signals != null ? `; public signals for ${reads.signals} rival${reads.signals === 1 ? "" : "s"}` : ""}.` : `⚠ The files arrived, but the dashboard drew no matrix from pm/matrix.json (it read ${m ? "0 areas" : "nothing"}). Open ${body.url} before telling anyone it is live.`);
  if (!drawn) process.exitCode = 1;
} else console.log("The files arrived. This Cloud doesn't say what it drew: open the dashboard and check the matrix before telling anyone it is live.");
