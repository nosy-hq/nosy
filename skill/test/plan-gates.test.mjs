// skill/tools/plan-gates.mjs contract test: which of the recently shipped feature fields
// are behind a plan gate, which aren't; no signal when the product has no billing trace; lowhanging's 7th
// signal reads from this file.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { areaFind } from "../tools/plan-gates.mjs";

const copies = [];
after(() => { for (const k of copies) clean(k); });

function productSetup(filesListOf) {
  const root = temporary("nosy-gate-"); copies.push(root);
  const repo = path.join(root, "repo"), pm = path.join(root, "pm");
  fs.mkdirSync(repo, { recursive: true }); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main"); git("config", "user.name", "T"); git("config", "user.email", "t@t.test");
  for (const [message, files] of filesListOf) {
    for (const [f, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), content); }
    git("add", "-A"); git("commit", "-q", "-m", message);
  }
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "main" }));
  return { repo, pm };
}

let U, R;
before(() => {
  U = productSetup([
    ["chore: skeleton", {
      "src/billing/stripe.ts": 'import Stripe from "stripe";\nexport const stripe = new Stripe(process.env.KEY);\n',
      "src/config/plans.ts": 'export const PLANS = { pro: { features: ["sso", "audit-log"] } };\n',
    }],
    ["feat(export): CSV export", { "src/features/export/ExportButton.tsx": 'export function ExportButton({ user }) {\n  if (!hasFeature(user, "export")) return null;\n  return "csv";\n}\n' }],
    ["feat: reports panel", { "src/features/reports/Panel.tsx": "export function Panel() { return 'report'; }\n" }],
    ["feat: chart on the reports panel", { "src/features/reports/Chart.tsx": "export function Chart() { return 'chart'; }\n" }],
    ["feat(sso): SSO login", { "src/features/sso/Sso.tsx": "export function Sso() { return 'sso'; }\n" }],
    ["feat: billing portal", { "src/billing/Portal.tsx": "export function Portal() { return 'portal'; }\n" }],
    ["fix: typo", { "src/features/reports/Panel.tsx": "export function Panel() { return 'report!'; }\n" }],
  ]);
  const json = path.join(U.pm, "state", "plan-gates.json");
  const r = run(path.join(Tool, "plan-gates.mjs"), [U.pm, "--json", json]);
  assert.equal(r.code, 0, r.error);
  R = JSON.parse(fs.readFileSync(json, "utf8"));
});

const fieldOf = name => R.fields.find(a => a.area === name);

test("billing trace and plan gate are found", () => {
  assert.equal(R.billing_missing, false);
  assert.ok(R.billing.includes("src/billing/stripe.ts"));
  assert.ok(R.gate_count >= 1);
  assert.ok(R.plan_files_of.includes("src/config/plans.ts"));
});

test("a field is gated when the gate is inside its own file (export)", () => {
  assert.equal(fieldOf("export")?.gated, true);
  assert.match(fieldOf("export").evidence, /ExportButton\.tsx:2/);
});

test("a field is gated when its name appears in a plan file (sso, the central plans.ts pattern)", () => {
  assert.equal(fieldOf("sso")?.gated, true);
  assert.match(fieldOf("sso").evidence, /plans\.ts/);
});

test("a gateless field counts two features; a fix commit doesn't count as a feature (reports)", () => {
  const a = fieldOf("reports");
  assert.equal(a?.gated, false);
  assert.equal(a.commit_count, 2);
  assert.equal(R.gateless, 1);
});

test("billing itself is infrastructure, no gate expected", () => {
  assert.equal(fieldOf("billing")?.infrastructure, true);
  assert.equal(fieldOf("reports")?.noScreen, undefined, "a field that touches a tsx file has a screen");
});

test("lowhanging's 7th signal: only a gateless, non-infrastructure field comes through", () => {
  const out = path.join(U.pm, "state", "lowhanging.json");
  const r = run(path.join(Tool, "lowhanging.mjs"), [U.pm, "--json", out]);
  assert.equal(r.code, 0, r.error);
  const m = JSON.parse(fs.readFileSync(out, "utf8")).items.filter(m => m.type === "Shipped, not tied to any plan");
  assert.deepEqual(m.map(x => x.title.split(" · ")[0]), ["reports"]);
  assert.equal(m[0].effort, "S");
});

test("no signal when there's no billing trace (no pricing yet can be a decision)", () => {
  const V = productSetup([["feat: reports panel", { "src/features/reports/Panel.tsx": "export const x = 1;\n" }]]);
  const json = path.join(V.pm, "state", "plan-gates.json");
  run(path.join(Tool, "plan-gates.mjs"), [V.pm, "--json", json]);
  const S = JSON.parse(fs.readFileSync(json, "utf8"));
  assert.equal(S.billing_missing, true);
  const out = path.join(V.pm, "state", "lowhanging.json");
  run(path.join(Tool, "lowhanging.mjs"), [V.pm, "--json", out]);
  assert.equal(JSON.parse(fs.readFileSync(out, "utf8")).items.length, 0);
});

test("areaFind: skips boilerplate folders, scope takes priority", () => {
  assert.equal(areaFind(["apps/web/src/features/invoices/List.tsx"]), "invoices");
  assert.equal(areaFind(["backend/orders.js"]), "orders");
  assert.equal(areaFind(["src/x/y.ts"], "Export"), "export");
  assert.equal(areaFind(["README.md", "src/foo.test.ts"]), null);
});

// a commit scoped by app name (feat(web): ...) falls into no area with plain scope-priority
// logic. When `appNames` says "web" is an app (a top dir under apps/), the scope is set aside and the area comes
// from the touched files instead — the app's own directory is also stripped from the candidate folders.
test("areaFind: an app-name scope is set aside for the file-derived area", () => {
  const appNames = new Set(["web", "backend"]);
  assert.equal(areaFind(["apps/web/src/features/tracking/List.tsx"], "web", appNames), "tracking");
  assert.equal(areaFind(["apps/web/src/features/tracking/List.tsx"], "web"), "web", "without appNames the scope still wins, unchanged behavior");
  assert.equal(areaFind(["src/x/y.ts"], "export", appNames), "export", "a scope that isn't a known app name still wins");
});

test("plan-gates: app-scoped commits are recovered into a real feature area from their files", () => {
  const P = productSetup([
    ["chore: skeleton", {
      "apps/web/package.json": "{}",
      "apps/backend/package.json": "{}",
      "src/billing/stripe.ts": 'import Stripe from "stripe";\nexport const stripe = new Stripe(process.env.KEY);\n',
    }],
    ["feat(web): tracking widget shipped", { "apps/web/src/features/tracking/Widget.tsx": "export function Widget() { return 'w'; }\n" }],
    ["feat(web): tracking widget polish", { "apps/web/src/features/tracking/Widget.tsx": "export function Widget() { return 'w2'; }\n" }],
  ]);
  const json = path.join(P.pm, "state", "plan-gates.json");
  const r = run(path.join(Tool, "plan-gates.mjs"), [P.pm, "--json", json]);
  assert.equal(r.code, 0, r.error);
  const S = JSON.parse(fs.readFileSync(json, "utf8"));
  const tracking = S.fields.find(a => a.area === "tracking");
  assert.ok(tracking, "recovered as its own field, not lumped under the app scope");
  assert.equal(tracking.commit_count, 2);
  assert.equal(S.fields.find(a => a.area === "web"), undefined, "the app-name scope itself isn't a field");
  assert.equal(S.app_scope_commits, 2);
  assert.equal(S.app_scope_recovered, 2);
});

// `requireFeature("ai_enabled")` guarding an `/agent-chat` route can't be word-matched to
// the "agent-chat" feature area (no shared stem) — tracing follows the same-line route registration instead.
test("plan-gates: gate tracing follows a same-line route to its area, separate from word matching", () => {
  const P = productSetup([
    ["chore: skeleton", {
      "src/billing/stripe.ts": 'import Stripe from "stripe";\nexport const stripe = new Stripe(process.env.KEY);\n',
      "src/server/routes.ts": 'router.post("/agent-chat/send", requireFeature("ai_enabled"), sendHandler);\n',
    }],
    ["feat: agent chat panel", { "src/features/agent-chat/Chat.tsx": "export function Chat() { return 'chat'; }\n" }],
  ]);
  const json = path.join(P.pm, "state", "plan-gates.json");
  const r = run(path.join(Tool, "plan-gates.mjs"), [P.pm, "--json", json]);
  assert.equal(r.code, 0, r.error);
  const S = JSON.parse(fs.readFileSync(json, "utf8"));
  const chat = S.fields.find(a => a.area === "agent-chat");
  assert.equal(chat?.gated, true);
  assert.equal(chat.gateKind, "traced");
  assert.match(chat.evidence, /routes\.ts:1/);
  assert.ok(S.traces.some(t => t.area === "agent-chat" && t.route === "/agent-chat/send"));
});
