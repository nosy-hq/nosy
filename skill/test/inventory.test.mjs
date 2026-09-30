// Contract test (regression) for skill/tools/inventory.mjs's exported pathEstimated(repo, ref): in a fake repo
// with apps/backend + apps/web directories, it finds the frontend/backend path CORRECTLY ("apps/web"), NOT with a
// DOUBLED PREFIX ("apps/apps/web"). The old version used to show 490 of 490 endpoints as "no-screen" in one product because of this.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { temporary, clean } from "./helpers.mjs";
import { pathEstimated, compute, frontendAppsFind } from "../tools/inventory.mjs";

const copies = [];
after(() => { for (const k of copies) clean(k); });

function secondFakeRepoSetup() {
  const repo = temporary("nosy-inventory-repo2-");
  copies.push(repo);
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Inventory Test");
  git("config", "user.email", "test@inventory.test");
  fs.mkdirSync(path.join(repo, "apps", "backend"), { recursive: true });
  fs.mkdirSync(path.join(repo, "apps", "web"), { recursive: true });
  fs.writeFileSync(path.join(repo, "apps", "backend", "server.js"), "export function list() { return []; }\n");
  fs.writeFileSync(path.join(repo, "apps", "web", "index.jsx"), "export default function App() { return null; }\n");
  git("add", "-A");
  git("commit", "-q", "-m", "initial setup: apps/backend + apps/web");
  return repo;
}

test("in a repo with apps/backend + apps/web, doesn't PRODUCE a doubled prefix (not apps/apps/...)", () => {
  const repo = secondFakeRepoSetup();
  const t = pathEstimated(repo, "main");
  assert.ok(t.backend.includes("apps/backend"), `expected apps/backend in backend: ${JSON.stringify(t.backend)}`);
  assert.ok(t.frontend.includes("apps/web"), `expected apps/web in frontend: ${JSON.stringify(t.frontend)}`);
  assert.ok(!t.backend.some(p => p.startsWith("apps/apps/")), `backend should not have a doubled prefix: ${JSON.stringify(t.backend)}`);
  assert.ok(!t.frontend.some(p => p.startsWith("apps/apps/")), `frontend should not have a doubled prefix: ${JSON.stringify(t.frontend)}`);
});

test("also finds plain backend/ and web/ directories correctly when not under apps/", () => {
  const repo = temporary("nosy-inventory-repo3-");
  copies.push(repo);
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Inventory Test");
  git("config", "user.email", "test@inventory.test");
  fs.mkdirSync(path.join(repo, "backend"), { recursive: true });
  fs.mkdirSync(path.join(repo, "web"), { recursive: true });
  fs.writeFileSync(path.join(repo, "backend", "server.js"), "export function list() { return []; }\n");
  fs.writeFileSync(path.join(repo, "web", "index.jsx"), "export default function App() { return null; }\n");
  git("add", "-A"); git("commit", "-q", "-m", "plain backend/web");

  const t = pathEstimated(repo, "main");
  assert.deepEqual(t.backend, ["backend"]);
  assert.deepEqual(t.frontend, ["web"]);
});

// --- internal request 31/48 (screen matching) and 32 (default exclusion of non-product surfaces) --------------
// Fake repo: a Go net/http 1.22 backend (RULES already finds this heuristically — the FRONTEND side is what's
// actually being tested here) + a custom wrapper, a path held in a constant, a template string/multi-line call,
// and a backend with smoke-test/scripts directories.
function screenRepoSetup() {
  const repo = temporary("nosy-inventory-screen-");
  copies.push(repo);
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Inventory Test");
  git("config", "user.email", "test@inventory.test");
  const write = (rel, content) => { const p = path.join(repo, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };

  write("apps/backend/routes.go", `package main
func routes() {
	mux.HandleFunc("GET /login", loginHandler)
	mux.HandleFunc("POST /logout", logoutHandler)
	mux.HandleFunc("POST /v1/sign_up", signupHandler)
	mux.HandleFunc("GET /v1/connections/resolve", resolveHandler)
	mux.HandleFunc("GET /v1/never-used", neverHandler)
}
`);
  write("apps/backend/cmd/smoke-observability/main.go", `package main
func main() { http.HandleFunc("GET /smoke-check", handler) }
`);
  write("apps/backend/scripts/seed.go", `package main
func s() { mux.HandleFunc("GET /v1/seed-only", seedHandler) }
`);
  // Custom wrapper (authApiFetch('/login')) — the call doesn't carry a known syntax like fetch/axios/client.GET(,
  // just quote+"/" adjacency.
  write("apps/web/src/authApi.js", `export function login() { return authApiFetch('/login'); }
export function logout() { return authApiFetch("/logout"); }
`);
  // A path held in a constant, used in ANOTHER file.
  write("apps/web/src/constants.js", `export const SIGN_UP_PATH = "/v1/sign_up";\n`);
  write("apps/web/src/signup.js", `import { SIGN_UP_PATH } from "./constants.js";
export function signUp() { return api.post(SIGN_UP_PATH); }
`);
  // Template string + a call split across multiple lines.
  write("apps/web/src/resolve.js", `export function resolveConn() {
  return client.get(
    \`/v1/connections/resolve\`
  );
}
`);

  git("add", "-A"); git("commit", "-q", "-m", "screen test fixture");

  const pm = path.join(repo, "pm");
  fs.mkdirSync(pm, { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({
    repo, ref: "main",
    inventory: { backend: ["apps/backend"], frontend: ["apps/web/src"] },
  }, null, 1));
  return { repo, pm };
}

test("a custom wrapper call (authApiFetch('/login')) counts as screen usage", () => {
  const { pm } = screenRepoSetup();
  const R = compute(pm);
  const login = R.endpoints.find(e => e.path === "/login");
  const logout = R.endpoints.find(e => e.path === "/logout");
  assert.equal(login.used, true, "authApiFetch('/login') was missed");
  assert.match(login.usage, /authApi\.js:1$/);
  assert.equal(logout.used, true, "authApiFetch(\"/logout\") was missed");
});

test("a path held in a constant (const SIGN_UP_PATH) still counts even when used in ANOTHER file", () => {
  const { pm } = screenRepoSetup();
  const R = compute(pm);
  const signup = R.endpoints.find(e => e.path === "/v1/sign_up");
  assert.equal(signup.used, true, "a path assigned to a constant and used in another file was missed");
  assert.match(signup.usage, /signup\.js:\d+$/, "the evidence should be the usage line, not the definition line");
});

test("a template string + a call split across multiple lines (client.get(`/x`) on its own line) is caught", () => {
  const { pm } = screenRepoSetup();
  const R = compute(pm);
  const resolve = R.endpoints.find(e => e.path === "/v1/connections/resolve");
  assert.equal(resolve.used, true, "the multi-line template call was missed");
  assert.match(resolve.usage, /resolve\.js:3$/);
});

test("an endpoint that's genuinely unused still stays no-screen (no false negatives)", () => {
  const { pm } = screenRepoSetup();
  const R = compute(pm);
  const neverUsed = R.endpoints.find(e => e.path === "/v1/never-used");
  assert.equal(neverUsed.used, false);
});

test("endpoints under cmd/smoke-*/ and scripts/ are product_excluded by default, not counted as no-screen", () => {
  const { pm } = screenRepoSetup();
  const R = compute(pm);
  const smoke = R.endpoints.find(e => e.path === "/smoke-check");
  const seed = R.endpoints.find(e => e.path === "/v1/seed-only");
  assert.equal(smoke.product_excluded, true);
  assert.equal(seed.product_excluded, true);
  assert.equal(R.product_excluded, 2);
  // Neither should enter the no-screen counters (no-screen should not include smoke/seed — only never-used).
  assert.equal(R.noScreen, 1);
});

test("if sources.json gives inventory.product_excluded, the default list is fully replaced (overridden)", () => {
  const { pm, repo } = screenRepoSetup();
  const sourcesPath = path.join(pm, "sources.json");
  const K = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
  K.inventory.product_excluded = []; // empty array: default disabled, nothing is product_excluded
  fs.writeFileSync(sourcesPath, JSON.stringify(K, null, 1));
  const R = compute(pm);
  const smoke = R.endpoints.find(e => e.path === "/smoke-check");
  assert.ok(!smoke.product_excluded, "an empty product_excluded list should have overridden the default");
  assert.equal(R.product_excluded, 0);
  void repo;
});

// --- internal request 65 (Express/Koa/Fastify lowercase route registrations) ------------------------------
// A Node backend: app.get/router.post lowercase, fastify.route({method,url}) object form; also Go chi/gin
// (UPPERCASE) and Python FastAPI decorator (lowercase @app.get) in the same repo — also tests that the new
// GREP alternative doesn't BREAK these (no regression).
function expressionRepoSetup() {
  const repo = temporary("nosy-inventory-expression-");
  copies.push(repo);
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Inventory Test");
  git("config", "user.email", "test@inventory.test");
  const write = (rel, content) => { const p = path.join(repo, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };

  write("apps/backend/express/app.js", `const app = require("express")();
const router = require("express").Router();
app.get('/widgets', listWidgets);
router.post("/widgets", createWidget);
`);
  // Note: RULES' fastify.route({method,url}) rule only sees the SINGLE line that git grep matched (the
  // multi-line object form would be its own separate internal request); this tests the single-line form.
  write("apps/backend/express/fastify.js", `fastify.route({ method: 'GET', url: '/gadgets' });\n`);
  write("apps/backend/go/routes.go", `package main
func routes() {
	r := chi.NewRouter()
	r.Get("/chi-things", chiHandler)
}
`);
  write("apps/backend/py/main.py", `@app.get("/py-things")
def read_things():
    return []
`);
  git("add", "-A"); git("commit", "-q", "-m", "expression test fixture");

  const pm = path.join(repo, "pm");
  fs.mkdirSync(pm, { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({
    repo, ref: "main",
    inventory: { backend: ["apps/backend"], frontend: [] },
  }, null, 1));
  return { repo, pm };
}

test("lowercase Express routes (app.get/router.post) are caught in the backend", () => {
  const { pm } = expressionRepoSetup();
  const R = compute(pm);
  const get = R.endpoints.find(e => e.method === "GET" && e.path === "/widgets");
  const post = R.endpoints.find(e => e.method === "POST" && e.path === "/widgets");
  assert.ok(get, "app.get('/widgets') was not caught");
  assert.ok(post, "router.post(\"/widgets\") was not caught");
});

test("the fastify.route({ method, url }) object form is caught", () => {
  const { pm } = expressionRepoSetup();
  const R = compute(pm);
  const gadgets = R.endpoints.find(e => e.path === "/gadgets");
  assert.ok(gadgets, "fastify.route({method,url}) was not caught");
  assert.equal(gadgets.method, "GET");
});

test("after adding lowercase Express, the Go chi (UPPERCASE) and Python FastAPI decorator heuristics aren't broken", () => {
  const { pm } = expressionRepoSetup();
  const R = compute(pm);
  assert.ok(R.endpoints.find(e => e.path === "/chi-things" && e.method === "GET"), "chi.Get(\"/chi-things\") was missed");
  assert.ok(R.endpoints.find(e => e.path === "/py-things" && e.method === "GET"), "@app.get(\"/py-things\") was missed");
});

// --- internal request 60 (confidence: sure | shouldLookAt) ------------------------------------------------------
function confidenceRepoSetup() {
  const repo = temporary("nosy-inventory-confidence-");
  copies.push(repo);
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Inventory Test");
  git("config", "user.email", "test@inventory.test");
  const write = (rel, content) => { const p = path.join(repo, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };

  write("apps/backend/routes.go", `package main
func routes() {
	mux.HandleFunc("GET /widgets", widgetsHandler)
	mux.HandleFunc("POST /orders/archive", archiveHandler)
}
`);
  write("apps/backend/contract.yaml", `paths:
  /contract-only:
    get:
`);
  // An unrelated path that shares the "archive" trailing segment — a weak trace (single-segment match).
  write("apps/web/src/reports.js", `export function loadReportsArchive() { return fetch('/reports/archive'); }\n`);
  git("add", "-A"); git("commit", "-q", "-m", "confidence test fixture");

  const pm = path.join(repo, "pm");
  fs.mkdirSync(pm, { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({
    repo, ref: "main",
    inventory: { backend: ["apps/backend"], frontend: ["apps/web/src"], openapi: "apps/backend/contract.yaml" },
  }, null, 1));
  return { repo, pm };
}

test("confidence: an endpoint with no trace on the frontend counts as 'sure'", () => {
  const { pm } = confidenceRepoSetup();
  const R = compute(pm);
  const widgets = R.endpoints.find(e => e.path === "/widgets" && e.method === "GET");
  assert.equal(widgets.used, false);
  assert.equal(widgets.confidence, "sure");
});

test("confidence: an endpoint with a single-segment (weak) match no longer counts as FULLY used, becomes 'shouldLookAt'", () => {
  const { pm } = confidenceRepoSetup();
  const R = compute(pm);
  const orders = R.endpoints.find(e => e.path === "/orders/archive");
  assert.equal(orders.used, false, "a single-segment match (archive) should not count as full usage");
  assert.equal(orders.confidence, "shouldLookAt");
});

test("confidence: an endpoint that only comes from the generated contract file counts as 'shouldLookAt'", () => {
  const { pm } = confidenceRepoSetup();
  const R = compute(pm);
  const contractOnly = R.endpoints.find(e => e.path === "/contract-only");
  assert.ok(contractOnly, "the endpoint from the contract was not found");
  assert.equal(contractOnly.used, false);
  assert.equal(contractOnly.confidence, "shouldLookAt");
});

test("no_screen_sure only counts the sure subset; noScreen stays sure+shouldLookAt combined for backward compat", () => {
  const { pm } = confidenceRepoSetup();
  const R = compute(pm);
  const noScreenEndpoints = R.endpoints.filter(e => !e.used && !e.infrastructure && !e.product_excluded);
  const sureCount = noScreenEndpoints.filter(e => e.confidence === "sure").length;
  const shouldLookAtCount = noScreenEndpoints.filter(e => e.confidence === "shouldLookAt").length;
  assert.equal(R.noScreen, noScreenEndpoints.length);
  assert.equal(R.no_screen_sure, sureCount);
  assert.equal(R.noScreen, R.no_screen_sure + shouldLookAtCount);
  assert.equal(sureCount, 1, "only /widgets should be sure");
  assert.equal(shouldLookAtCount, 2, "/orders/archive and /contract-only should be shouldLookAt");
});

// --- internal request 111 (raw fetch/axios/ky/$fetch/useFetch screen counting; superseded from structural
// signals only; callers vs. screens) --------------------------------------------------------------------------
function r111RepoSetup() {
  const repo = temporary("nosy-inventory-r111-");
  copies.push(repo);
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Inventory Test");
  git("config", "user.email", "test@inventory.test");
  const write = (rel, content) => { const p = path.join(repo, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };

  write("apps/backend/routes.go", `package main
func routes() {
	mux.HandleFunc("GET /v1/raw-fetch-item", rawFetchHandler)
	mux.HandleFunc("GET /v1/raw-axios-item", rawAxiosHandler)
	mux.HandleFunc("POST /v1/old-endpoint", oldHandler)
	mux.HandleFunc("POST /v1/go-deprecated", goDeprecatedHandler)
	mux.HandleFunc("POST /v1/gone-handler", goneHandler)
	mux.HandleFunc("GET /v1/veraltet-endpoint", veraltetHandler)
	mux.HandleFunc("POST /v1/sync", syncHandler)
	mux.HandleFunc("POST /v1/sync/preview", syncPreviewHandler)
	mux.HandleFunc("POST /v1/sync/confirm", syncConfirmHandler)
	mux.HandleFunc("POST /v1/extension-only", extensionOnlyHandler)
}

// @deprecated use /v1/new-endpoint instead
func oldHandler(w http.ResponseWriter, r *http.Request) {
	writeOld(w)
}

// Deprecated: replaced by /v1/go-new (internal request 111 test)
func goDeprecatedHandler(w http.ResponseWriter, r *http.Request) {
	writeSomething(w)
}

func goneHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusGone)
}

// veraltet: bu uç nokta artik kullanilmiyor (this is prose, in German/Turkish, NOT the canonical tag)
func veraltetHandler(w http.ResponseWriter, r *http.Request) {
	writeSomething(w)
}

func syncHandler(w http.ResponseWriter, r *http.Request) {
	writeSomething(w)
}
`);
  // Web app screens: a raw fetch with a template literal, and axios.get — neither goes through the generated
  // request() contract client or a named custom wrapper.
  write("apps/web/src/raw.js", `export function loadItem(id) {
  return fetch(\`/v1/raw-fetch-item\`);
}
export function loadOther() {
  return axios.get('/v1/raw-axios-item');
}
export function runPreview() { return api.post('/v1/sync/preview'); }
export function runConfirm() { return api.post('/v1/sync/confirm'); }
`);
  // A non-screen in-repo API client (a browser extension background script): calls an endpoint no web screen calls.
  write("apps/extension/src/background/client.js", `export function extOnly() {
  return fetch(\`/v1/extension-only\`);
}
`);
  git("add", "-A"); git("commit", "-q", "-m", "internal request 111 fixture");

  const pm = path.join(repo, "pm");
  fs.mkdirSync(pm, { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({
    repo, ref: "main",
    inventory: {
      backend: ["apps/backend"], frontend: ["apps/web/src"],
      callers: [{ name: "extension", paths: ["apps/extension/src"] }],
    },
  }, null, 1));
  return { repo, pm };
}

test("a raw fetch(`/path`) template-literal call counts as screen usage (no wrapper, no request())", () => {
  const { pm } = r111RepoSetup();
  const R = compute(pm);
  const e = R.endpoints.find(x => x.path === "/v1/raw-fetch-item");
  assert.equal(e.used, true, "raw fetch(`/v1/raw-fetch-item`) was missed");
  assert.match(e.usage, /raw\.js:2$/);
});

test("a raw axios.get('/path') call counts as screen usage", () => {
  const { pm } = r111RepoSetup();
  const R = compute(pm);
  const e = R.endpoints.find(x => x.path === "/v1/raw-axios-item");
  assert.equal(e.used, true, "raw axios.get('/v1/raw-axios-item') was missed");
  assert.match(e.usage, /raw\.js:5$/);
});

test("a @deprecated JSDoc-style tag on the handler marks the endpoint superseded (structural)", () => {
  const { pm } = r111RepoSetup();
  const R = compute(pm);
  const e = R.endpoints.find(x => x.path === "/v1/old-endpoint");
  assert.equal(e.used, false);
  assert.equal(e.superseded, true, "@deprecated on the handler should mark it superseded");
  assert.ok(e.supersededEvidence, "should carry evidence of the structural signal");
});

test("Go's own `// Deprecated:` convention on the handler marks the endpoint superseded", () => {
  const { pm } = r111RepoSetup();
  const R = compute(pm);
  const e = R.endpoints.find(x => x.path === "/v1/go-deprecated");
  assert.equal(e.superseded, true, "// Deprecated: on the handler should mark it superseded");
});

test("a handler that only returns 410 Gone marks the endpoint superseded", () => {
  const { pm } = r111RepoSetup();
  const R = compute(pm);
  const e = R.endpoints.find(x => x.path === "/v1/gone-handler");
  assert.equal(e.superseded, true, "a handler that only WriteHeader(http.StatusGone) should be superseded");
});

test("language independence: a German/Turkish prose comment ('veraltet') does NOT mark superseded", () => {
  const { pm } = r111RepoSetup();
  const R = compute(pm);
  const e = R.endpoints.find(x => x.path === "/v1/veraltet-endpoint");
  assert.equal(e.used, false);
  assert.equal(!!e.superseded, false, "a free-text 'veraltet' comment must NOT be treated as a deprecation signal");
});

test("no structural signal, but a used sibling endpoint shares the path as a prefix: possiblySuperseded, still counted as no-screen", () => {
  const { pm } = r111RepoSetup();
  const R = compute(pm);
  const e = R.endpoints.find(x => x.path === "/v1/sync");
  assert.equal(e.used, false);
  assert.equal(!!e.superseded, false, "no structural signal exists for /v1/sync — must not be marked superseded");
  assert.equal(e.possiblySuperseded, true, "/v1/sync/preview and /v1/sync/confirm are used siblings — should be flagged for a human check");
  assert.equal(R.noScreen >= 1 && R.endpoints.filter(x => !x.used && !x.superseded && !(x.callers && x.callers.length)).some(x => x.path === "/v1/sync"), true, "possiblySuperseded stays IN the no-screen list, it's not excluded");
});

test("callers: an endpoint called only from a configured non-screen in-repo client (extension) is not 'used' but drops out of no-screen, reported as a caller", () => {
  const { pm } = r111RepoSetup();
  const R = compute(pm);
  const e = R.endpoints.find(x => x.path === "/v1/extension-only");
  assert.equal(e.used, false, "the extension isn't a product screen — used must stay false");
  assert.ok(e.callers && e.callers.length === 1 && e.callers[0].name === "extension", "should record the extension as a caller");
  const stillNoScreen = R.endpoints.filter(x => !x.used && !x.infrastructure && !x.product_excluded && !x.superseded && !(x.callers && x.callers.length));
  assert.ok(!stillNoScreen.some(x => x.path === "/v1/extension-only"), "a caller-claimed endpoint must not appear in the no-screen set");
});

// --- internal request 115 (every frontend app is inventoried, matched by SHAPE not name) ----------------------
// "Kargo" fixture: a monorepo with TWO frontend apps, NEITHER named with "frontend" in it (apps/kargo-web,
// apps/kargo-admin), plus a frontend-shaped app under packages/ (packages/kargo-widgets, no package.json of its
// own — only a pages/ subfolder) and a real backend that must NOT be picked up as a frontend.
function kargoTwoFrontendsSetup() {
  const repo = temporary("nosy-inventory-kargo-");
  copies.push(repo);
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Inventory Test");
  git("config", "user.email", "test@inventory.test");
  const write = (rel, content) => { const p = path.join(repo, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };

  write("apps/kargo-web/package.json", JSON.stringify({ name: "kargo-web", dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" } }));
  write("apps/kargo-web/src/App.tsx", "export default function App() { return null; }\n");
  write("apps/kargo-admin/package.json", JSON.stringify({ name: "kargo-admin", dependencies: { next: "^14.0.0" } }));
  write("apps/kargo-admin/app/page.tsx", "export default function Page() { return null; }\n");
  write("packages/kargo-widgets/pages/index.js", "export default function Index() { return null; }\n");
  write("apps/kargo-backend/package.json", JSON.stringify({ name: "kargo-backend", dependencies: { express: "^4.0.0" } }));
  write("apps/kargo-backend/server.js", "export function list() { return []; }\n");
  git("add", "-A"); git("commit", "-q", "-m", "Kargo: two frontends fixture");
  return repo;
}

test("frontendAppsFind detects a frontend app by package.json dependency, even without \"frontend\" in its own name", () => {
  const repo = kargoTwoFrontendsSetup();
  const found = frontendAppsFind(repo, "main");
  assert.ok(found.includes("apps/kargo-web"), `apps/kargo-web (react dep) missing: ${JSON.stringify(found)}`);
  assert.ok(found.includes("apps/kargo-admin"), `apps/kargo-admin (next dep) missing: ${JSON.stringify(found)}`);
});

test("frontendAppsFind also looks under packages/ and clients/, matching by a screen-shaped subfolder (pages/app/routes) when there's no package.json signal", () => {
  const repo = kargoTwoFrontendsSetup();
  const found = frontendAppsFind(repo, "main");
  assert.ok(found.includes("packages/kargo-widgets"), `packages/kargo-widgets (pages/ shape) missing: ${JSON.stringify(found)}`);
});

test("frontendAppsFind does not mistake a backend app (no frontend dep, no screen-shaped folder) for a frontend", () => {
  const repo = kargoTwoFrontendsSetup();
  const found = frontendAppsFind(repo, "main");
  assert.ok(!found.includes("apps/kargo-backend"), `apps/kargo-backend should not be detected as a frontend: ${JSON.stringify(found)}`);
});

test("pathEstimated's frontend guess is WIDENED by the shape detector: both Kargo frontends show up even though the old name-only guess (apps/*frontend*) would have found neither", () => {
  const repo = kargoTwoFrontendsSetup();
  const t = pathEstimated(repo, "main");
  assert.ok(t.frontend.includes("apps/kargo-web"), `apps/kargo-web missing from pathEstimated frontend: ${JSON.stringify(t.frontend)}`);
  assert.ok(t.frontend.includes("apps/kargo-admin"), `apps/kargo-admin missing from pathEstimated frontend: ${JSON.stringify(t.frontend)}`);
  assert.ok(!t.frontend.includes("apps/kargo-backend"), `apps/kargo-backend should not appear in frontend: ${JSON.stringify(t.frontend)}`);
});

test("a blobless clone at a clean HEAD: same endpoints as the full repo, read from disk, nothing fetched; another ref stops instead of fetching", () => {
  const { repo, pm } = screenRepoSetup();
  const full = compute(pm).endpoints.map(e => `${e.path} ${e.used}`).sort();
  execFileSync("git", ["-C", repo, "config", "uploadpack.allowFilter", "true"]);
  const dir = temporary("nosy-inventory-partial-"); copies.push(dir);
  const clone = path.join(dir, "c");
  execFileSync("git", ["clone", "-q", "--no-local", "--filter=blob:none", `file://${repo}`, clone]);
  const packs = () => fs.readdirSync(path.join(clone, ".git", "objects", "pack")).length;
  const pm2 = path.join(dir, "pm"); fs.mkdirSync(pm2);
  fs.writeFileSync(path.join(pm2, "sources.json"), JSON.stringify({ repo: clone, ref: "HEAD", inventory: { backend: ["apps/backend"], frontend: ["apps/web/src"] } }));
  const before = packs();
  const got = compute(pm2).endpoints.map(e => `${e.path} ${e.used}`).sort();
  assert.deepEqual(got, full);
  assert.equal(packs(), before, "nothing fetched");
  fs.writeFileSync(path.join(pm2, "sources.json"), JSON.stringify({ repo: clone, ref: "HEAD~1", inventory: { backend: ["apps/backend"], frontend: ["apps/web/src"] } }));
  assert.throws(() => compute(pm2), /partial clone and "HEAD~1" isn't the clean, checked-out HEAD/);
  assert.equal(packs(), before, "still nothing fetched");
});
