// next-decision.mjs: one "next product decision" for every surface, never a held or refuted item.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { nextDecision, render } from "../tools/next-decision.mjs";
import { next } from "../tools/next.mjs";
import { temporary, clean } from "./helpers.mjs";

const dirs = [];
after(() => dirs.forEach(clean));
function pm(files) {
  const root = temporary("nosy-nextdec-"); dirs.push(root);
  const p = path.join(root, "pm"); fs.mkdirSync(path.join(p, "state"), { recursive: true });
  for (const [f, o] of Object.entries(files)) fs.writeFileSync(path.join(p, "state", f), JSON.stringify(o));
  return p;
}
const now = tasks => ({ waves: [{ name: "Now", tasks }] });

test("a checked item on the roadmap wins, with the refuter's correction as the why", () => {
  const D = nextDecision(pm({ "psst-final.json": { generated: "2026-09-29T10:00:00Z", items: [], dropped: [] }, "lowhanging.json": { generated: "2026-09-29T09:00:00Z", items: [] }, "waves.json": now([
    { title: "#385 record · 2 fields", reason_now: "backend ready (x.ts:1)" },
    { title: "Review history", checked: "weakened", effort: "M", reason_now: "checked by psst (corrected: M: needs a roster lookup) · x.ts:24" },
  ]) }));
  assert.deepEqual([D.title, D.checked, D.size, D.why], ["Review history", true, "M", "M: needs a roster lookup"]);
});

test("never a held or refuted item, even at the top of Now; unchecked items say so", () => {
  const p = pm({
    "waves.json": now([{ title: "#385 record · 2 fields", reason_now: "backend ready" }, { title: "Source section", reason_now: "x" }, { title: "Pricing plans", effort: "M", reason_now: "served, no screen · §26" }]),
    "receipts.json": { items: [{ rank: 1, title: "#385 record · 2 fields", gate: { held: true, because: [] } }] },
    "psst-final.json": { items: [], dropped: [{ title: "Source section", why: "parked" }] },
  });
  const D = nextDecision(p);
  assert.equal(D.title, "Pricing plans");
  assert.equal(D.checked, false);
  assert.match(render(D), /^Next product decision: Pricing plans \(M\) — served, no screen · not checked yet: run psst/);
});

test("no roadmap yet: psst's checked list, then the raw list; nothing at all says what to run", () => {
  assert.equal(nextDecision(pm({ "psst-final.json": { items: [{ title: "Strike stale lines", verdict: "stands", size: "S", evidence: ["docs/a.md:5"] }], dropped: [] } })).title, "Strike stale lines");
  assert.equal(nextDecision(pm({ "lowhanging.json": { items: [{ title: "Bulk export", type: "Backend ready, not on screen", effort: "S" }] } })).checked, false);
  assert.equal(nextDecision(pm({})), null);
  assert.match(render(null), /run psst, then scoop/);
});

test("next.mjs carries the same decision the nudge would say", () => {
  const p = pm({ "psst-final.json": { generated: "2026-09-29T10:00:00Z", items: [], dropped: [] }, "waves.json": now([{ title: "Review history", checked: "stands", effort: "S", reason_now: "checked by psst · x.ts:1" }]) });
  fs.writeFileSync(path.join(p, "sources.json"), JSON.stringify({ repo: path.dirname(p), ref: "main" }));
  assert.equal(next(p).decision.title, "Review history");
});

test("a check older than the list it checked isn't trusted: its items fall back to 'not checked yet'", () => {
  const D = nextDecision(pm({ "psst-final.json": { generated: "2026-09-20T10:00:00Z", items: [{ title: "Old pick", verdict: "stands", size: "S" }], dropped: [] },
    "lowhanging.json": { generated: "2026-09-29T09:00:00Z", items: [{ title: "Fresh raw item", type: "Backend ready, not on screen", effort: "S" }] } }));
  assert.equal(D.title, "Fresh raw item");
  assert.equal(D.checked, false);
});

test("a roadmap older than the checked list doesn't name its checked tasks", () => {
  const D = nextDecision(pm({ "lowhanging.json": { generated: "2026-09-29T09:00:00Z", items: [] },
    "psst-final.json": { generated: "2026-09-29T12:00:00Z", items: [{ title: "Field dropped signal", verdict: "weakened", fix: "L: needs extractors", size: "L" }], dropped: [] },
    "waves.json": { generated: "2026-09-29T10:00:00Z", waves: [{ name: "Now", tasks: [{ title: "Matrix rows (done since)", checked: "weakened", effort: "M", reason_now: "checked by psst (corrected: M: x)" }] }] } }));
  assert.deepEqual([D.title, D.size, D.source], ["Field dropped signal", "L", "pm/state/psst-final.json"]);
});

test("an item from the team's own notes has no size until psst sizes it", () => {
  const D = nextDecision(pm({ "lowhanging.json": { generated: "2026-09-29T09:00:00Z", items: [{ title: "The CRM trial", type: "On the team's next list", effort: null }] } }));
  assert.deepEqual([D.size, D.why, D.checked], [null, "On the team's next list, size not estimated", false]);
});
