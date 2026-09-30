// A secret committed to the repo must not be printed by `nosy find` (or canwe): the file:line stays, the value goes.
// Fake secrets are assembled from parts at run time, so no fixed secret string sits in the repo.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { redactLine, isSecretFile } from "../tools/redact.mjs";

const dirs = [];
after(() => dirs.forEach(clean));
const TOKEN = ["gh", "p_", "Zx8Qm2Lk9Rt4Vb7Nc1Hp5Jw3Ys6Fd0Ga2Ue4"].join("");
const PASS = ["hunter", "2-fake-value"].join("");

test("secret-looking files are recognised by name; code and docs are not", () => {
  for (const f of ["secrets.env", "config/.env", "a/.env.production", "deploy/prod.env", "certs/server.pem", "ssh/id_rsa", "credentials.json", "credentials", "aws/credentials", ".npmrc", "infra/prod.tfvars", "service-account-prod.json"]) assert.ok(isSecretFile(f), f);
  for (const f of ["src/credentials.ts", "docs/secrets.md", ".env.d.ts", "ssh/id_rsa.pub", "app/login.tsx", "README.md"]) assert.ok(!isSecretFile(f), f);
});

test("redactLine: a secret file keeps the key and loses the value; any other line of it is hidden whole", () => {
  assert.equal(redactLine("secrets.env", `API_TOKEN=${TOKEN}`), "API_TOKEN=[redacted]");
  assert.equal(redactLine("a/.env", `export DB_PASSWORD=${PASS}`), "export DB_PASSWORD=[redacted]");
  assert.equal(redactLine("x/.env", `# old value: ${PASS}`), "[redacted] (.env holds secrets)");
  assert.equal(redactLine("k.pem", "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSj"), "[redacted] (k.pem holds secrets)");
  assert.equal(redactLine("credentials.json", `  "private_key": "${PASS}",`), '  "private_key": [redacted]');
});

test("redactLine: elsewhere only the recognised secret goes, the rest of the line stays", () => {
  assert.equal(redactLine("src/a.ts", `const t = "${TOKEN}"; // deploy`), 'const t = "[redacted]"; // deploy');
  assert.equal(redactLine("src/db.ts", `const u = "postgres://app:${PASS}@db.internal:5432/app";`), 'const u = "postgres://app:[redacted]@db.internal:5432/app";');
  assert.equal(redactLine("src/b.ts", 'const password = "changeme";'), 'const password = "changeme";', "a placeholder is not a secret");
  assert.equal(redactLine("src/c.ts", "export function login(user) {}"), "export function login(user) {}");
});

test("nosy find: a committed secrets.env prints as file:line with the value hidden; ordinary lines print as before", () => {
  const root = temporary("nosy-redact-"); dirs.push(root);
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(root, "secrets.env"), `STRIPE_WIDGETKEY=${PASS}\nOTHER=1\n`);
  fs.writeFileSync(path.join(root, "app.ts"), `export const widgetkey = "${TOKEN}"; // widgetkey for the deploy\n`);
  fs.writeFileSync(path.join(root, "notes.md"), "The widgetkey is documented here.\n");
  git("add", "-A"); git("commit", "-q", "-m", `add widgetkey ${TOKEN}`);
  fs.mkdirSync(path.join(root, "pm")); fs.writeFileSync(path.join(root, "pm", "sources.json"), JSON.stringify({ repo: root, ref: "main" }));
  const r = run(path.join(Tool, "facts.mjs"), [path.join(root, "pm"), "find", "widgetkey"]);
  assert.equal(r.code, 0, r.error);
  assert.ok(!r.output.includes(PASS), "the .env value is never printed");
  assert.ok(!r.output.includes(TOKEN), "a token in code or in a commit subject is never printed");
  assert.match(r.output, /secrets\.env:1/, "the file:line is printed");
  assert.match(r.output, /STRIPE_WIDGETKEY=\[redacted\]/);
  assert.match(r.output, /app\.ts:1/);
  assert.match(r.output, /notes\.md:1 .*  The widgetkey is documented here\./);
});
