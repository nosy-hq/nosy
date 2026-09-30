// psst-receipts.mjs: the check step's receipts. Every item psst lost a blind test on is a
// regression case here, reproduced in a temp monorepo (the first product's shapes, invented names):
//   v5  merge a branch a later decision overruled        → "a branch … older than a decision" test
//   v5  "data entry" for plans whose fields don't exist  → "request text and the screen's own need" test
//   v5  "one wire" for a change another app lacks        → "reach" test
//   v6  a section from fields held on purpose (#385)     → "the code's own words at the evidence" test
// The script can only put the receipt in front of the agent; psst.md step 3 says what the agent must do with it.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { receipts, formatMd } from "../tools/psst-receipts.mjs";
import { temporary, clean } from "./helpers.mjs";

const dirs = [];
after(() => dirs.forEach(clean));

function product() {
  const root = temporary("nosy-receipts-"); dirs.push(root);
  const at = (d, ...a) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d } });
  const put = (f, body) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), body); };
  at("2026-09-01T10:00:00Z", "init", "-q", "-b", "main");
  put("apps/backend/turn.go", "type Turn struct { resource_ids []string }\n");
  put("apps/web/chat.tsx", "const resource_ids = [];\n");
  put("apps/agent/run.py", "def run(message): pass\n");
  put("apps/web/entities/record/mapper.ts", [
    "import type { RecordDTO } from './contract';",
    "// dropped: RecordDTO.source_label — no Source section on the record screen yet; the screen decision is separate (#385).",
    "export const toRecord = (d: RecordDTO) => ({ id: d.id });",
    "export const plain = 1; // nothing held here",
  ].join("\n") + "\n");
  put("docs/NEEDS.md", [
    "# Needs", "",
    "### 26. A plan catalogue", "", "- **Status:** partial. A plan has no description, features or highlight.", "- **Needed:** `description`, `features[]`, `highlighted` on each plan.", "",
    "### 45. Daily gazette", "", "- The day's issue is read by the corpus (K2). Tab: `gazette-tab` branch, not on main yet.", "",
    "### 9. Record as chat context", "", "- **Still missing:** turns carry `resource_ids` to the agent.", "",
  ].join("\n"));
  put("DECISIONS.md", "# Decisions\n\n## K1 — Plans\n\nPlans are data.\n\n## K3 — Routers\n\nEvery package keeps its own http/routes.go; the web mapper at entities/record/mapper.ts stays thin.\n");
  at("2026-09-01T10:00:00Z", "add", "."); at("2026-09-01T10:00:00Z", "commit", "-qm", "init");
  // A screen branch from before the decision, never merged.
  at("2026-09-10T10:00:00Z", "checkout", "-q", "-b", "gazette-tab");
  put("apps/web/gazette.tsx", "fetch('https://gazette.example/today')\n");
  at("2026-09-10T10:00:00Z", "add", "."); at("2026-09-10T10:00:00Z", "commit", "-qm", "gazette tab, direct fetch");
  at("2026-09-10T10:00:00Z", "checkout", "-q", "main");
  // The decision that replaced the direct fetch, a day later.
  fs.appendFileSync(path.join(root, "DECISIONS.md"), "\n## K2 — Gazette is read by the corpus, not the web app\n\nOne outbound gate.\n");
  at("2026-09-11T10:00:00Z", "add", "."); at("2026-09-11T10:00:00Z", "commit", "-qm", "K2");
  const merged = execFileSync("git", ["-C", root, "rev-parse", "--short=9", "HEAD"], { encoding: "utf8" }).trim();
  const pm = path.join(root, "pm"); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main", request: { path: "docs/NEEDS.md", title: "^### (\\d+[a-z]?)\\. (.+)$" }, preread: { decisions: "DECISIONS.md" }, refs: ["§\\d+", "\\bK\\d+\\b", "#\\d+"] }));
  fs.writeFileSync(path.join(pm, "state", "pending.json"), JSON.stringify({ items: [
    { kind: "marker", title: "Plans", ref: "§26", evidence: "apps/web/pricing.tsx:3", detail: ["need: description / features[] / highlighted on a plan (§26)"] },
  ] }));
  fs.writeFileSync(path.join(pm, "state", "lowhanging.json"), JSON.stringify({ items: [
    { score: 3, type: "Screen built, waiting for backend", title: "§26 · Plans", ref: "§26", evidence: "apps/web/pricing.tsx:3", detail: [] },
    { score: 3, type: "Screen built, waiting for backend", title: "§45 · Daily gazette", ref: "§45", evidence: "apps/web/gazette-page.tsx:9", detail: [`was in ${merged}`] },
    { score: 3, type: "Screen built, waiting for backend", title: "§9 · Record as chat context", ref: "§9", evidence: "apps/web/chat.tsx:1", detail: [] },
    { score: 3, type: "Backend ready, not on screen", title: "#385 record · 1 fields", ref: "#385", evidence: "apps/web/entities/record/mapper.ts:2", detail: [] },
    { score: 3, type: "Backend ready, not on screen", title: "plain line", evidence: "apps/web/entities/record/mapper.ts:4", detail: [] },
    { score: 3, type: "Endpoint exists, no screen", title: "run", evidence: "apps/agent/run.py:1", detail: [] },
    { score: 1, type: "Key step not measured", title: "noise", evidence: "x", detail: [] },
  ] }));
  return { pm, merged };
}

test("request text and the screen's own need come with the item", () => {
  const { pm } = product();
  const R = receipts(pm);
  assert.equal(R.items.length, 6, "only items scored 2+");
  const plans = R.items[0];
  assert.match(plans.request[0].text, /A plan has no description, features or highlight/);
  assert.deepEqual(plans.needs, ["need: description / features[] / highlighted on a plan (§26)"]);
});

test("a branch the text mentions: not merged and older than a decision the item touches is flagged; merged commits say so", () => {
  const { pm, merged } = product();
  const gazette = receipts(pm).items[1];
  assert.deepEqual(gazette.decisions.map(d => d.no), ["K2"], "K2 is named by the request section");
  assert.equal(gazette.decisions[0].date, "2026-09-11", "dated from git, not from the heading's words");
  const branch = gazette.history.find(h => h.kind === "branch");
  assert.equal(branch.name, "gazette-tab");
  assert.equal(branch.merged, false);
  assert.deepEqual(branch.olderThan, ["K2"]);
  assert.deepEqual(gazette.history.find(h => h.kind === "commit"), { kind: "commit", name: merged, date: "2026-09-11", merged: true });
  const md = formatMd(receipts(pm));
  assert.match(md, /✗ branch `gazette-tab` \(2026-09-10\) is not merged · ⚠ older than decision K2/);
  assert.match(md, /is already merged \(if the text above says it isn't, the text is out of date\)/);
});

test("reach: which apps contain a code name, so a cross-app change can't be called one wire; plain words are skipped", () => {
  const { pm } = product();
  const chat = receipts(pm).items[2];
  const r = chat.reach.find(x => x.id === "resource_ids");
  assert.deepEqual(r.in.map(x => x.app), ["apps/backend", "apps/web"]);
  assert.deepEqual(r.notIn, ["apps/agent"]);
  assert.ok(!receipts(pm).items[0].reach.some(x => x.id === "description"), "a plain word isn't a code name");
});

test("no lowhanging list: a clear message, not a crash", () => {
  const { pm } = product();
  fs.rmSync(path.join(pm, "state", "lowhanging.json"));
  assert.equal(receipts(pm), null);
  assert.match(formatMd(null), /run psst/);
});

test("the code's own words at the evidence: a ref in the comment holds the item; a decision naming the file (3 path parts) too; plain code doesn't", () => {
  const { pm } = product();
  const R = receipts(pm), [held, plainLine, run] = R.items.slice(3);
  assert.deepEqual(held.gate.because, [{ at: "apps/web/entities/record/mapper.ts:2", refs: ["#385"], decisions: ["K3"] }]);
  assert.match(held.code[0].text.join("\n"), /the screen decision is separate \(#385\)/);
  assert.equal(plainLine.gate?.because?.[0]?.refs?.length || 0, 0, "a trailing comment without a ref holds nothing");
  assert.deepEqual(plainLine.gate?.because?.[0]?.decisions, ["K3"], "but K3 names the file, so it's still behind the gate");
  assert.equal(run.gate, null, "apps/agent/run.py: no comment, no decision naming agent/run.py");
  assert.match(formatMd(R), /⛔ Held on purpose until shown otherwise:\*\* the code at apps\/web\/entities\/record\/mapper\.ts:2 \(#385, decision K3\)/);
});
