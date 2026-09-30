// Contract test for internal request 118 (pm/log.md): GitHub-issue mode used to treat EVERY issue opened
// in the window as a "decision" as long as it had a feature/enhancement label OR was opened by a team
// member — on a repo with no curated label convention that's every issue (133/133 on Twenty), not a
// decision signal. Now only three EXPLICIT signals count: a label the product configures in sources.json's
// `issue.decisionLabels`, a milestone, or an explicit link to a merged PR — and the run says which source
// produced the count, never printing a headline number next to the full issue total when nothing signals
// at all (no fake denominator).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean } from "./helpers.mjs";

const Script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tools", "shipped-record.mjs");

let K, gh, tmp, jsonPath, shippedJsonPath, output;

before(async () => {
  K = await fakeProductSetup();
  const ownerRepo = K.issueRepo;
  const now = new Date().toISOString();

  // Configure a product-chosen decision label (never a guessed default like "enhancement").
  const sources = JSON.parse(fs.readFileSync(K.sources, "utf8"));
  sources.issue = { ...(sources.issue || {}), decisionLabels: ["decision", "roadmap"] };
  fs.writeFileSync(K.sources, JSON.stringify(sources, null, 1));

  K.gh.searchPRs = [
    // 900: closes #960 (a milestone-only issue's own link isn't needed, but exercise closes here too).
    { number: 900, title: "fix: shipment list pagination", body: "", baseRefName: "main", mergedAt: now, createdAt: now,
      mergeCommit: { oid: K.commits.at(-1).hash },
      closingIssuesReferences: { nodes: [{ number: 963, repository: { nameWithOwner: ownerRepo } }] } },
  ];
  K.gh.searchIssues = [
    // 961: labeled "decision" (matches sources.json's issue.decisionLabels) -> counts, signal "label".
    { number: 961, title: "Adopt the new billing model", body: "", createdAt: now, closedAt: null,
      state: "OPEN", stateReason: null, author: { login: "pm1" }, authorAssociation: "MEMBER",
      labels: { nodes: [{ name: "decision" }] } },
    // 962: milestoned, no configured label -> counts, signal "milestone".
    { number: 962, title: "Ship the v2 onboarding flow", body: "", createdAt: now, closedAt: null,
      state: "OPEN", stateReason: null, author: { login: "customer1" }, authorAssociation: "NONE",
      labels: { nodes: [] }, milestone: { title: "v2" } },
    // 963: no label, no milestone, but closed by merged PR #900 -> counts, signal "link" (closes).
    { number: 963, title: "Pagination is broken on the shipment list", body: "", createdAt: now, closedAt: now,
      state: "CLOSED", stateReason: "COMPLETED", author: { login: "customer2" }, authorAssociation: "NONE",
      labels: { nodes: [] } },
    // 964: "enhancement" label (a GitHub default, NOT configured in decisionLabels), opened by a team
    // member, no milestone, no link -> must NOT be counted at all (this is the bug internal request 118 fixes).
    { number: 964, title: "Minor enhancement to the shipment list", body: "", createdAt: now, closedAt: null,
      state: "OPEN", stateReason: null, author: { login: "alice" }, authorAssociation: "MEMBER",
      labels: { nodes: [{ name: "enhancement" }] } },
    // 965: bare "just wondering" issue, no signal of any kind -> must NOT be counted.
    { number: 965, title: "Just wondering about the roadmap", body: "", createdAt: now, closedAt: null,
      state: "OPEN", stateReason: null, author: { login: "customer3" }, authorAssociation: "NONE",
      labels: { nodes: [] } },
  ];

  gh = fakeGhSetup(K.gh);
  tmp = temporary("nosy-decision-signals-");
  jsonPath = path.join(tmp, "out.json");
  shippedJsonPath = path.join(tmp, "shipped.json");
  const r = run(Script, [K.repo, K.issueRepo, "--day", "90", "--pm", K.pm, "--json", jsonPath, "--shipped-json", shippedJsonPath], { env: gh.env });
  assert.equal(r.code, 0, `shipped-record.mjs: unexpected exit code, stderr: ${r.error}`);
  output = { text: r.output, json: JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
});
after(() => { clean(K.root); clean(gh.dir); clean(tmp); });

test("a configured decisionLabels label counts an issue as a decision (signal: label)", () => {
  const row = output.json.decisions.find(d => d.issue === 961);
  assert.ok(row, "#961 (labeled 'decision', configured in sources.json) should be a decision");
});

test("a milestone counts an issue as a decision with no configuration needed (signal: milestone)", () => {
  const row = output.json.decisions.find(d => d.issue === 962);
  assert.ok(row, "#962 (milestoned) should be a decision");
});

test("an explicit link to a merged PR still counts on its own (signal: link)", () => {
  const row = output.json.decisions.find(d => d.issue === 963);
  assert.ok(row, "#963 (closed by merged PR #900) should be a decision");
  assert.equal(row.source, "closes");
});

test("an unconfigured default label ('enhancement') plus team authorship is NOT a decision signal", () => {
  const row = output.json.decisions.find(d => d.issue === 964);
  assert.equal(row, undefined, "#964 has only a non-configured label and team authorship — neither is a decision signal any more");
});

test("a bare issue with no signal at all is not counted", () => {
  const row = output.json.decisions.find(d => d.issue === 965);
  assert.equal(row, undefined);
});

test("decision_count reflects only signaled issues (3), not every issue opened (5) — no fake denominator", () => {
  assert.equal(output.json.summary.decision_count, 3);
  assert.equal(output.json.decisions.length, 3);
});

test("the run prints which source produced the count", () => {
  assert.match(output.text, /decisions: 3 issues? \(.*\); 2 other issues? not counted as decisions\./);
});

test("pm/state/shipped.json: counts.requests matches the real (filtered) decision count, not the raw issue total", () => {
  const j = JSON.parse(fs.readFileSync(shippedJsonPath, "utf8"));
  assert.equal(j.counts.requests, 3);
});

// --- a separate run: no decisionLabels configured, no milestones, nothing linked -> no signal at all ------
test("no decision signal at all: says so plainly instead of printing a headline next to the full issue total", () => {
  const sources = JSON.parse(fs.readFileSync(K.sources, "utf8"));
  delete sources.issue.decisionLabels; // no owner configuration
  const noSourcesPath = path.join(tmp, "no-signal-pm");
  fs.mkdirSync(noSourcesPath, { recursive: true });
  fs.writeFileSync(path.join(noSourcesPath, "sources.json"), JSON.stringify(sources, null, 1));

  const noSignalGhFixture = {
    ...K.gh,
    searchPRs: [], // nothing merged -> nothing can be linked
    searchIssues: [
      { number: 970, title: "A plain request with no signal", body: "", createdAt: new Date().toISOString(), closedAt: null,
        state: "OPEN", stateReason: null, author: { login: "customer9" }, authorAssociation: "NONE", labels: { nodes: [] } },
      { number: 971, title: "Another plain request", body: "", createdAt: new Date().toISOString(), closedAt: null,
        state: "OPEN", stateReason: null, author: { login: "customer10" }, authorAssociation: "MEMBER", labels: { nodes: [{ name: "enhancement" }] } },
    ],
  };
  const noSignalGh = fakeGhSetup(noSignalGhFixture);
  const outPath = path.join(tmp, "no-signal-out.json");
  const shippedPath = path.join(tmp, "no-signal-shipped.json");
  const r = run(Script, [K.repo, K.issueRepo, "--day", "90", "--pm", noSourcesPath, "--json", outPath, "--shipped-json", shippedPath], { env: noSignalGh.env });
  assert.equal(r.code, 0, `unexpected exit code, stderr: ${r.error}`);
  assert.match(r.output, /no decision signal found/);
  const j = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.equal(j.summary.decision_count, 0, "no issue signals, so the denominator is 0, not the raw issue total (2)");
  assert.equal(j.decisions.length, 0);
  const shipped = JSON.parse(fs.readFileSync(shippedPath, "utf8"));
  assert.equal(shipped.counts.requests, 0);
  clean(noSignalGh.dir);
});
