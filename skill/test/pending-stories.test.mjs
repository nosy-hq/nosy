// pending-backend.mjs: developer previews are not screens. Histoire/Storybook files (`X.story.vue`, `X.stories.tsx`,
// `X.stories.svelte`), specs and __tests__ / fixtures folders that import mock data must not be listed as "screens on mock data".
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pending } from "../tools/pending-backend.mjs";
import { temporary, clean } from "./helpers.mjs";

const dirs = [];
after(() => dirs.forEach(clean));

test("only real screens on mock data are listed; story, stories, spec, __tests__ and fixtures files are not", () => {
  const root = temporary("nosy-pending-stories-"); dirs.push(root);
  const files = {
    "web/src/inbox/Inbox.vue": "<script>\nimport rows from './mocks/rows.json';\n</script>\n",
    "web/src/inbox/story/Inbox.story.vue": "<script>\nimport rows from '../mocks/rows.json';\n</script>\n",
    "web/src/inbox/Card.stories.svelte": "<script>\nimport rows from './mocks/rows.json';\n</script>\n",
    "web/src/inbox/Card.stories.tsx": "import rows from './mocks/rows.json';\nexport default {};\n",
    "web/src/inbox/Card.spec.vue": "<script>\nimport rows from './mocks/rows.json';\n</script>\n",
    "web/src/inbox/__tests__/Card.tsx": "import rows from '../mocks/rows.json';\n",
    "web/src/inbox/fixtures/Page.tsx": "import rows from '../mocks/rows.json';\n",
    "web/src/inbox/mocks/rows.json": "[]\n",
  };
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), body); }
  for (const a of [["init", "-q", "-b", "main"], ["add", "."], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]]) execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
  const pm = path.join(root, "pm"); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main", inventory: { frontend: ["web/src"], backend: ["api"] } }));
  const mocks = pending(pm).items.filter(i => i.kind === "mock").map(i => i.evidence.split(":")[0]);
  assert.deepEqual(mocks, ["web/src/inbox/Inbox.vue"]);
});
