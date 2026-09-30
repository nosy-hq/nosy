// team-next.mjs: the team's own working notes as psst's signal 10, found by structure.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { teamNext, findNextDocs } from "../tools/team-next.mjs";
import { temporary, clean } from "./helpers.mjs";

const dirs = [];
after(() => dirs.forEach(clean));

function repo() {
  const root = temporary("nosy-teamnext-"); dirs.push(root);
  const at = (d, ...a) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d } });
  const put = (f, body) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), body); };
  at("2026-08-01T10:00:00Z", "init", "-q", "-b", "main");
  put("apps/api/turn.go", "package api\n"); put("apps/web/chat.tsx", "export {}\n");
  put("docs/NOTES.md", "# Notes\n\nOld paragraph citing `apps/api/turn.go` from August.\n");
  put("site/guide.mdx", "---\ntitle: Guide\n---\n\nUse `apps/web/chat.tsx` in your app.\n");
  put("DECISIONS.md", "# Decisions\n\n## K1 — x\n\nSee `apps/api/turn.go`.\n");
  at("2026-08-01T10:00:00Z", "add", "."); at("2026-08-01T10:00:00Z", "commit", "-qm", "init");
  // Six September edits to the notes, seven to the docs page and the decision log (which must not be picked).
  for (let i = 0; i < 7; i++) {
    const d = `2026-09-${String(10 + i).padStart(2, "0")}T10:00:00Z`;
    if (i < 6) fs.appendFileSync(path.join(root, "docs/NOTES.md"), [
      "\n**Wire the matter link.** The screen never sends `matter_id`; `apps/web/chat.tsx` needs one `<Link>`.\n",
      "\n| status | done |\n|---|---|\n| x | `apps/api/turn.go` |\n",
      "\n~~**Delete the old route.** `apps/api/turn.go` done.~~\n",
      "\nPlain prose without any code citation at all.\n",
      "\n- **Pass the reject note** to `apps/api/turn.go:12` (K1).\n",
      "\n",
    ][i]);
    fs.appendFileSync(path.join(root, "site/guide.mdx"), `\nMore about \`apps/web/chat.tsx\` ${i}.\n`);
    fs.appendFileSync(path.join(root, "DECISIONS.md"), `\n## K${i + 2} — y\n\n\`apps/api/turn.go\`\n`);
    at(d, "add", "."); at(d, "commit", "-qm", `edit ${i}`);
  }
  const pm = path.join(root, "pm"); fs.mkdirSync(pm);
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main", preread: { decisions: "DECISIONS.md" }, refs: ["\\bK\\d+\\b"] }));
  return { root, pm };
}

test("finds the working notes by structure: not the decision log, not a docs page with frontmatter", () => {
  const { root } = repo();
  const F = findNextDocs(root, "main", { own: ["DECISIONS.md"] });
  assert.deepEqual(F.files, ["docs/NOTES.md"]);
  assert.match(F.found, /^auto \(confirm with the owner\): docs\/NOTES\.md edited in 6 commits/);
});

test("items: recent paragraphs and list items that cite the code; tables, struck-through and uncited ones skipped", () => {
  const { pm } = repo();
  const R = teamNext(pm);
  assert.deepEqual(R.items.map(i => i.title).sort(), ["Pass the reject note", "Wire the matter link."]);
  const reject = R.items.find(i => /reject/.test(i.title));
  assert.deepEqual(reject.refs, ["K1"]);
  assert.ok(reject.cited.includes("apps/api/turn.go:12"));
  assert.ok(!R.items.some(i => /Old paragraph/.test(i.text)), "an August paragraph is outside the 14 days before the ref");
});

test("today is the ref's date: on an old commit only that commit's past counts", () => {
  const { root, pm } = repo();
  const early = execFileSync("git", ["-C", root, "rev-list", "-1", "--before=2026-09-12T12:00:00Z", "main"], { encoding: "utf8" }).trim();
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: early, preread: { decisions: "DECISIONS.md" }, next: { path: "docs/NOTES.md" } }));
  const R = teamNext(pm);
  assert.equal(R.found, "sources.json");
  assert.deepEqual(R.items.map(i => i.title), ["Wire the matter link."], "later notes don't exist yet at that commit");
});

test("no working notes: says so, empty list", () => {
  const root = temporary("nosy-teamnext-none-"); dirs.push(root);
  execFileSync("git", ["-C", root, "init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(root, "a.txt"), "x");
  execFileSync("git", ["-C", root, "add", "."]); execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"]);
  const pm = path.join(root, "pm"); fs.mkdirSync(pm); fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main" }));
  const R = teamNext(pm);
  assert.equal(R.items.length, 0);
  assert.match(R.note, /no working notes found/);
});
