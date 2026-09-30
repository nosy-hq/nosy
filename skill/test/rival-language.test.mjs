// Contract test for skill/tools/rival-language.mjs: rival-featured claims vs Nosy's own
// 21-step matrix - per-step rival words, unmapped claims grouped into candidate steps, steps no rival features.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { claimsOf, keywordsOf } from "../tools/rival-language.mjs";

let root, pm, R;
const rival = (slug, name, body) => fs.writeFileSync(path.join(pm, "rivals", `${slug}.md`), `# ${name}\n\n${body}`);

before(() => {
  root = temporary("nosy-rival-language-"); pm = path.join(root, "pm");
  fs.mkdirSync(path.join(pm, "rivals"), { recursive: true }); fs.mkdirSync(path.join(pm, "state"), { recursive: true });

  const matrix = {
    steps: [
      { no: "1", name: "Product and rival definition (setup)" },
      { no: "2", name: "Scanning rival sites and announcements" },
      { no: "3", name: "Continuous rival monitoring, change alerts" },
      { no: "4", name: "Building the feature matrix on its own" },
    ],
    biz: { name: "Nosy", codes: { 1: "y", 2: "y", 3: "y", 4: "y" } },
    products: [{ name: "Acme", codes: { 1: { k: "y" }, 2: { k: "y" }, 3: { k: "d" }, 4: { k: "u" } } }],
  };
  fs.writeFileSync(path.join(pm, "matrix.json"), JSON.stringify(matrix));
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ matrix: path.join(pm, "matrix.json") }));

  // Two rivals feature step 2 in similar words; one features step 1; nobody features step 3 or 4.
  rival("acme", "Acme", `## Featured on the landing page
- [2] Scan every competitor announcement automatically (https://acme.test, 2026-09-01)
- [1] Set up your own product and rivals in minutes (https://acme.test, 2026-09-01)
`);
  rival("bolt", "Bolt", `## Featured on the landing page
- [2] Automatic competitor announcement scanning, every day (https://bolt.test, 2026-09-02)
- [?] Slack-native workflow, your whole team in one channel (https://bolt.test, 2026-09-02)
`);
  // A step number outside the matrix (5 doesn't exist here) is also "unmapped", and shares a word ("workflow")
  // with Bolt's [?] claim above, so the two should cluster into one candidate group.
  rival("cursor-inc", "Cursor Inc", `## Featured on the landing page
- [5] One workflow for the whole team, start to ship (https://cursor.test, 2026-09-03)
`);
  // A rival with no "Featured" section at all shouldn't blow anything up.
  rival("quiet", "Quiet Co", `## How it works (flows, screens, commands)
- Nothing landing-page-y here.
`);

  const j = path.join(pm, "state", "rival-language.json");
  const r = run(path.join(Tool, "rival-language.mjs"), [pm, "--json", j]);
  assert.equal(r.code, 0, `stderr: ${r.error}\n${r.output}`);
  R = { md: r.output, data: JSON.parse(fs.readFileSync(j, "utf8")) };
});
after(() => clean(root));

test("claimsOf/keywordsOf: bullet parsing and stemmed keyword extraction", () => {
  const cs = claimsOf("## Featured on the landing page\n- [2] Scan every competitor (url, date)\n\n## Other\n- not this one\n");
  assert.deepEqual(cs, [{ no: "2", claim: "Scan every competitor (url, date)" }]);
  assert.ok(keywordsOf("Scan every competitor announcement automatically").includes(root_("competitor")));
  function root_(w) { return keywordsOf(w)[0]; }
});

test("per step: rival count and shared words, only for steps that are actually featured", () => {
  const step2 = R.data.steps.find(s => s.no === "2");
  assert.equal(step2.rivals, 2);
  assert.ok(step2.top.some(t => t.rivals === 2), "a word shared by both rivals should surface with rivals:2");
  const step1 = R.data.steps.find(s => s.no === "1");
  assert.equal(step1.rivals, 1);
});

test("steps no rival features: step 3 (only [d] in the matrix) and 4 never show up in any claim", () => {
  const no = R.data.unfeatured.map(s => s.no);
  assert.ok(no.includes("3"));
  assert.ok(no.includes("4"));
  assert.ok(!no.includes("1") && !no.includes("2"));
});

test("unmapped claims ([?] and an out-of-range number) cluster into a candidate group by a shared word, never touch the matrix", () => {
  assert.equal(R.data.summary.unmapped, 2);
  assert.equal(R.data.candidates.length, 1, `expected the two 'workflow' claims to merge into one group: ${JSON.stringify(R.data.candidates)}`);
  const g = R.data.candidates[0];
  assert.equal(g.rivals, 2);
  assert.ok(g.members.some(m => m.rival === "Bolt" && m.marked === "?"));
  assert.ok(g.members.some(m => m.rival === "Cursor Inc" && m.marked === "5"));
  assert.match(g.label, /workfl/); // text.mjs's root() stems ("workflow" -> "workfl"), same as frontyard.mjs elsewhere
});

test("markdown: candidate section says 'owner decides', never claims a step was added", () => {
  assert.match(R.md, /Candidate steps — owner decides/);
  assert.doesNotMatch(R.md, /added to the matrix/i);
});

test("a rival file with no Featured section is skipped without error", () => {
  assert.ok(!R.md.includes("Quiet Co"));
});

test("no pm/rivals/ folder: a clear message, not a crash", () => {
  const empty = temporary("nosy-rival-language-empty-");
  try {
    fs.mkdirSync(path.join(empty, "pm"), { recursive: true });
    fs.writeFileSync(path.join(empty, "pm", "sources.json"), JSON.stringify({ matrix: path.join(pm, "matrix.json") }));
    const r = run(path.join(Tool, "rival-language.mjs"), [path.join(empty, "pm")]);
    assert.equal(r.code, 0);
    assert.match(r.output, /run `neighbors` first/);
  } finally { clean(empty); }
});

test("no matrix in sources.json: a clear message, not a crash", () => {
  const empty = temporary("nosy-rival-language-nomatrix-");
  try {
    fs.mkdirSync(path.join(empty, "pm", "rivals"), { recursive: true });
    fs.writeFileSync(path.join(empty, "pm", "sources.json"), JSON.stringify({}));
    const r = run(path.join(Tool, "rival-language.mjs"), [path.join(empty, "pm")]);
    assert.equal(r.code, 0);
    assert.match(r.output, /move-in.*neighbors/);
  } finally { clean(empty); }
});
