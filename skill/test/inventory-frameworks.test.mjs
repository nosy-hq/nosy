// inventory.mjs reads Next.js route files (app router route.*, pages/api) and Django urls.py trees (include() prefixes),
// and says so out loud when it read nothing, instead of a silent "0 endpoints". Fictional repos only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { temporary, clean, run, Tool } from "./helpers.mjs";
import { compute, pathEstimated } from "../tools/inventory.mjs";

const copies = [];
after(() => { for (const k of copies) clean(k); });

function repoSetup(files, inventory) {
  const repo = temporary("nosy-inventory-fw-");
  copies.push(repo);
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main"); git("config", "user.name", "T"); git("config", "user.email", "t@t.test");
  for (const [rel, content] of Object.entries(files)) { const p = path.join(repo, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); }
  git("add", "-A"); git("commit", "-q", "-m", "fixture");
  const pm = path.join(repo, "pm");
  fs.mkdirSync(pm, { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "main", inventory }, null, 1));
  return { repo, pm };
}
const has = (R, method, p) => R.endpoints.find(e => e.method === method && e.path === p);

const NEXT = {
  "src/app/api/orders/route.ts": "export async function GET() { return Response.json([]); }\nexport async function POST(req) { return Response.json({}); }\n",
  "src/app/api/orders/[orderId]/route.ts": "export const DELETE = async () => new Response(null);\n",
  "src/app/(shop)/cart/route.js": "export function GET() { return new Response('cart'); }\n",
  "src/app/docs/[...slug]/route.ts": "export const GET = () => new Response('doc');\n",
  "src/app/@modal/hidden/route.ts": "export const GET = () => new Response('slot');\n",
  "src/app/api/orders/route.test.ts": "export const GET = () => 1;\n",
  "src/pages/api/ping.js": "export default function handler(req, res) { res.json({}); }\n",
  "src/pages/api/users/index.ts": "export default function handler(req, res) { res.json([]); }\n",
  "src/pages/api/users/[id].ts": "export default function handler(req, res) { res.json({}); }\n",
  "src/pages/api/_private.ts": "export default function handler() {}\n",
  "src/components/Orders.tsx": "export const Orders = () => { fetch('/api/orders'); return null; };\n",
};

test("Next.js: app-router route files become endpoints, with URL from the folder and methods from the exports", () => {
  const R = compute(repoSetup(NEXT, { backend: ["src/app", "src/pages/api"], frontend: ["src/components"] }).pm);
  assert.ok(has(R, "GET", "/api/orders"));
  assert.ok(has(R, "POST", "/api/orders"));
  assert.ok(has(R, "DELETE", "/api/orders/{orderId}"), "[orderId] becomes {orderId}");
  assert.ok(has(R, "GET", "/cart"), "(shop) route group is not part of the URL");
  assert.ok(has(R, "GET", "/docs/{slug}"), "catch-all segment");
  assert.ok(has(R, "GET", "/hidden") && !R.endpoints.some(e => /modal|@/.test(e.path)), "@slot folders are not part of the URL");
  assert.equal(has(R, "GET", "/api/orders").file, "src/app/api/orders/route.ts");
  assert.equal(has(R, "GET", "/api/orders").line, 1);
  assert.equal(has(R, "POST", "/api/orders").line, 2);
  assert.equal(R.endpoints.filter(e => e.file.endsWith("route.test.ts")).length, 0, "test files are not routes");
});

test("Next.js: pages/api files become endpoints (index folded, _private skipped) and screen usage is matched on the URL", () => {
  const R = compute(repoSetup(NEXT, { backend: ["src/app", "src/pages/api"], frontend: ["src/components"] }).pm);
  assert.ok(has(R, "ANY", "/api/ping"));
  assert.ok(has(R, "ANY", "/api/users"));
  assert.ok(has(R, "ANY", "/api/users/{id}"));
  assert.ok(!R.endpoints.some(e => e.path.includes("_private")));
  assert.equal(has(R, "GET", "/api/orders").used, true, "fetch('/api/orders') in a component");
  assert.equal(has(R, "ANY", "/api/ping").used, false);
});

test("Next.js: a route folder called scripts or tools is a URL, not an excluded scripts directory", () => {
  const R = compute(repoSetup({ "app/api/scripts/route.ts": "export const GET = () => new Response('s');\n", "app/page.tsx": "export default () => null;\n" }, { backend: ["app"], frontend: ["app"] }).pm);
  assert.ok(has(R, "GET", "/api/scripts"));
  assert.ok(!has(R, "GET", "/api/scripts").product_excluded);
});

test("Next.js: setup's path guess finds the app folder as the backend when the repo is a Next app", () => {
  const { repo } = repoSetup({ "package.json": JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" } }), "src/app/api/x/route.ts": "export const GET = () => 1;\n", "src/components/A.tsx": "export const A = 1;\n" }, {});
  const t = pathEstimated(repo, "main");
  assert.ok(t.backend.includes("src/app"), JSON.stringify(t));
  assert.ok(t.frontend.includes("src"), JSON.stringify(t));
});

const DJANGO = {
  "config/urls.py": "from django.urls import include, path\nurlpatterns = [\n    path('shop/', include('shop.urls')),\n    path('api/', include(('api.urls', 'api'))),\n    path('health/', views.health),\n]\n",
  "shop/urls.py": "from django.urls import path, re_path\nurlpatterns = [\n    path('items/', views.items, name='items'),\n    path(\n        'items/<int:pk>/',\n        views.item_detail,\n    ),\n    re_path(r'^legacy/(?P<slug>\\w+)/$', views.legacy),\n]\n",
  "api/urls.py": "from rest_framework.routers import DefaultRouter\nrouter = DefaultRouter()\nrouter.register(r'widgets', WidgetViewSet)\nurlpatterns = [path('', include(router.urls))]\n",
  "web/src/api.js": "export const items = () => fetch('/shop/items');\n",
};

test("Django: paths under include() get their real prefix, <int:pk> becomes {pk}, re_path groups become {name}, multi-line calls are read", () => {
  const R = compute(repoSetup(DJANGO, { backend: ["config", "shop", "api"], frontend: ["web/src"] }).pm);
  assert.ok(has(R, "ANY", "/shop/items"), JSON.stringify(R.endpoints.map(e => e.path)));
  assert.ok(has(R, "ANY", "/shop/items/{pk}"));
  assert.ok(has(R, "ANY", "/shop/legacy/{slug}"));
  assert.ok(has(R, "ANY", "/health"));
  assert.ok(has(R, "ANY", "/api/widgets") && has(R, "ANY", "/api/widgets/{pk}"), "DRF router.register under include(router.urls)");
  assert.equal(has(R, "ANY", "/shop/items/{pk}").file, "shop/urls.py");
  assert.equal(has(R, "ANY", "/shop/items/{pk}").line, 4, "the line of the path( call");
  assert.equal(has(R, "ANY", "/shop/items").used, true);
  assert.ok(!R.endpoints.some(e => e.path === "/items"), "no prefix-less duplicate of a nested route");
});

test("Django: urls.py files it cannot resolve are named in the output, not a silent 0 endpoints", () => {
  const { pm } = repoSetup({ "shop/urls.py": "from .router import router\nurlpatterns = router.urls\n", "shop/models.py": "class A: pass\n" }, { backend: ["shop"], frontend: [] });
  const R = compute(pm);
  assert.equal(R.total, 0);
  assert.match(R.notes.join("\n"), /Django URL files not read: 1 urls\.py file/);
  const r = run(path.join(Tool, "inventory.mjs"), [pm]);
  assert.match(r.output, /Django URL files not read/);
});

test("an empty result says which route formats were looked for", () => {
  const { pm } = repoSetup({ "svc/main.go": "package main\nfunc main() {}\n" }, { backend: ["svc"], frontend: [] });
  const R = compute(pm);
  assert.match(R.notes.join("\n"), /0 endpoints found in svc\..*Next\.js/);
});
