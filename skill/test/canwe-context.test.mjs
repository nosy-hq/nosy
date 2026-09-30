// Contract test for tools/canwe.mjs: a weak match isn't enough context on its own.
// Rarity alone used to let an admin-only endpoint that happens to share generic terms with the question
// (e.g. "client" + "portal") surface as a normal match, and even drive the suggested verdict, even though
// it belongs to a completely different audience/surface than a customer-facing question is asking about.
// Fake product "Cargo"; canwe.mjs reads a hand-written pm/state/inventory.json here instead of computing
// its own inventory (inventory.mjs's own repo scan isn't this test's subject).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

let K, tmp;
before(async () => { K = await fakeProductSetup(); tmp = temporary("nosy-canwe-context-"); });
after(() => { clean(K.root); clean(tmp); });

function sectionOf(output, name) {
  const re = new RegExp(`## ${name}\\n\\n([\\s\\S]*?)\\n\\n## `);
  const m = output.match(re);
  return m ? m[1] : "";
}

// The customer-facing endpoint really is about a client portal: it matches both concept groups
// ("client", "portal") and lives outside any admin/internal surface.
// The admin endpoint ALSO happens to match both concept groups (its path/file mention "portal" and
// "client" together, e.g. an admin screen that manages the customer-portal's client settings) but sits
// under an /admin/ path — a different audience than a customer-facing "client portal" question.
function inventoryWrite(pm, { withCustomer = true } = {}) {
  const endpoints = [];
  if (withCustomer) endpoints.push({ method: "GET", path: "/api/portal/client-info", file: "backend/portal/clientInfo.js", line: 4, used: true, infrastructure: false, usage: "frontend/portal/ClientInfo.jsx:12" });
  endpoints.push({ method: "POST", path: "/api/admin/portal-client-settings", file: "backend/admin/portalClientSettings.js", line: 9, used: false, infrastructure: false, usage: null });
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "state", "inventory.json"), JSON.stringify({ backend_missing: false, endpoints }, null, 1));
}

test("a customer-facing 'client portal' question: the admin-only lookalike lands in Weak matches, not mixed with the real customer endpoint", () => {
  const copyPm = path.join(tmp, "pm-both");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  inventoryWrite(copyPm);
  const r = run(path.join(Tool, "canwe.mjs"), [copyPm, "client portal"]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  const backend = sectionOf(r.output, "Ready in the backend");

  // The real customer endpoint is a strong match.
  const strong = backend.match(/### Strong matches\n\n([\s\S]*?)(?:\n\n### |$)/);
  assert.ok(strong, "expected a Strong matches subsection");
  assert.match(strong[1], /\/api\/portal\/client-info/);
  assert.doesNotMatch(strong[1], /\/api\/admin\/portal-client-settings/, "the admin lookalike must not be counted as a strong match");

  // The admin lookalike is demoted to a separate, clearly-labeled weak section instead of being silently dropped.
  const weak = backend.match(/### Weak matches — verify\n\n([\s\S]*)$/);
  assert.ok(weak, "expected a Weak matches subsection");
  assert.match(weak[1], /\/api\/admin\/portal-client-settings/);
  assert.match(weak[1], /admin\/internal surface vs\. a customer-facing question/);

  // "On screen" and the suggested verdict are driven by the real (strong) endpoint, not the admin lookalike.
  assert.match(r.output, /\*\*Already exists\*\*/);
  assert.match(r.output, /All 1 matching endpoints/);
});

test("only the admin lookalike matches: the verdict stays cautious instead of claiming the feature exists", () => {
  const copyPm = path.join(tmp, "pm-admin-only");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  inventoryWrite(copyPm, { withCustomer: false });
  const r = run(path.join(Tool, "canwe.mjs"), [copyPm, "client portal"]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  const backend = sectionOf(r.output, "Ready in the backend");

  assert.doesNotMatch(backend, /### Strong matches/, "with only an audience-mismatched endpoint, there should be no strong match");
  assert.match(backend, /### Weak matches — verify/);
  assert.match(backend, /\/api\/admin\/portal-client-settings/);

  assert.match(r.output, /\*\*Not now: no trace in the backend\*\*/);
  assert.match(r.output, /share a single generic term|verify by hand/);
});
