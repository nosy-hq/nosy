// skill/tools/scan-metrics.mjs contract test: do the product's key steps (AARRR) fire an event in the code,
// is the North Star fed; events in test files don't count; lowhanging's 8th signal reads from this file.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { Steps, eventNameOf } from "../tools/scan-metrics.mjs";

const copies = [];
after(() => { for (const k of copies) clean(k); });

function productSetup(files, extra = {}) {
  const root = temporary("nosy-metrics-"); copies.push(root);
  const repo = path.join(root, "repo"), pm = path.join(root, "pm");
  fs.mkdirSync(repo, { recursive: true }); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main"); git("config", "user.name", "T"); git("config", "user.email", "t@t.test");
  for (const [f, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), content); }
  git("add", "-A"); git("commit", "-q", "-m", "first");
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "main", ...extra }));
  return { repo, pm };
}
const scan = U => {
  const json = path.join(U.pm, "state", "metrics.json");
  const r = run(path.join(Tool, "scan-metrics.mjs"), [U.pm, "--json", json]);
  assert.equal(r.code, 0, r.error);
  return JSON.parse(fs.readFileSync(json, "utf8"));
};

let U, R;
before(() => {
  U = productSetup({
    "package.json": '{"dependencies":{"posthog-js":"1.0.0"}}\n',
    "src/pages/signup.tsx": 'export function Signup() {\n  posthog.capture("user_signed_up", { plan });\n}\n',
    "src/pages/onboarding/Welcome.tsx": "export function Welcome() { return 'welcome'; }\n",
    "src/api/checkout.ts": 'export async function checkout(userId) {\n  analytics.track({\n    userId,\n    event: "Order Completed",\n  });\n}\n',
    "src/invite/InviteForm.tsx": "export function InviteForm() { return 'invite'; }\n",
    "src/settings/cancel-subscription.tsx": "export function Cancel() {\n  track(EVENTS.CANCEL_SUBSCRIPTION);\n}\n",
    "src/lib/track.test.ts": 'posthog.capture("fake_invite_sent");\n',
  }, { metrics: { northStar: { name: "Weekly reports sent", pattern: "report.?sent" } } });
  R = scan(U);
});

const step = id => R.steps.find(a => a.id === id);

test("events and tool are found; event in test file doesn't count", () => {
  const names = R.events.map(o => o.name);
  assert.ok(names.includes("user_signed_up"));
  assert.ok(names.includes("Order Completed"), "multi-line `event:` field should be read");
  assert.ok(names.includes("EVENTS.CANCEL_SUBSCRIPTION"), "should be read by the event constant's name");
  assert.ok(!names.includes("fake_invite_sent"));
  assert.ok(R.tools.includes("PostHog"));
});

test("status of steps present in the product is correct", () => {
  assert.equal(step("record").status, "measured");
  assert.equal(step("revenue").status, "measured");
  assert.equal(step("cancel").status, "measured");
  assert.equal(step("activation").status, "notMeasured");
  assert.match(step("activation").inProduct, /onboarding/);
  assert.equal(step("invite").status, "notMeasured");
  assert.equal(R.unmeasured, 2);
});

test("North Star defined but not fed", () => {
  assert.equal(R.northStar.defined, true);
  assert.equal(R.northStar.measured, false);
});

test("lowhanging signal 8: unmeasured steps and North Star", () => {
  const out = path.join(U.pm, "state", "lowhanging.json");
  const r = run(path.join(Tool, "lowhanging.mjs"), [U.pm, "--json", out]);
  assert.equal(r.code, 0, r.error);
  const M = JSON.parse(fs.readFileSync(out, "utf8")).items;
  const missing = M.filter(m => m.type === "Key step not measured").map(m => m.title);
  assert.equal(missing.length, 2);
  assert.ok(missing.some(b => /Activation/.test(b)) && missing.some(b => /Referral/.test(b)));
  assert.ok(M.some(m => m.type === "North Star not measured"));
  assert.equal(M[0].score, 3, "activation and North Star should be on top (value 3, low effort)");
});

test("no events at all: single item: product not measured (installed but uncalled tool is named)", () => {
  const V = productSetup({ "package.json": '{"dependencies":{"mixpanel-browser":"2.0.0"}}\n', "src/pages/signup.tsx": "export const s = 1;\n" });
  const S = scan(V);
  assert.equal(S.event_count, 0);
  assert.deepEqual(S.installed, ["Mixpanel"]);
  const out = path.join(V.pm, "state", "lowhanging.json");
  run(path.join(Tool, "lowhanging.mjs"), [V.pm, "--json", out]);
  const M = JSON.parse(fs.readFileSync(out, "utf8")).items;
  assert.equal(M.length, 1);
  assert.equal(M[0].type, "Product not measured");
  assert.match(M[0].evidence, /Mixpanel/);
});

test("product evidence looks at path segments: serviceWorkerRegistration, register_push_token, admin endpoint, sync cancel don't count", () => {
  const record = Steps.find(a => a.id === "record").product;
  assert.equal(record.test("src/serviceWorkerRegistration.js"), false);
  assert.equal(record.test("src/pages/SignupPage.tsx"), true);
  assert.equal(record.test("/api/v1/auth/register"), true);
  assert.equal(record.test("/api/v1/register_push_token"), false);
  const cancel = Steps.find(a => a.id === "cancel");
  assert.equal(cancel.product.test("src/features/sync/use-sync-cancel.ts"), false);
  assert.equal(cancel.product.test("src/settings/cancel-subscription.tsx"), true);
  assert.equal(cancel.event.test("upload_cancelled"), false);
});

test("eventNameOf: gtag, event field, plain string, constant", () => {
  assert.equal(eventNameOf(`gtag('event', 'purchase', { value: 3 })`), "purchase");
  assert.equal(eventNameOf(`analytics.track({ userId, event: "Signed Up" })`), "Signed Up");
  assert.equal(eventNameOf(`mixpanel.track("Invite Sent")`), "Invite Sent");
  assert.equal(eventNameOf(`logEvent(analytics, "tutorial_complete")`), "tutorial_complete");
  assert.equal(eventNameOf(`track(Events.Onboarded)`), "Events.Onboarded");
});
