// demand-facts: what a dashboard may show about customer demand, cut from pm/state/signals.json (collect-signals.mjs).
// Published with the dashboard files as pm/state/demand.json. The rule, because signals are customer words:
//   sent    goals matched to a matrix row or a psst item (their titles are the team's own, already on the dashboard):
//           title, mentions, distinct customers, source format, first/last seen, 30-day trend, built or not
//   counts  goals matched to a decision or a request-document item: how many and how many mentions, no titles
//           (decisions.md and the request doc stay on the owner's machine)
//   never   quotes and examples, refs, file paths and repo names, and the unmatched themes (keyed by word pairs from
//           customer text, which can be a customer's name)
// A goal with no mentions is left out. No signals.json means null: nothing is published, never an empty file.
import fs from "node:fs"; import path from "node:path";

const SHOWN = new Set(["matrix", "psst"]);
const n = v => (Number.isFinite(+v) ? +v : 0);
const cut = (s, k) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, k);

export function demandForCloud(pm) {
  const file = path.join(pm, "state", "signals.json");
  if (!fs.existsSync(file)) return null;
  let J; try { J = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  const goals = (J.goals || []).filter(g => n(g.count) > 0);
  if (!goals.length) return null;
  const sources = {};
  for (const s of J.sources || []) if (s?.format) sources[cut(s.format, 20)] = (sources[cut(s.format, 20)] || 0) + n(s.signal);
  const hidden = goals.filter(g => !SHOWN.has(g.type));
  return {
    generated: J.generated || null, total: n(J.total), matching: n(J.matching), sources,
    goals: goals.filter(g => SHOWN.has(g.type)).map(g => ({
      type: g.type, title: cut(g.title, 140), code: g.code ?? null, count: n(g.count), customers: n(g.customer),
      first: g.first || null, last: g.last || null, trend: { last30: n(g.trend?.last30), previous30: n(g.trend?.previous30) },
      formats: Object.fromEntries(Object.entries(g.source || {}).map(([k, v]) => [cut(k, 20), n(v)])),
      ready: !!g.ready, notDoing: !!g.notDoing,
    })),
    hidden: { targets: hidden.length, mentions: hidden.reduce((t, g) => t + n(g.count), 0) },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  console.log(JSON.stringify(demandForCloud(process.argv[2] || "pm"), null, 1));
}
