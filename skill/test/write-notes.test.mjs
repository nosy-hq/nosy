// skill/tools/write-notes.mjs contract tests: --audience customer output has no commit hash and no author name,
// no chore(deps) item; --audience team output has refs; JSON type:"notes" and an items array.
// Fake product "Cargo": has chore(deps) commits (counted as dependency), has K12/§-referenced commits.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

let K, tmp;
before(async () => { K = await fakeProductSetup(); tmp = temporary("nosy-writenotes-"); });
after(() => { clean(K.root); clean(tmp); });

test("--audience customer: no commit hash, author name, or chore(deps) item", () => {
  const jsonPath = path.join(tmp, "customer.json");
  // "2020-01-01": fixed start date covering all commits (same pattern as collect-status.test.mjs).
  const r = run(path.join(Tool, "write-notes.mjs"), [K.pm, "2020-01-01", "origin/main", "--audience", "customer", "--json", jsonPath]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(j.type, "notes");
  assert.ok(Array.isArray(j.items));
  const allText = JSON.stringify(j.items);
  // Commit hashes (7-40 hex) and author names must never appear in the customer view.
  for (const c of K.commits) assert.ok(!allText.includes(c.hash), `commit hash (${c.hash}) must not appear in customer output`);
  for (const author of ["Alice Moore", "Ben Carter", "Cara Ellis"]) assert.ok(!allText.includes(author), `author name (${author}) must not appear in customer output`);
  assert.ok(!/chore\(deps\)/.test(allText), "customer output must not contain a chore(deps) item");
  assert.ok(!r.output.includes("chore(deps)"), "chore(deps) must not appear in the markdown output either");
});

test("the '(10 Sep, Alex): ' prefix on a decision heading is stripped for the customer audience; kept for team", () => {
  // decisions.md has a heading "## K12 (10 Sep, Alex): Moving shipment files..." (fixture text from
  // fake-product.mjs, which is outside this file's scope); commits referencing K12 inherit this heading.
  const customerPath = path.join(tmp, "customer-prefix.json");
  const rM = run(path.join(Tool, "write-notes.mjs"), [K.pm, "2020-01-01", "origin/main", "--audience", "customer", "--json", customerPath]);
  assert.equal(rM.code, 0, `stderr: ${rM.error}`);
  const jM = JSON.parse(fs.readFileSync(customerPath, "utf8"));
  const k12CustomerItem = jM.items.find(m => typeof m.title === "string" && /Moving shipment files/.test(m.title));
  assert.ok(k12CustomerItem, `K12 item not found in customer output: ${JSON.stringify(jM.items)}`);
  assert.ok(!/^\(?\d{1,2}\s+Sep/.test(k12CustomerItem.title), `date prefix must not remain in customer title: "${k12CustomerItem.title}"`);
  assert.ok(!/Alex/.test(k12CustomerItem.title), `name must not remain in customer title: "${k12CustomerItem.title}"`);
  assert.ok(!rM.output.includes("(10 Sep, Alex)"), "prefix must not appear in the customer markdown output either");

  const teamPath = path.join(tmp, "team-prefix.json");
  const rE = run(path.join(Tool, "write-notes.mjs"), [K.pm, "2020-01-01", "origin/main", "--audience", "team", "--json", teamPath]);
  assert.equal(rE.code, 0, `stderr: ${rE.error}`);
  const jE = JSON.parse(fs.readFileSync(teamPath, "utf8"));
  const k12TeamItem = jE.items.find(m => /Moving shipment files/.test(m.title || ""));
  assert.ok(k12TeamItem, `K12 item not found in team output: ${JSON.stringify(jE.items)}`);
  assert.match(k12TeamItem.title, /\(10 Sep, Alex\)/, "date/name prefix must be KEPT for the team audience");
});

test("--audience team: refs (K12, §22, etc.) appear in the output", () => {
  const jsonPath = path.join(tmp, "team.json");
  const r = run(path.join(Tool, "write-notes.mjs"), [K.pm, "2020-01-01", "origin/main", "--audience", "team", "--json", jsonPath]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(j.type, "notes");
  const refs = j.items.map(m => m.ref).filter(Boolean);
  assert.ok(refs.some(r2 => /^K12/.test(r2)), `expected a K12 ref in team output: ${JSON.stringify(refs)}`);
  assert.match(r.output, /K12/, "K12 ref should appear in the team markdown output");
});
