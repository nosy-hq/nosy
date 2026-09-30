// fields.mjs (the cheap version): what one type carries and the next drops.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { compare, render } from "../tools/fields.mjs";
import { temporary, clean } from "./helpers.mjs";

const dirs = [];
after(() => dirs.forEach(clean));
function repo(files) {
  const r = temporary("nosy-fields-"); dirs.push(r);
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true }); fs.writeFileSync(path.join(r, f), body); }
  const g = (...a) => execFileSync("git", ["-C", r, ...a], { stdio: "ignore" });
  g("init", "-q"); g("add", "."); g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x");
  return r;
}

test("Go: the v4 shape, a field carried by name or json tag, one dropped", () => {
  const r = repo({
    "readiness/readiness.go": "package readiness\n\ntype Readiness struct {\n\tReady   bool\n\tAction  Action\n\tMessage string\n\t// the connection\n\tConnectionID string\n\tOwnerRequired bool\n}\n",
    "httpx/response.go": "package httpx\n\ntype ErrorItem struct {\n\tCode    string `json:\"code\"`\n\tMessage string `json:\"message\"`\n\tAction  string `json:\"action,omitempty\"`\n\tOwner   bool   `json:\"owner_required,omitempty\"`\n\tSecret  string `json:\"-\"`\n}\n",
  });
  const R = compare(r, "Readiness", "ErrorItem");
  assert.equal(R.from.at, "readiness/readiness.go:3");
  assert.deepEqual(R.carried.map(f => f.name), ["Action", "Message", "OwnerRequired"]); // OwnerRequired = owner_required
  assert.deepEqual(R.dropped.map(f => [f.name, f.at]), [["Ready", "readiness/readiness.go:4"], ["ConnectionID", "readiness/readiness.go:8"]]);
  assert.deepEqual(R.added.map(f => f.name), ["Code"]); // a json:"-" field isn't on the wire
  assert.match(render(R), /dropped: Ready .*ConnectionID/);
});

test("TypeScript interfaces and object types; a scoped name picks one of two definitions", () => {
  const r = repo({
    "web/a/types.ts": "export interface Row {\n  id: string;\n  connectionId?: string;\n  readonly label: string;\n}\n",
    "web/b/types.ts": "export interface Row {\n  other: number;\n}\n",
    "web/view.ts": "export type RowView = {\n  id: string;\n  label: string;\n  nested: { deep: string };\n};\n",
  });
  const R = compare(r, "a:Row", "RowView");
  assert.deepEqual([R.from.at, R.carried.map(f => f.name), R.dropped.map(f => f.name), R.added.map(f => f.name)],
    ["web/a/types.ts:1", ["id", "label"], ["connectionId"], ["nested"]]);
  assert.equal(compare(r, "Row", "RowView").from.also.length, 1, "the other definition is named so the agent can pick it");
});

test("a missing type says so instead of an empty diff", () => {
  const r = repo({ "x.go": "package x\n" });
  const R = compare(r, "Nope", "Gone");
  assert.equal(R.from.at, null);
  assert.match(render(R), /No definition found for Nope and Gone/);
});
