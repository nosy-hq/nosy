// todo.mjs: what only a person can do, or said they would. One file per item under pm/todo/, listed oldest first,
// said at session start, shown on the page as a count with titles (locally), and sent by `publish` as a count only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { todoId, todoParse, todoRender, todoSummary, todoLine, todoLoad } from "../tools/todo.mjs";
import { glance, renderGlance } from "../tools/glance.mjs";
import { safeGlance } from "../tools/publish-safe.mjs";

const TODO = path.join(Tool, "todo.mjs"), NOSY = path.join(Tool, "nosy.mjs"), MCP = path.join(Tool, "mcp.mjs");
const HOOK = path.join(Tool, "..", "..", "hooks", "psst-summary.mjs");
const dirs = [];
after(() => dirs.forEach(clean));
function fresh() {
  const root = temporary("nosy-todo-"); dirs.push(root);
  const pm = path.join(root, "pm"); fs.mkdirSync(pm, { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main" }));
  return pm;
}
const todo = (pm, ...a) => run(TODO, [pm, ...a]);
const NOW = Date.parse("2026-09-30T12:00:00Z");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

test("id: nt-<yyMMdd>-<up to 3 words>, unique, stop words dropped", () => {
  assert.equal(todoId("Submit Nosy to the Claude plugin directory", "2026-09-30"), "nt-260930-submit-nosy-claude");
  assert.equal(todoId("Pay the domain", "2026-09-30", new Set(["nt-260930-pay-domain"])), "nt-260930-pay-domain-2");
  assert.equal(todoId("???", "2026-09-30"), "nt-260930-todo");
});

test("a file round-trips: render then parse gives back the same item", () => {
  const t = { id: "nt-260930-a", todo: "Verify the org", who: "ali", why: "only the owner", blocks: "the listing", link: "https://x.test", added: "2026-09-30", status: "open" };
  const back = todoParse(todoRender(t));
  for (const k of Object.keys(t)) assert.equal(back[k], t[k], k);
  const done = todoParse(todoRender({ ...t, status: "done", done: "2026-10-01", note: "sent" }));
  assert.deepEqual([done.status, done.done, done.note], ["done", "2026-10-01", "sent"]);
  assert.ok(!todoRender({ ...t, status: "done", done: "2026-10-01" }).includes("When it's done"), "a closed item doesn't tell you to close it");
});

test("add, list, done: the everyday loop; a duplicate for the same person is refused, the same words for another person are not", () => {
  const pm = fresh();
  const a = todo(pm, "add", "Submit Nosy to the Claude plugin directory", "--who", "@bora", "--why", "only the account owner can", "--blocks", "the listing", "--date", "2026-09-24");
  assert.equal(a.code, 0, a.error);
  assert.match(a.output, /added nt-260924-submit-nosy-claude for bora/);
  assert.match(todo(pm, "add", "submit nosy to the claude plugin directory!", "--who", "bora").output, /already on the list as nt-260924-submit-nosy-claude/);
  assert.equal(todoLoad(pm).length, 1);
  assert.equal(todo(pm, "add", "Submit Nosy to the Claude plugin directory", "--who", "ali").code, 0);
  assert.equal(todoLoad(pm).length, 2);
  const l = todo(pm, "list");
  assert.equal(l.code, 0);
  assert.match(l.output, /2 things wait on people/);
  assert.match(l.output, /why: only the account owner can/);
  assert.match(l.output, /blocks: the listing/);
  const d = todo(pm, "done", "claude", "--who", "bora");
  assert.equal(d.code, 1, "'claude' fits both items: ask for more of the id, don't guess");
  assert.match(d.error, /fits more than one/);
  const one = todoLoad(pm).find(t => t.who === "bora").id;
  assert.equal(todo(pm, "done", one, "--note", "sent", "--date", "2026-09-30").code, 0);
  assert.equal(todoLoad(pm).find(t => t.id === one).status, "done");
  assert.match(todo(pm, "done", one).output, /already done/);
  assert.match(todo(pm, "list", "--who", "bora").output, /nothing waits on bora/);
});

test("drop needs a reason; a missing id says so and exits 1; an empty add is refused", () => {
  const pm = fresh();
  todo(pm, "add", "Sign the lease", "--who", "ali");
  const id = todoLoad(pm)[0].id;
  assert.equal(todo(pm, "drop", id).code, 1);
  assert.equal(todo(pm, "drop", id, "--reason", "not needed any more").code, 0);
  assert.equal(todoLoad(pm)[0].status, "dropped");
  assert.equal(todoLoad(pm)[0].dropReason, "not needed any more");
  assert.equal(todo(pm, "done", "zzz").code, 1);
  assert.equal(todo(pm, "add").code, 1);
  assert.equal(todo(pm, "add", "x", "--date", "yesterday").code, 1);
});

test("summary: only open items, oldest first, ages in whole days; the line says how many and how old", () => {
  const pm = fresh();
  todo(pm, "add", "Newer thing", "--who", "ali", "--date", "2026-09-29");
  todo(pm, "add", "Older thing", "--who", "bora", "--date", "2026-09-20");
  todo(pm, "add", "Same day thing", "--date", "2026-09-30");
  todo(pm, "add", "Closed thing", "--date", "2026-09-01"); todo(pm, "done", "closed-thing");
  const S = todoSummary(pm, { now: NOW });
  assert.deepEqual(S.items.map(i => [i.title, i.who, i.days]), [["Older thing", "bora", 10], ["Newer thing", "ali", 1], ["Same day thing", "owner", 0]]);
  assert.deepEqual([S.open, S.oldestDays, S.people], [3, 10, ["bora", "ali", "owner"]]);
  assert.equal(todoLine(S, { max: 2 }), "3 things wait on people, the oldest for 10 days: bora: Older thing (10 days) · ali: Newer thing (1 day) · +1 more");
  assert.equal(todoLine(todoSummary(pm, { now: NOW, onlyWho: "OWNER" })), "1 thing waits on a person: owner: Same day thing (today)");
  assert.equal(todoLine(todoSummary(fresh())), null);
});

test("people are grouped without regard to case or accents: the first spelling names them", () => {
  const pm = fresh();
  todo(pm, "add", "First thing", "--who", "Ada", "--date", "2026-09-28");
  todo(pm, "add", "Second thing", "--who", "@ada", "--date", "2026-09-29");
  const S = todoSummary(pm, { now: NOW });
  assert.deepEqual(S.people, ["Ada"]);
  assert.deepEqual(S.items.map(i => i.who), ["Ada", "Ada"]);
  assert.equal(todoSummary(pm, { now: NOW, onlyWho: "ADA" }).open, 2);
  assert.equal((todo(pm, "list").output.match(/^Ada$/gm) || []).length, 1, "one heading, not two");
});

test("nosy todo: no arguments lists, --all reaches the script, --json writes where you point it, help names it", () => {
  const pm = fresh();
  const at = (...a) => run(NOSY, [...a, "--pm", pm]);
  assert.match(at("todo").output, /nothing waits on a person/);
  assert.equal(at("todo", "add", "Renew the domain", "--who", "bora").code, 0);
  const id = todoLoad(pm)[0].id;
  assert.equal(at("todo", "done", id).code, 0);
  assert.match(at("todo", "--all").output, /Lately closed[\s\S]*Renew the domain/);
  assert.ok(!fs.existsSync(path.join(pm, "state", "todo.json")), "no copy of the titles in pm/state/, which the Action commits");
  const out = path.join(path.dirname(pm), "list.json");
  assert.equal(at("todo", "list", "--json", out).code, 0);
  assert.deepEqual([JSON.parse(fs.readFileSync(out, "utf8")).type, JSON.parse(fs.readFileSync(out, "utf8")).open], ["todo", 0], "--json writes where you point it");
  assert.match(run(NOSY, ["help"]).output, /nosy todo \[list\|add\|done\|drop\|show\]/);
  const bare = temporary("nosy-todo-bare-"); dirs.push(bare);
  assert.equal(run(NOSY, ["todo", "--pm", path.join(bare, "pm")]).code, 1, "no pm/: says how to set up, no stack trace");
});

test("session hook: says what waits on a person, and only when something does", () => {
  const pm = fresh(), root = path.dirname(pm);
  const seen = temporary("nosy-seen-"); dirs.push(seen); fs.writeFileSync(path.join(seen, "nosy-loaded.json"), "{}");
  const hook = env => run(HOOK, [], { input: JSON.stringify({ cwd: root }), env: { ...process.env, NOSY_STATE_DIR: seen, ...env } });
  assert.doesNotMatch(hook().output, /wait on people|waits on a person/);
  todo(pm, "add", "Submit Nosy to the Claude plugin directory", "--who", "bora", "--date", "2026-09-24");
  const said = hook().output;
  assert.match(said, /1 thing waits on a person.*bora: Submit Nosy to the Claude plugin directory/);
  assert.match(said, /These are for a person, not for you/);
  assert.equal(hook({ NOSY_NO_PSST: "1" }).output, "", "the summary switch silences it too");
  const id = todoLoad(pm)[0].id; todo(pm, "done", id);
  assert.doesNotMatch(hook().output, /waits on a person/);
});

test("page: the first screen shows a tile and the titles locally; what publish sends is a count and an age", () => {
  const pm = fresh();
  todo(pm, "add", "Pay the <b>domain</b> renewal", "--who", "bora", "--date", "2026-09-27");
  todo(pm, "add", "Verify the org", "--who", "ali");
  const G = glance(pm, { M: null });
  assert.equal(G.todo.open, 2);
  assert.deepEqual(G.todo.items.map(i => i.who), ["bora", "ali"]);
  const tile = G.tiles.find(t => t.key === "people");
  assert.deepEqual([tile.label, tile.value, tile.unit], ["Waiting on people", 2, "things"]);
  const html = renderGlance(G, { esc });
  assert.match(html, /Waiting on people/);
  assert.match(html, /Pay the &lt;b&gt;domain&lt;\/b&gt; renewal/, "escaped, never markup");
  const sent = glance(pm, { M: null, refsOnly: true });
  assert.deepEqual(sent.todo.items, []);
  const safe = JSON.stringify(safeGlance(G));
  assert.doesNotMatch(safe, /domain|Verify the org|bora|ali/, "no title, no name leaves");
  assert.equal(safeGlance(G).todo.open, 2);
  assert.equal(glance(fresh(), { M: null }).todo, undefined, "nothing waiting: no tile, no panel");
});

test("MCP: nosy_todo lists, adds and closes, and needs no repo", () => {
  const pm = fresh();
  const talk = msgs => run(MCP, [], { input: msgs.map(m => JSON.stringify({ jsonrpc: "2.0", ...m })).join("\n") + "\n", env: { ...process.env, NOSY_PM: pm } }).output.trim().split("\n").map(l => JSON.parse(l));
  const [tools, added, listed] = talk([
    { id: 1, method: "tools/list" },
    { id: 2, method: "tools/call", params: { name: "nosy_todo", arguments: { action: "add", text: "Pay the domain renewal", who: "bora", why: "his card" } } },
    { id: 3, method: "tools/call", params: { name: "nosy_todo", arguments: {} } },
  ]);
  assert.ok(tools.result.tools.some(t => t.name === "nosy_todo"));
  assert.match(added.result.content[0].text, /added nt-\d{6}-pay-domain-renewal for bora/);
  assert.match(listed.result.content[0].text, /why: his card/);
  const id = todoLoad(pm)[0].id;
  const [closed] = talk([{ id: 4, method: "tools/call", params: { name: "nosy_todo", arguments: { action: "done", id, note: "paid" } } }]);
  assert.equal(closed.result.isError, false);
  assert.equal(todoLoad(pm)[0].status, "done");
});
