// Contract test for skill/tools/frontyard.mjs (frontyard): shipped feature ↔ landing page.
// Page lives in the repo (README) or an HTML copy an agent fetched; surface names, shipped-after-the-page items,
// internal-only work, claims with no trace in code, promise phrases, price ↔ gate.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { commitArea, pageTextOf } from "../tools/frontyard.mjs";

let root, repo, pm, R;
const tara = (extra = []) => { const j = path.join(pm, "state", "frontyard.json"); const r = run(path.join(Tool, "frontyard.mjs"), [pm, ...extra, "--json", j]); assert.equal(r.code, 0, r.error); return { md: r.output, R: JSON.parse(fs.readFileSync(j, "utf8")) }; };

before(() => {
  root = temporary("nosy-frontyard-"); repo = path.join(root, "repo"); pm = path.join(root, "pm");
  fs.mkdirSync(repo, { recursive: true }); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  const git = (a, env = {}) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env: { ...process.env, ...env } });
  git(["init", "-q", "-b", "main"]); git(["config", "user.name", "T"]); git(["config", "user.email", "t@t.test"]);
  let hour = 0;
  const commit = (message, files) => {
    for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), c); }
    const t = new Date(Date.now() - (10 - hour++) * 3600e3).toISOString();
    git(["add", "-A"]); git(["commit", "-q", "-m", message], { GIT_AUTHOR_DATE: t, GIT_COMMITTER_DATE: t });
  };
  commit("feat(export): CSV export", { "commands/export.md": "# export\n", "src/export/Export.tsx": "export const csv = () => 'report';\n" });
  commit("docs: README", { "README.md": "# Acme\n\n- `/acme:export` — CSV export of your data\n- Team invites: coming soon\n- Magical teleportation across galaxies\n" });
  commit("feat(reports): scheduled report emails", { "src/reports/Schedule.tsx": "export const schedule = 'weekly';\n" });
  commit("feat(share): public share links", { "commands/share.md": "# share\n", "src/share/Share.tsx": "export const share = 1;\n" });
  commit("export: XLSX as well", { "commands/export.md": "# export\nxlsx\n" });
  commit("lowhanging: internal ranking tweak", { "lib/rank.js": "export const r = 1;\n" });
  commit("refactor: tidy", { "lib/rank.js": "export const r = 2;\n" });
  commit("chore: pricing page", { "web/pricing.html": "<html><body><h1>Pricing</h1><ul><li>Pro: Reports</li></ul><script>var x='share'</script></body></html>" });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "main", frontyard: { path: "README.md", day: 30, price: "web/pricing.html", surface: [{ glob: "commands/*.md" }] } }));
  fs.writeFileSync(path.join(pm, "state", "plan-gates.json"), JSON.stringify({ fields: [{ area: "reports", gated: false }, { area: "export", gated: true, evidence: "src/billing/gates.ts:4" }] }));
  ({ R } = tara());
});
after(() => clean(root));

const fieldOf = a => R.fields.find(x => x.area === a), yz = a => R.surface.find(x => x.name === a);

test("page is read from the repo, with its last-change time", () => {
  assert.equal(R.source.type, "repo");
  assert.match(R.source.last_change, /^\d{4}-\d\d-\d\dT/);
});

test("surface: a command whose name isn't on the page is found; one that is is seen changing again after the page", () => {
  assert.equal(yz("share").page, false);
  assert.equal(yz("export").page, true);
  assert.ok(yz("export").page_after?.some(c => /XLSX/.test(c.text)));
});

test("shipped, not on the page: visible fields that shipped after the page", () => {
  assert.equal(fieldOf("reports").status, "missing");
  assert.equal(fieldOf("reports").page_after, true);
  assert.equal(fieldOf("share").status, "missing");
  assert.equal(fieldOf("export").status, "page");
});

test("internal work doesn't count as visible; a maintenance commit never counts", () => {
  assert.equal(fieldOf("lowhanging").visible, false);
  assert.ok(!R.fields.some(a => a.example.some(c => /tidy/.test(c.text))));
  assert.equal(R.summary.missing, 2);
});

test("on the page, no trace in code; a 'coming soon' phrase is listed separately", () => {
  assert.ok(R.claims.some(x => /teleportation/.test(x.line)));
  assert.ok(!R.claims.some(x => /export/i.test(x.line)), "export exists in code, shouldn't count as a claim");
  assert.ok(R.phrases.some(s => /coming soon/.test(s)));
});

test("pricing page ↔ code gates", () => {
  assert.deepEqual(R.price.code_gated_page_missing.map(a => a.area), ["export"]);
  assert.deepEqual(R.price.page_exists_code_gateless.map(a => a.area), ["reports"]);
});

test("page file (--page): HTML is stripped, script content doesn't count", () => {
  const f = path.join(root, "page.html");
  fs.writeFileSync(f, "<html><head><style>.share{}</style></head><body><h2>Reports</h2><p>Weekly scheduled emails &amp; more</p><script>share()</script></body></html>");
  const { R: S } = tara(["--page", f]);
  assert.equal(S.source.type, "file");
  assert.equal(S.fields.find(a => a.area === "reports").status, "page");
  assert.equal(S.surface.find(a => a.name === "share").page, false, "text inside script/style tags isn't page text");
});

test("says so when no page is configured", () => {
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "main", frontyard: { url: "https://acme.example" } }));
  const { md, R: S } = tara();
  assert.equal(S.page_missing, true);
  assert.match(md, /acme\.example/);
});

test("commitArea: scope, short prefix, numeric prefix, root folder", () => {
  assert.equal(commitArea("feat(billing): x").area, "billing");
  assert.equal(commitArea("psst: new signal").area, "psst");
  assert.equal(commitArea("plugin 0.9.0: tour").area, null);
  assert.equal(commitArea("ref area and threshold", ["skill/tools/a.mjs"]).area, null);
  assert.equal(commitArea("feat: panel", ["apps/web/src/features/invoices/List.tsx"]).area, "invoices");
  assert.match(pageTextOf("<p>a&amp;b</p><script>x</script>", "x.html"), /a&b/);
});

test("Turkish commit ↔ English page, via the glossary; an unexplained feature is still 'missing'", () => {
  const k2 = temporary("nosy-frontyard-dil-"), r2 = path.join(k2, "repo"), p2 = path.join(k2, "pm");
  try {
    fs.mkdirSync(r2, { recursive: true }); fs.mkdirSync(path.join(p2, "state"), { recursive: true });
    const g = a => execFileSync("git", ["-C", r2, ...a], { encoding: "utf8" });
    g(["init", "-q", "-b", "main"]); g(["config", "user.name", "T"]); g(["config", "user.email", "t@t.test"]);
    const c = (m, f) => { for (const [a, b] of Object.entries(f)) { fs.mkdirSync(path.dirname(path.join(r2, a)), { recursive: true }); fs.writeFileSync(path.join(r2, a), b); } g(["add", "-A"]); g(["commit", "-q", "-m", m]); };
    c("docs: sayfa", { "README.md": "# Acme\n\n- Warns you when your inputs are stale.\n- `/acme:ask` answers questions.\n" });
    c("feat(tazelik): bayat girdi uyarısı", { "src/tazelik/Uyari.tsx": "export const u = 1;\n" });
    c("feat(defter): ask geçmişi hafızada tutulur", { "src/defter/Liste.tsx": "export const d = 1;\n" });
    fs.writeFileSync(path.join(p2, "sources.json"), JSON.stringify({ repo: r2, ref: "main", frontyard: { path: "README.md", surface: [{ glob: "commands/*.md" }] }, glossary: { geçmiş: ["history"] } }));
    fs.mkdirSync(path.join(r2, "commands")); fs.writeFileSync(path.join(r2, "commands", "ask.md"), "# ask\n"); g(["add", "-A"]); g(["commit", "-q", "-m", "chore: ask komutu"]);
    const j = path.join(p2, "state", "v.json");
    const r = run(path.join(Tool, "frontyard.mjs"), [p2, "--json", j]); assert.equal(r.code, 0, r.error);
    const S = JSON.parse(fs.readFileSync(j, "utf8"));
    assert.equal(S.fields.find(a => a.area === "tazelik").status, "page", "tazelik (freshness) → stale");
    const d = S.fields.find(a => a.area === "defter");
    assert.notEqual(d.status, "page", "only the command name (ask) appears; history/memory was never described");
    assert.ok(!d.matching.includes("ask"), "a surface name doesn't count as evidence");
  } finally { clean(k2); }
});

test("translations (TR↔EN glossary, Turkish-language support): bidirectional, empty for an unrelated word", async () => {
  const { translations } = await import("../tools/frontyard.mjs");
  assert.deepEqual(translations("karar"), ["decision"]);
  assert.ok(translations("stale").includes("tazelik"));
  assert.deepEqual(translations("zzzz"), []);
});

test("rival footing — is our edge, or table stakes, on the page; a rival's own page spotlight comes first", () => {
  const k3 = temporary("nosy-frontyard-rival-"), r3 = path.join(k3, "repo"), p3 = path.join(k3, "pm");
  try {
    fs.mkdirSync(r3, { recursive: true }); fs.mkdirSync(path.join(p3, "rivals"), { recursive: true }); fs.mkdirSync(path.join(p3, "state"));
    const g = a => execFileSync("git", ["-C", r3, ...a], { encoding: "utf8" });
    g(["init", "-q", "-b", "main"]); g(["config", "user.name", "T"]); g(["config", "user.email", "t@t.test"]);
    fs.writeFileSync(path.join(r3, "README.md"), "# Acme\n\nExport your data to CSV.\n"); g(["add", "-A"]); g(["commit", "-q", "-m", "docs: page"]);
    const rival = (name, codes, oneThatOutputs = "") => `# ${name}\n\n- **Status:** active\n\n| # | Step | Code | Evidence |\n|---|---|---|---|\n${codes.map((k, i) => `| ${i + 1} | x | ${k} | (27 Sep) |`).join("\n")}\n${oneThatOutputs}`;
    fs.writeFileSync(path.join(p3, "rivals", "a.md"), rival("Alfa", ["n", "y", "y"], "\n## Featured on the landing page\n- [2] Real-time dashboards (https://alfa.example, 27 Sep)\n"));
    fs.writeFileSync(path.join(p3, "rivals", "b.md"), rival("Beta", ["n", "y", "y"]));
    // Step 3's name is kept in Turkish on purpose: it exercises frontyard's TR↔EN glossary (internal request
    // 68), matching a Turkish matrix step name against the English word "Export" on the page.
    fs.writeFileSync(path.join(p3, "matrix.json"), JSON.stringify({ steps: [{ no: "1", name: "Calendar sync" }, { no: "2", name: "Real-time dashboards" }, { no: "3", name: "Dışa aktarma" }],
      biz: { name: "Acme", codes: { 1: "y", 2: "y", 3: "y" }, notes: {} },
      products: ["Alfa", "Beta"].map(name => ({ name, codes: { 1: { k: "n" }, 2: { k: "y" }, 3: { k: "y" } } })) }));
    fs.writeFileSync(path.join(p3, "sources.json"), JSON.stringify({ repo: r3, ref: "main", matrix: path.join(p3, "matrix.json"), frontyard: { path: "README.md" } }));
    const j = path.join(p3, "state", "v.json"), r = run(path.join(Tool, "frontyard.mjs"), [p3, "--json", j]); assert.equal(r.code, 0, r.error);
    const S = JSON.parse(fs.readFileSync(j, "utf8")), name = no => S.rival.steps.find(a => a.no === no);
    assert.equal(name("1").type, "distinguish"); assert.equal(name("1").status, "missing", "calendar sync: we have it, rivals don't, not on the page");
    assert.equal(name("2").type, "desk"); assert.equal(name("2").status, "missing");
    assert.deepEqual(name("2").one_extractor.map(x => x.rival), ["Alfa"]);
    assert.equal(S.rival.steps[0].no, "2", "the step a rival's own page spotlights comes first");
    assert.equal(name("3").status, "page", "dışa aktarma (export) → export");
    assert.match(r.output, /Your edge isn't on the page/); assert.match(r.output, /Table stakes, not on the page/);
  } finally { clean(k3); }
});

test("English synonyms bridge differently worded English steps and pages", async () => {
  const { synonyms } = await import("../tools/frontyard.mjs");
  const { root } = await import("../tools/text.mjs");
  assert.ok(synonyms(root("delivery")).includes("shipped"));
  assert.ok(synonyms(root("suggestion")).includes("suggests"));
  assert.ok(synonyms(root("citing")).includes("receipt"));
  assert.deepEqual(synonyms("zzzz"), []);
});

test("an Astro page's frontmatter and imports are code, not page copy (no 'Waitlist' promise from an import line)", async () => {
  const { pageTextOf } = await import("../tools/frontyard.mjs");
  const t = pageTextOf("---\nimport Waitlist from '../components/Waitlist.astro';\nconst title = 'x';\n---\n<main><h1>Ship faster</h1><Waitlist /></main>\n", "src/pages/index.astro");
  assert.doesNotMatch(t, /import|Waitlist from|const title/);
  assert.match(t, /Ship faster/);
});
