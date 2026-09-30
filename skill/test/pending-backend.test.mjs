// pending-backend.mjs: "screen built, waiting for the backend", psst's other direction.
// A temp repo with a placeholder component, an orphan call, a mock import, and the false positives the first product taught us.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pending, formatMd } from "../tools/pending-backend.mjs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";

const dirs = [];
after(() => dirs.forEach(clean));

const FILES = {
  "web/src/shared/ui/pending-backend.tsx": "export function PendingBackend({ label, need }) { return null; }\n",
  // A runtime state, not unbuilt work: must not count as a marker (the first product's first false positive).
  "web/src/entities/conn/ui/next-step.tsx": "export function NotReadyNextStep({ c }) { return null; }\nexport const X = () => <NotReadyNextStep c={1} />;\nexport const Y = () => <NotReadyNextStep c={2} />;\n",
  "web/src/widgets/report/ui/panel.tsx": [
    'import { PendingBackend } from "@shared/ui/pending-backend";',
    "export function Panel() {",
    "  return (<div>",
    "    <PendingBackend",
    '      label="Vergleich mit dem Vorzeitraum"',
    '      need="Vorzeitraum im Preview (BACKEND-NEEDS §28)."',
    '      size="tag"',
    "    />",
    '    <PendingBackend label="週次フィルター" need="集計 (§28)" />',
    "  </div>);",
    "}",
  ].join("\n") + "\n",
  "web/src/widgets/team/ui/users.tsx": 'import { PendingBackend } from "@shared/ui/pending-backend";\nexport const U = ({ t }) => <PendingBackend label={t} />;\n',
  "web/src/features/export/api.ts": 'export const run = () => client.GET("/api/v1/exports/{id}/csv");\nexport const ok = () => client.GET("/api/v1/records");\n',
  "web/src/features/auth/session.ts": 'export const s = () => fetch("/api/session");\n',
  "web/src/_app/api-routes/session.ts": "export default function handler() {}\n",
  "web/src/features/billing/ui/plans.tsx": 'import plans from "../mocks/plans.json";\nexport const P = () => plans;\n',
  "web/src/features/billing/mocks/plans.json": "[]\n",
  "web/src/features/billing/ui/plans.test.tsx": 'import plans from "../mocks/plans.json";\n',
  // Storybook scaffolding (Twenty: testing/decorators/*.tsx importing mock data) isn't a screen.
  "web/src/testing/decorators/PageDecorator.tsx": 'import { mockUser } from "~/testing/mock-data/users";\nexport const PageDecorator = () => mockUser;\n',
};

function product() {
  const root = temporary("nosy-pending-"); dirs.push(root);
  for (const [f, body] of Object.entries(FILES)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), body); }
  for (const a of [["init", "-q", "-b", "main"], ["add", "."], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]]) execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
  const pm = path.join(root, "pm"); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main", inventory: { frontend: ["web/src"], backend: ["api"] } }));
  fs.writeFileSync(path.join(pm, "state", "inventory.json"), JSON.stringify({ endpoints: [{ method: "GET", path: "/api/v1/records" }] }));
  return pm;
}

test("markers: every use of a placeholder component is a waiting screen, props carried as-is in any language", () => {
  const R = pending(product());
  assert.deepEqual(R.markers.map(m => m.name), ["PendingBackend"], "NotReadyNextStep is a runtime state, not a marker");
  const m = R.items.filter(i => i.kind === "marker");
  assert.deepEqual(m.map(i => i.title), ["Vergleich mit dem Vorzeitraum", "週次フィルター", "team/ui (label set at runtime)"]);
  assert.equal(m[0].ref, "§28");
  assert.equal(m[0].evidence, "web/src/widgets/report/ui/panel.tsx:4");
  assert.deepEqual(m[0].detail, ["need: Vorzeitraum im Preview (BACKEND-NEEDS §28)."], "size=\"tag\" is styling, not detail");
});

test("calls with no endpoint: explicit API calls only; the frontend's own route handlers don't count", () => {
  const R = pending(product());
  assert.deepEqual(R.items.filter(i => i.kind === "call").map(i => i.title), ["GET /exports/*/csv"]);
  const pm = product(); fs.rmSync(path.join(pm, "state", "inventory.json"));
  const R2 = pending(pm);
  assert.equal(R2.items.filter(i => i.kind === "call").length, 0);
  assert.match(R2.notes.join(" "), /inventory\.json/, "without an inventory it says so instead of guessing");
});

test("mock data: a screen importing fixtures counts, a test file doesn't", () => {
  const R = pending(product());
  assert.deepEqual(R.items.filter(i => i.kind === "mock").map(i => i.evidence), ["web/src/features/billing/ui/plans.tsx:1"]);
  assert.match(formatMd(R), /## Waiting screens \(3\)[\s\S]*## Calls with no endpoint \(1\)[\s\S]*## Screens on mock data \(1\)/);
});

test("a marker named in sources.json counts even when used once and not matched by the name rule", () => {
  const pm = product();
  const K = JSON.parse(fs.readFileSync(path.join(pm, "sources.json"), "utf8"));
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ ...K, pending: { markers: ["NotReadyNextStep"] } }));
  assert.ok(pending(pm).markers.some(m => m.name === "NotReadyNextStep" && m.source === "sources.json"));
});

test("psst signal 9: screens naming the same request are one item, ranked with the work that ships", async () => {
  const K = await fakeProductSetup(); dirs.push(K.root);
  const gh = fakeGhSetup(K.gh); dirs.push(gh.dir);
  fs.mkdirSync(path.join(K.pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(K.pm, "state", "pending.json"), JSON.stringify({ items: [
    { kind: "marker", title: "Compare to last period", ref: "§28", evidence: "web/a.tsx:4", detail: ["need: previous period (§28)"] },
    { kind: "marker", title: "Weekly filter", ref: "§28", evidence: "web/b.tsx:9", detail: [] },
    { kind: "mock", title: "ui/plans.tsx", evidence: "web/plans.tsx:1", detail: [] },
  ] }));
  const out = path.join(K.pm, "state", "lowhanging.json");
  const r = run(path.join(Tool, "lowhanging.mjs"), [K.pm, "--json", out], { env: gh.env });
  assert.equal(r.code, 0, r.error);
  const items = JSON.parse(fs.readFileSync(out, "utf8")).items;
  const w = items.filter(i => i.type === "Screen built, waiting for backend");
  assert.equal(w.length, 1);
  assert.equal(w[0].title, "§28 · Compare to last period · Weekly filter");
  assert.equal(w[0].score, 3);
  const top = items.filter(i => i.score === 3 && !i.demand);
  assert.equal(top[0].type, "Screen built, waiting for backend", "first among equal-score, no-demand items");
  assert.ok(items.some(i => i.type === "Screen on mock data"));
});
