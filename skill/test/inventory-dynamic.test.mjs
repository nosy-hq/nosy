// inventory.mjs: frontend calls the URL string never shows. A screen that talks to the backend through a base API class
// (`class Widgets extends ApiClient { constructor() { super('widgets') } }`) has no "/widgets" literal anywhere; a real run
// on a public repo called webhooks, canned responses and automation rules "no screen" because of it. Fictional Rails-shaped repo.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { temporary, clean, run, Tool } from "./helpers.mjs";
import { compute } from "../tools/inventory.mjs";

const copies = [];
after(() => { for (const k of copies) clean(k); });

function repoSetup({ baseClass }) {
  const repo = temporary("nosy-inventory-dynamic-");
  copies.push(repo);
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main"); git("config", "user.name", "T"); git("config", "user.email", "t@t.test");
  const write = (rel, content) => { const p = path.join(repo, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
  write("config/routes.rb", "Rails.application.routes.draw do\n  resources :widgets\n  resources :gizmos\n  resources :gadgets\n  resources :sprockets\nend\n");
  if (baseClass) {
    write("app/frontend/api/ApiClient.js", "export default class ApiClient {\n  constructor(resource) { this.resource = resource; }\n  get url() { return `/api/${this.resource}`; }\n}\n");
    write("app/frontend/api/widgets.js", "import ApiClient from './ApiClient';\nclass Widgets extends ApiClient {\n  constructor() {\n    super('widgets', { accountScoped: true });\n  }\n}\nexport default new Widgets();\n");
  } else {
    write("app/frontend/api/widgets.js", "export const list = () => fetch('/widgets');\n");
  }
  // A screen folder named for the noun, with no URL string in it at all.
  write("app/frontend/settings/gizmos/Index.vue", "<template><div>Gizmos</div></template>\n");
  // The noun only appears in a comment in the frontend: a weak trace, not a screen.
  write("app/frontend/notes.js", "// TODO: sprockets need a settings page some day\n");
  git("add", "-A"); git("commit", "-q", "-m", "fixture");
  const pm = path.join(repo, "pm");
  fs.mkdirSync(pm, { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "main", inventory: { backend: ["config"], frontend: ["app/frontend"] } }, null, 1));
  return { repo, pm };
}
const ep = (R, method, p) => R.endpoints.find(e => e.method === method && e.path === p);

test("a resource name given to a base API class counts as a screen, and the evidence names the class call", () => {
  const R = compute(repoSetup({ baseClass: true }).pm);
  const list = ep(R, "GET", "/widgets");
  assert.equal(list.used, true, "widgets is wired through super('widgets')");
  assert.equal(list.usage_kind, "resource");
  assert.match(list.usage, /app\/frontend\/api\/widgets\.js:4 \(built through a base API class: 'widgets'\)/);
  assert.equal(ep(R, "PATCH", "/widgets/{id}").used, true);
});

test("a frontend file or folder named for the noun is a trace by itself (by name)", () => {
  const R = compute(repoSetup({ baseClass: true }).pm);
  const g = ep(R, "GET", "/gizmos");
  assert.equal(g.used, true);
  assert.equal(g.usage_kind, "name");
  assert.match(g.usage, /settings\/gizmos\/Index\.vue \(by name/);
});

test("with a base API class in the frontend, no-screen endpoints are never 'sure' and the report says calls built dynamically aren't seen", () => {
  const { pm } = repoSetup({ baseClass: true });
  const R = compute(pm);
  const gadget = ep(R, "GET", "/gadgets");
  assert.equal(gadget.used, false);
  assert.equal(gadget.confidence, "shouldLookAt");
  assert.equal(R.no_screen_sure, 0);
  assert.match(R.frontend_dynamic.note, /no screen found \(frontend calls built dynamically aren't seen\)/);
  assert.deepEqual(R.frontend_dynamic.base_classes, ["ApiClient"]);
  const r = run(path.join(Tool, "inventory.mjs"), [pm]);
  assert.match(r.output, /no screen found \(frontend calls built dynamically aren't seen\)/);
});

test("the noun only in a comment is a weak trace: still no screen, still 'shouldLookAt'", () => {
  const R = compute(repoSetup({ baseClass: false }).pm);
  const s = ep(R, "GET", "/sprockets");
  assert.equal(s.used, false);
  assert.equal(s.confidence, "shouldLookAt");
});

test("without any base API class and no trace at all, a no-screen endpoint stays 'sure' and carries no dynamic caveat", () => {
  const R = compute(repoSetup({ baseClass: false }).pm);
  const gadget = ep(R, "GET", "/gadgets");
  assert.equal(gadget.used, false);
  assert.equal(gadget.confidence, "sure");
  assert.equal(R.frontend_dynamic, undefined);
  assert.equal(ep(R, "GET", "/widgets").used, true, "the plain literal still works");
});
