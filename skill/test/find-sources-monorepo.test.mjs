// find-sources + verify-setup on a Twenty-shaped monorepo (packages/<name>-server, packages/<name>-website, no
// decisions doc). Throwaway repo; no network.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const FS = path.join(Tool, "find-sources.mjs"), VS = path.join(Tool, "verify-setup.mjs"), dirs = [];
after(() => dirs.forEach(clean));
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

function monorepo() {
  const root = temporary("nosy-mono-"); dirs.push(root);
  const put = (f, s) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), s); };
  put("README.md", "# Acme CRM\nAn open-source CRM. Every user sends a message from a list.\n");
  // The server pulls in react (e-mail templates): shaped like a frontend by its dependencies, but it's the backend.
  put("packages/acme-server/package.json", JSON.stringify({ name: "acme-server", dependencies: { "@nestjs/core": "1", react: "18" } }));
  put("packages/acme-server/src/main.ts", "bootstrap();\n");
  put("packages/acme-front/package.json", JSON.stringify({ name: "acme-front", dependencies: { react: "18" } }));
  put("packages/acme-front/src/App.tsx", "export const App = () => null;\n");
  put("packages/acme-front/src/App.test.tsx", "test('x', () => {});\n");
  put("packages/acme-website/package.json", JSON.stringify({ name: "acme-website", dependencies: { next: "14", react: "18" } }));
  put("packages/acme-website/src/app/[locale]/(site)/page.tsx", "export default function Home() { return null; }\n");
  execFileSync("git", ["-C", root, "init", "-q", "-b", "main"], { env: ENV });
  execFileSync("git", ["-C", root, "add", "-A"], { env: ENV });
  execFileSync("git", ["-C", root, "commit", "-q", "-m", "init"], { env: ENV });
  return root;
}

test("monorepo: packages/*-server is the backend (not a frontend), the site package is the landing page, no decisions key when there's no doc, no word→itself glossary", () => {
  const root = monorepo(), pm = path.join(temporary("nosy-mono-pm-"), "pm"); dirs.push(path.dirname(pm));
  const out = run(FS, [root, "--pm", pm, "--write"]);
  assert.equal(out.code, 0, out.error);
  const K = JSON.parse(fs.readFileSync(path.join(pm, "sources.json"), "utf8"));
  assert.deepEqual(K.inventory.backend, ["packages/acme-server"]);
  assert.ok(!K.inventory.frontend.includes("packages/acme-server"), JSON.stringify(K.inventory.frontend));
  assert.ok(K.inventory.frontend.includes("packages/acme-front"));
  assert.deepEqual(K.frontyard.path, "packages/acme-website/src/app/[locale]/(site)/page.tsx");
  assert.equal("decisions" in K.preread, false, "no decisions doc: the key is left out, not written as \"\"");
  for (const [k, v] of Object.entries(K.glossary || {})) if (Array.isArray(v)) assert.ok(!v.map(x => x.toLowerCase()).includes(k.toLowerCase()), `${k} → itself`);
});

test("verify-setup: wildcard excludes are checked against the tracked files, and a listed backend isn't reported as a missing frontend", () => {
  const root = monorepo(), pmDir = temporary("nosy-mono-vs-"); dirs.push(pmDir);
  fs.writeFileSync(path.join(pmDir, "sources.json"), JSON.stringify({ repo: root, ref: "main",
    inventory: { backend: ["packages/acme-server"], frontend: ["packages/acme-front", "packages/acme-website"], excluded: ["**/*.test.*", "**/nothing_here/**"] } }));
  const out = run(VS, [pmDir]);
  assert.match(out.output, /inventory\.excluded: \*\*\/\*\.test\.\* \| ✓ \| matches 1 file/);
  assert.match(out.output, /inventory\.excluded: \*\*\/nothing_here\/\*\* \| ~ \| matches nothing/);
  assert.doesNotMatch(out.output, /not listed in inventory\.frontend: .*acme-server/);
});
