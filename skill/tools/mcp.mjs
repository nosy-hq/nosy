// Nosy MCP server (stdio, one JSON-RPC 2.0 message per line). No dependencies. Exposes Nosy's model-free counts
// as tools to any client that can connect to MCP: Claude Desktop, Cursor, Zed, VS Code, ChatGPT desktop…
// Run with: `node mcp.mjs` or `nosy mcp`. pm folder: the tool argument `pm`, else NOSY_PM, else ./pm.
// Tools read your repo and write under pm/ (mostly pm/state/; nosy_todo writes pm/todo/); the one exception is nosy_publish, which by itself only
// shows what it would send (a dry run). It sends counts and structure to your configured Nosy Cloud only when the call
// carries confirm: true, after the owner asked (see publish.mjs). No push, issue, or message.
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cleanTrace, repoProblem, sourcesProblem } from "./hints.mjs";
import { readSources } from "./sources-file.mjs";
import { versionOf } from "./loaded.mjs";

const Tool = path.dirname(fileURLToPath(import.meta.url));
const Version = versionOf();
const Protocols = ["2025-06-18", "2025-03-26", "2024-11-05"];

const pmArg = { pm: { type: "string", description: "path to the pm folder (default ./pm)" } };
const Tools = [
  { name: "nosy_psst", description: "Cheap, valuable work: backend ready but no screen, status gone stale, an issue opened against us, a new feature not tied to any plan, a key step firing no event… A ranked list with evidence.",
    inputSchema: { type: "object", properties: { ...pmArg } }, cmd: a => ["nosy.mjs", "psst", "--pm", a.pm] },
  { name: "nosy_canwe", description: "An evidence skeleton for \"can we do this?\": matching endpoints and screen status, decisions, rivals, recent commits. You render the verdict.",
    inputSchema: { type: "object", properties: { question: { type: "string", description: "Question, e.g. \"bulk export\"" }, ...pmArg }, required: ["question"] },
    cmd: a => ["nosy.mjs", "canwe", a.question, "--pm", a.pm] },
  { name: "nosy_peek", description: "What actually shipped from git recently: commits grouped by reference, open PRs included.",
    inputSchema: { type: "object", properties: { since: { type: "string", description: "7d, 30d, YYYY-MM-DD, or a git ref (default 7d)" }, ...pmArg } },
    cmd: a => ["nosy.mjs", "peek", a.since || "7d", "--pm", a.pm] },
  { name: "nosy_inventory", description: "Backend inventory: endpoints and which ones have a screen, which don't.",
    inputSchema: { type: "object", properties: { ...pmArg } }, cmd: a => ["nosy.mjs", "inventory", "--pm", a.pm] },
  { name: "nosy_evidence", description: "An evidence pack for a topic (pre-PRD): decisions, request items, rival paragraphs, matrix, recent commits.",
    inputSchema: { type: "object", properties: { topic: { type: "string" }, ...pmArg }, required: ["topic"] },
    cmd: a => ["gather-evidence.mjs", a.pm, a.topic], readOnly: true },
  { name: "nosy_ledger", description: "The canwe answer ledger: was this question asked before, what's changed since. All answers if no question is given.",
    inputSchema: { type: "object", properties: { question: { type: "string" }, ...pmArg } },
    cmd: a => a.question ? ["ledger.mjs", a.pm, "find", a.question] : ["ledger.mjs", a.pm, "list"], readOnly: true },
  { name: "nosy_todo", description: "What only a person can do, or said they would (pm/todo/). action \"list\" (default) shows what waits, oldest first; \"add\" files one when you reach a step you can't take (an account, a payment, a submission under someone's name, a token, a sign-off) so it isn't lost when the chat ends; \"done\" closes one, only after the person says it is done or you can see it is. Never do a listed item yourself.",
    inputSchema: { type: "object", properties: { ...pmArg, action: { type: "string", enum: ["list", "add", "done", "drop"], description: "default list" }, text: { type: "string", description: "add: what the person has to do, one line" }, who: { type: "string", description: "add: the person's own name; default owner. list: only this person's items" }, why: { type: "string", description: "add: why only a person can do it" }, blocks: { type: "string", description: "add: what waits on it" }, link: { type: "string", description: "add: a URL or reference" }, id: { type: "string", description: "done, drop: the item's id, or a part of it that names one" }, note: { type: "string", description: "done: how it went" }, reason: { type: "string", description: "drop: why it is no longer needed" } } },
    cmd: a => ["todo.mjs", a.pm, a.action || "list", ...(a.action === "add" ? [a.text || ""] : a.action === "done" || a.action === "drop" ? [a.id || ""] : []),
      ...(a.who ? ["--who", a.who] : []), ...(a.action === "add" ? [...(a.why ? ["--why", a.why] : []), ...(a.blocks ? ["--blocks", a.blocks] : []), ...(a.link ? ["--link", a.link] : [])] : []),
      ...(a.action === "done" && a.note ? ["--note", a.note] : []), ...(a.action === "drop" && a.reason ? ["--reason", a.reason] : [])] },
  { name: "nosy_publish", description: "Send counts and structure of pm/ (matrix, status, next, changes, run history, summary; no commit subjects, author names, PR or issue titles, no customer quotes) to the Nosy Cloud dashboard configured for this project, straight from disk after a privacy scan that stops on secrets and personal data. Without confirm: true it only lists what would be sent (a dry run): show that list to the owner first. With confirm: true it sends; call it only after the owner said yes. Needs cloud.url in pm/sources.json (or NOSY_CLOUD_URL) and NOSY_CLOUD_TOKEN in the server's environment.",
    inputSchema: { type: "object", properties: { project: { type: "string", description: "project name on Nosy Cloud (default: the repo folder's name)" }, confirm: { type: "boolean", description: "true only after the owner approved the list from the dry run" }, dry_run: { type: "boolean", description: "force a dry run even with confirm" }, ...pmArg } },
    cmd: a => ["publish.mjs", a.pm, ...(a.project ? ["--project", a.project] : []), ...(a.dry_run || !a.confirm ? ["--dry-run"] : ["--yes"])], openWorld: true, destructive: true },
];

// Before running a tool: does the pm folder read, and does the repo it names? A client starts this server from any folder
// (Claude Desktop's is often "/"), so a missing pm/ or a relative repo is the usual first failure. That is a JSON-RPC error
// carrying the fix in one line, not a stack trace as the tool's text. Tools that read no repo (the ledger) skip the repo half.
const NoRepo = new Set(["nosy_ledger", "nosy_publish", "nosy_todo"]);
function problem(name, pm) {
  let bad = sourcesProblem(pm);
  if (!bad && !NoRepo.has(name)) { try { bad = repoProblem(readSources(pm)); } catch (e) { bad = `couldn't read ${pm}/sources.json: ${String(e.message).split("\n")[0]}`; } }
  return bad && `${bad}${/no .*folder here|is missing/.test(bad) ? " In your MCP client's config, set the NOSY_PM environment variable to the pm folder's absolute path (or pass the tool's `pm` argument)." : ""}`;
}

function call(name, input = {}) {
  const t = Tools.find(x => x.name === name);
  if (!t) return { error: `Unknown tool: ${name}` };
  const a = { ...input, pm: input.pm || process.env.NOSY_PM || "pm" };
  const bad = problem(name, a.pm);
  if (bad) return { unusable: `Psst… ${bad}` };
  const [script, ...args] = t.cmd(a);
  const r = spawnSync(process.execPath, [path.join(Tool, script), ...args], { encoding: "utf8", maxBuffer: 64 << 20, cwd: process.cwd() });
  // A script that crashed says what broke and the fix (hints.mjs), not its stack trace.
  const text = [r.stdout, r.status ? cleanTrace(r.stderr) || r.stderr : r.stderr].filter(Boolean).join("\n").trim() || "(no output)";
  return { text, isError: r.status !== 0 };
}

const write = m => process.stdout.write(JSON.stringify(m) + "\n");
const answer = (id, result) => write({ jsonrpc: "2.0", id, result });
const error = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });

function handle(m) {
  const { id, method, params = {} } = m;
  if (id === undefined) return; // notification (notifications/initialized etc.): no reply
  switch (method) {
    case "initialize":
      return answer(id, {
        protocolVersion: Protocols.includes(params.protocolVersion) ? params.protocolVersion : Protocols[0],
        capabilities: { tools: {} },
        serverInfo: { name: "nosy", version: Version },
        instructions: "Nosy about your product. Never your data. These tools count and gather evidence; the product call is yours. This is not a code review.",
      });
    case "ping": return answer(id, {});
    // Annotations say what a tool does to the world, so a client can let the read-only ones run without asking (BlogFactory field test: all eight said
// readOnlyHint:false, the two that only read included). readOnly: it writes nothing at all. The others write generated files under pm/ (state/…).
    // destructive: it replaces something that was there (publish replaces the project's files on Nosy Cloud). openWorld: it talks to something outside this machine.
    case "tools/list": return answer(id, { tools: Tools.map(({ cmd, openWorld, readOnly, destructive, ...t }) => ({ ...t, annotations: { readOnlyHint: !!readOnly, destructiveHint: !readOnly && !!destructive, openWorldHint: !!openWorld } })) });
    case "tools/call": {
      const r = call(params.name, params.arguments);
      if (r.error) return error(id, -32602, r.error);
      if (r.unusable) return error(id, -32000, r.unusable);
      return answer(id, { content: [{ type: "text", text: r.text }], isError: r.isError });
    }
    default: return error(id, -32601, `Unsupported method: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", line => {
  if (!line.trim()) return;
  let m; try { m = JSON.parse(line); } catch { return error(null, -32700, "Could not parse JSON"); }
  for (const x of Array.isArray(m) ? m : [m]) handle(x);
});
