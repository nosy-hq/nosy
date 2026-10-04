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

// BlogFactory field test (3 Oct 2026): sentences about how things are ("Production runs the Hono app with Bun", "This repository is the canonical
// shared core") cite the code like notes do, and came out as the team's next list, then in psst, the handoff and the weekly message.
test("a statement of what is, in a file nobody named as the list, is not a next step; in a file the owner named it is kept", () => {
  const { root, pm } = repo();
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: "2026-09-17T11:00:00Z", GIT_COMMITTER_DATE: "2026-09-17T11:00:00Z" };
  fs.appendFileSync(path.join(root, "docs/NOTES.md"), "\nProduction runs the API in `apps/api/turn.go` on one process.\n\nThis repository holds the shared core in `apps/web/chat.tsx`.\n");
  for (const a of [["add", "."], ["commit", "-qm", "describe"]]) execFileSync("git", ["-C", root, ...a], { stdio: "ignore", env });
  const auto = teamNext(pm);
  const titles = auto.items.map(i => i.title);
  assert.ok(!titles.some(t => /Production runs/.test(t)) && !titles.some(t => /This repository holds/.test(t)), titles.join(" | "));
  assert.deepEqual(auto.items.map(i => i.title).sort(), ["Pass the reject note", "Wire the matter link."], "the real steps are still there");
  assert.equal(auto.skippedDeclarative, 2, "and the skipped ones are counted, not hidden");
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main", preread: { decisions: "DECISIONS.md" }, refs: ["\\bK\\d+\\b"], next: { path: "docs/NOTES.md" } }));
  const named = teamNext(pm);
  assert.ok(named.items.some(i => /Production runs/.test(i.title)), "the owner named the file: nothing is filtered");
});

test("find-sources: an architecture page edited often and citing the code on every line is not proposed as the team's notes, and says why", () => {
  const root = temporary("nosy-teamnext-arch-"); dirs.push(root);
  const date = i => `2026-09-${String(10 + i).padStart(2, "0")}T10:00:00Z`;
  const at = (d, ...a) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d } });
  const put = (f, body) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), body); };
  at(date(0), "init", "-q", "-b", "main");
  for (const f of ["a", "b", "c", "d", "e", "f"]) put(`src/${f}.ts`, "export {}\n");
  put("docs/architecture.md", "# Architecture\n");
  at(date(0), "add", "."); at(date(0), "commit", "-qm", "init");
  const facts = ["Production runs the Hono app in `src/a.ts` with Bun.", "The queue worker lives in `src/b.ts` and reads one table.", "This repository is the shared core; the adapters sit in `src/c.ts`.",
    "Sessions are stored by `src/d.ts` in a signed cookie.", "The scheduler in `src/e.ts` ticks once a minute.", "Static files are served from `src/f.ts`."];
  facts.forEach((t, i) => { fs.appendFileSync(path.join(root, "docs/architecture.md"), `\n${t}\n`); at(date(i + 1), "add", "."); at(date(i + 1), "commit", "-qm", `arch ${i}`); });
  const F = findNextDocs(root, "main", { day: 30 });
  assert.deepEqual(F.files, [], "no working notes proposed");
  assert.equal(F.rejected[0].file, "docs/architecture.md"); assert.match(F.rejected[0].why, /how things are/); assert.equal(F.rejected[0].actionable, 0);
  // the same shape of file with real steps in it is proposed
  const steps = ["**Wire the queue.** `src/b.ts` needs a retry.", "- [ ] Move `src/a.ts` off the old runtime.", "**Fix the cookie** in `src/d.ts` (K4).", "Next: split `src/e.ts`.", "- [ ] Cache `src/f.ts` responses.", "**Add** a health check to `src/c.ts`."];
  put("docs/NOTES.md", "# Notes\n"); at(date(8), "add", "."); at(date(8), "commit", "-qm", "notes");
  steps.forEach((t, i) => { fs.appendFileSync(path.join(root, "docs/NOTES.md"), `\n${t}\n`); at(date(9 + i), "add", "."); at(date(9 + i), "commit", "-qm", `notes ${i}`); });
  const G = findNextDocs(root, "main", { day: 30 });
  assert.deepEqual(G.files, ["docs/NOTES.md"]); assert.ok(G.candidates[0].actionable >= 3);
});
