// BlogFactory incident (4 Oct 2026): a commit author called "Claude" made the privacy scan stop every publish, because rival evidence says "Claude Code".
// The gate stays closed for real names and secrets; a public product or company name is let through as that whole name, and the way to say so is written
// next to the block, so no one has to reach for --allow-sensitive.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const dirs = [];
after(() => dirs.forEach(clean));
const J = JSON.stringify;
function product({ authors = [], rival = "Mercury CMS", evidence = "", summary = "", sources = {} } = {}) {
  const root = temporary("nosy-pubent-"); dirs.push(root);
  const pm = path.join(root, "pm"), put = (f, v) => { fs.mkdirSync(path.dirname(path.join(pm, f)), { recursive: true }); fs.writeFileSync(path.join(pm, f), typeof v === "string" ? v : J(v, null, 1)); };
  put("sources.json", { repo: ".", ref: "main", rivals: { r: { name: rival } }, ...sources });
  put("matrix.json", { update: "2026-10-04", codes: { y: "exists" }, steps: [{ no: "1", name: "Draft" }, { no: "2", name: "Review" }], biz: { name: "Us", codes: { 1: "y", 2: "y" } },
    products: [{ name: rival, file: "r.md", codes: { 1: { k: "y", evidence }, 2: { k: "n", evidence: "" } } }] });
  put("state/status.json", { generated: "2026-10-03T00:00:00Z", range: "r", main: 1, pr: 0, lastMain: "a", groups: [{ ref: "#1", n: 1, where: ["main"], who: authors, last: "09.30 10:00 AM" }], prs: [] });
  if (summary) put("summary.md", `## Summary\n${summary}\n`);
  return pm;
}
const dry = pm => run(path.join(Tool, "publish.mjs"), [pm, "--url", "http://127.0.0.1:9", "--dry-run", "--full"]);

test("a bot author called Claude does not stop a publish because rival evidence says Claude Code", () => {
  const r = dry(product({ authors: ["Claude"], evidence: "Works as a plugin for Claude Code and Claude Desktop." }));
  assert.equal(r.code, 0, `${r.output}${r.error}`);
});

test("a rival's own name is let through as a whole name; the bare word, outside it, still stops the publish", () => {
  const pass = dry(product({ authors: ["Mercury"], evidence: "Mercury CMS ships bulk export." }));
  assert.equal(pass.code, 0, `${pass.output}${pass.error}`);
  const stop = dry(product({ authors: ["Mercury"], evidence: "Mercury CMS ships bulk export.", summary: "Thanks Mercury for the fix, and to Mercury CMS." }));
  assert.equal(stop.code, 1, "a bare Mercury in the summary is still the person");
  assert.match(stop.output + stop.error, /name: Mercury \(a commit author\)/, "and the finding says where the name came from");
  assert.match(stop.output + stop.error, /privacy\.publicNames/, "the way out is written next to the block");
  assert.doesNotMatch(stop.error, /^$/);
});

test("sources.json privacy.publicNames: the owner names a public entity that is not a rival", () => {
  const without = dry(product({ authors: ["Mercury"], summary: "We integrate with Mercury Labs." }));
  assert.equal(without.code, 1);
  const withName = dry(product({ authors: ["Mercury"], summary: "We integrate with Mercury Labs.", sources: { privacy: { publicNames: ["Mercury Labs"] } } }));
  assert.equal(withName.code, 0, `${withName.output}${withName.error}`);
});

test("a public entity next to real personal data: the data still stops the publish", () => {
  const r = dry(product({ authors: ["Claude"], evidence: "Plugin for Claude Code.", summary: "Contact jane.doe.work@gmail.com about Claude Code." }));
  assert.equal(r.code, 1, "an e-mail address is blocked whatever else is let through");
  assert.match(r.output + r.error, /E-mail/);
});
