// psst: a request that already has an open pull request (anyone's, not only ours) is labelled "a PR is already open (#N)"
// and never ranks as cheap work to ship. A real run on a public repo listed such requests among the cheap work.
// Fictional product "Cargo" + fake gh.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";

let K, tmp;
before(async () => { K = await fakeProductSetup(); tmp = temporary("nosy-low-open-pr-"); });
after(() => { clean(K.root); clean(tmp); });

function psst(ghFixture, tag) {
  const gh = fakeGhSetup(ghFixture), j = path.join(tmp, `${tag}.json`);
  try {
    const r = run(path.join(Tool, "lowhanging.mjs"), [K.pm, "--json", j], { env: gh.env });
    assert.equal(r.code, 0, r.error);
    return { md: r.output, json: JSON.parse(fs.readFileSync(j, "utf8")) };
  } finally { clean(gh.dir); }
}
const withPr = pr => ({ ...K.gh, prListFull: [...K.gh.prListFull, pr] });

test("an issue named by 'Fixes #701' in someone else's open PR is labelled and scored 0", () => {
  const { json, md } = psst(withPr({ number: 700, title: "Bulk export", author: { login: "dev9" }, body: "Fixes #701", closingIssuesReferences: [], files: [], isDraft: false }), "body");
  const item = json.items.find(i => i.ref === "#701");
  assert.ok(item, "the issue is still listed");
  assert.match(item.type, /a PR is already open \(#700\)/);
  assert.equal(item.score, 0);
  assert.match(item.detail[0], /A PR is already open \(#700\)/);
  assert.match(md, /\| Issue opened against us · a PR is already open \(#700\) \|/);
  const ranked = json.items.filter(i => i.score > 0);
  assert.ok(ranked.length > 0 && json.items.indexOf(item) > json.items.indexOf(ranked[ranked.length - 1]), "ranked below every item with a score");
});

test("GitHub's own closing-issue reference counts, and so does a #N in the PR title", () => {
  const a = psst(withPr({ number: 720, title: "Add export", body: "", closingIssuesReferences: [{ number: 701 }], author: { login: "x" }, files: [] }), "closing");
  assert.match(a.json.items.find(i => i.ref === "#701").type, /a PR is already open \(#720\)/);
  const b = psst(withPr({ number: 721, title: "wip: csv export for #701", body: "", author: { login: "x" }, files: [] }), "title");
  assert.match(b.json.items.find(i => i.ref === "#701").type, /a PR is already open \(#721\)/);
});

test("without an open PR the same issue keeps its normal score and label", () => {
  const { json } = psst(K.gh, "none");
  const item = json.items.find(i => i.ref === "#701");
  assert.equal(item.type, "Issue opened against us");
  assert.ok(item.score > 0);
});

test("a PR that only mentions a number in its body (no closing word) does not hide the issue", () => {
  const { json } = psst(withPr({ number: 703, title: "Refactor", body: "Related to #701, not a fix.", closingIssuesReferences: [], author: { login: "x" }, files: [] }), "mention");
  assert.equal(json.items.find(i => i.ref === "#701").type, "Issue opened against us");
});
