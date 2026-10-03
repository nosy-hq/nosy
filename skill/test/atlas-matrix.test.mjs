// atlas-matrix.mjs: the candidate × axis matrix from pm/atlas/*.md. A candidate is ranked only when verified, not refused by the owner, and at
// least half of the axes are read from a source; every other case is listed with its reason. Made-up reports, no network, no model.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { parseReport, build, render, GRADES } from "../tools/atlas-matrix.mjs";

const MX = path.join(Tool, "atlas-matrix.mjs"), dirs = [], NOW = Date.parse("2026-10-03");
after(() => dirs.forEach(clean));

const AXES = ["Data access and licence", "Market", "Rival density", "Regulatory friction"];
// cells: [score, grade, date, basis]
function report(name, { cells, owner = "undecided", verified = "2026-10-03, how: second source", verification = "- Market size: second source read (https://b.example/x, 2026-10-03): agrees", readOn = "2026-10-02" } = {}) {
  return [
    `# ${name}`, "", `- **Candidate:** ${name}`, "- **Kind:** country", `- **Read on:** ${readOn}`, "- **Tools that worked:** search, fetch",
    `- **Owner decision:** ${owner}`, `- **Verified:** ${verified}`, "", "## Scores", "text before the table | with a pipe in it", "",
    "| Axis | Score | Grade | Date | Basis |", "|---|---|---|---|---|",
    ...AXES.map((a, i) => cells[i] ? `| ${a} | ${cells[i].join(" | ")} |` : `| ${a} | – | judgment | 2026-10-02 | not looked at |`), "",
    "## 1. Data", "text", "", "## Verification", verification, "", "## Sources", "- https://a.example",
  ].join("\n");
}
const read = (s, u) => [s, "read", "2026-10-02", `https://${u}.example/page`];
const good = o => report("Good", { cells: [read(5, "a"), read(4, "b"), read(4, "c"), read(3, "d")], ...o });
const parse = (text, slug = "x") => parseReport(text, `${slug}.md`);

test("parses the header, the score table and the verification section; template placeholders and the header row are skipped", () => {
  const r = parse(good());
  assert.equal(r.name, "Good");
  assert.deepEqual([r.decision, r.verifiedOn, r.verification, r.readOn], ["undecided", "2026-10-03", true, "2026-10-02"]);
  assert.equal(r.cells.length, 4);
  assert.deepEqual(r.cells[0], { axis: "Data access and licence", rawScore: "5", grade: "read", date: "2026-10-02", basis: "https://a.example/page" });
  const t = fs.readFileSync(path.join(Tool, "..", "templates", "market.md"), "utf8");
  const p = parseReport(t, "_t.md");
  assert.equal(p.cells.length, 0, "the template's placeholder rows are not scores");
  assert.equal(p.verification, false, "the template's placeholder verification text is not a verification");
  assert.equal(p.verifiedOn, null);
});

test("ranks a verified candidate by the plain mean of the read scores, best first, with what it rests on", () => {
  const hi = parse(good(), "hi"), lo = parse(report("Lower", { cells: [read(2, "a"), read(3, "b"), read(2, "c"), read(3, "d")] }), "lo");
  const m = build([lo, hi], { now: NOW });
  assert.deepEqual(m.ranked.map(r => [r.rank, r.candidate, r.score, r.read, r.of]), [[1, "Good", 4, 4, 4], [2, "Lower", 2.5, 4, 4]]);
  assert.deepEqual(m.axes, AXES);
  assert.match(render(m), /1\. Good: 4\.0 of 5 · 4 of 4 axes read from a source · verified 2026-10-03/);
});

test("not ranked, each with its reason: not verified, an empty verification, the owner said no, fewer than half of the axes read", () => {
  const a = parse(good({ verified: "none" }), "a"), b = parse(good({ verification: "" }), "b");
  const c = parse(good({ owner: "no (2 Oct, \"not this year\")" }), "c");
  const d = parse(report("Thin", { cells: [read(5, "a"), ["4", "snippet", "2026-10-02", "a search summary"], ["3", "unreadable", "2026-10-02", "403"], ["–", "judgment", "2026-10-02", "?"]] }), "d");
  const m = build([a, b, c, d], { now: NOW });
  assert.equal(m.ranked.length, 0);
  const why = Object.fromEntries(m.notRanked.map(n => [n.slug, n.why.join(" | ")]));
  assert.match(why.a, /not verified \(no Verified: date\)/);
  assert.match(why.b, /Verified: is dated, but ## Verification is empty/);
  assert.match(why.c, /the owner said no/);
  assert.match(why.d, /only 1 of 4 axes are graded read/);
  assert.match(render(m), /Nothing is ranked yet\./);
});

test("a verification is a bullet with a url: an italic note or prose without a source is not one", () => {
  for (const v of ["_Left empty by scout. Reserved for verify mode._", "Checked, all fine.", "- looked again, agrees"]) {
    const m = build([parse(good({ verification: v }))], { now: NOW });
    assert.match(m.notRanked[0].why.join(" "), /## Verification is empty/, v);
  }
});

test("only read scores count: snippet, unreadable, terms-unread and judgment never move the score", () => {
  const cells = [read(5, "a"), read(5, "b"), ["1", "snippet", "2026-10-02", "x"], ["1", "terms-unread", "2026-10-02", "the terms page returned 403"]];
  const m = build([parse(report("Mixed", { cells }))], { now: NOW });
  assert.equal(m.ranked[0].score, 5);
  assert.equal(m.ranked[0].read, 2);
  assert.ok(GRADES.includes("terms-unread"));
});

test("a read score without a url, a score outside 1-5, an unknown grade, no date and a future date are each a warning and don't count as read", () => {
  const cells = [["5", "read", "2026-10-02", "no link, just my say-so"], ["9", "read", "2026-10-02", "https://b.example/x"], ["3", "reliable", "2026-10-02", "https://c.example/x"], ["3", "read", "", "https://d.example/x"]];
  const c = build([parse(report("Bad", { cells }))], { now: NOW }).candidates[0];
  const w = c.warnings.join("\n");
  assert.match(w, /Data access and licence: graded read but the basis has no url/);
  assert.match(w, /Market: score "9" isn't 1-5 or –/);
  assert.match(w, /Rival density: unknown grade "reliable"/);
  assert.match(w, /Regulatory friction: no date/);
  assert.equal(c.read, 0);
  const future = build([parse(report("Fut", { cells: [["4", "read", "2026-12-01", "https://a.example/x"]] }))], { now: NOW }).candidates[0];
  assert.match(future.warnings.join("\n"), /dated in the future/);
});

test("a cell older than --days is stale (still counted, but named); the same url behind three axes is named; a missing axis is named", () => {
  const old = ["4", "read", "2026-05-01", "https://a.example/same"];
  const c = build([parse(report("Old", { cells: [old, ["4", "read", "2026-10-02", "https://a.example/same"], ["4", "read", "2026-10-02", "https://a.example/same"], read(4, "z")] }))], { now: NOW }).candidates[0];
  const w = c.warnings.join("\n");
  assert.match(w, /Data access and licence: stale, read 155 days ago \(older than 90\)/);
  assert.match(w, /one url backs 3 axes \(Data access and licence, Market, Rival density\): https:\/\/a\.example\/same/);
  assert.equal(c.read, 4, "stale is a warning, not a demotion");
  const other = parse(good().replace(/\| Regulatory friction[^\n]*\n/, "").replace("| Rival density |", "| Another axis |"), "o");
  const m = build([parse(good(), "g"), other], { now: NOW });
  assert.match(m.candidates[1].warnings.join("\n"), /missing 2 axes the other reports have: Rival density, Regulatory friction/);
});

test("the command: writes pm/state/frontier.json, exit 0 when clean, 2 when something needs a look, 1 with no reports", () => {
  const d = temporary("nosy-atlas-"); dirs.push(d);
  const pm = path.join(d, "pm");
  assert.equal(run(MX, [pm]).code, 1);
  assert.match(run(MX, [pm]).error, /no reports in .*atlas/);
  fs.mkdirSync(path.join(pm, "atlas"), { recursive: true });
  fs.writeFileSync(path.join(pm, "atlas", "good.md"), good());
  fs.writeFileSync(path.join(pm, "atlas", "_TEMPLATE.md"), fs.readFileSync(path.join(Tool, "..", "templates", "market.md"), "utf8"));
  fs.writeFileSync(path.join(pm, "atlas", "axes.md"), "# axes\n");
  const j = path.join(pm, "state", "frontier.json");
  const clean_ = run(MX, [pm, "--json", j, "--now", "2026-10-03"]);
  assert.equal(clean_.code, 0, clean_.error);
  const out = JSON.parse(fs.readFileSync(j, "utf8"));
  assert.equal(out.candidates.length, 1, "the template and axes.md are not candidates");
  assert.deepEqual(out.ranked.map(r => r.candidate), ["Good"]);
  assert.equal(out.generatedAt, "2026-10-03");
  fs.writeFileSync(path.join(pm, "atlas", "unchecked.md"), good({ verified: "none" }).replace("# Good", "# Unchecked"));
  const look = run(MX, [pm, "--now", "2026-10-03"]);
  assert.equal(look.code, 2);
  assert.match(look.output, /Not ranked yet\n- Unchecked: not verified/);
  assert.equal(run(MX, [pm, "--now", "bad"]).code, 1);
});
