// glance: the page's first screen, readable without reading. The owner on Nosy's own page:
// "I can't see what matters, it's all text; people have AI summarise it now, I want to see it." Rivals who ship
// summaries do the same thing: Klue/Crayon battlecards (one card, a few lines), Linear's project updates (a colour
// first, then a few sentences), Swarmia/Jellyfish (a few big numbers, detail on click). So the first screen is:
// the next product decision, four numbers, where we stand against the best rivals, the roadmap as three lanes,
// and what shipped this week. Every string is cut to a budget; the long text stays below it on the page.
// Reads pm/ only (matrix.json, state/*.json, learned outcomes via waves.json); the landing-roundup line comes from
// next.mjs, which reads git. Every block is left out when its data is missing, never shown empty.
import { readSourcesSafe, matrixFile } from "./sources-file.mjs";
import fs from "node:fs"; import path from "node:path";
import { nextDecision } from "./next-decision.mjs";
import { thresholds } from "./thresholds.mjs";
import { todoSummary } from "./todo.mjs";

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
export const cut = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); if (s.length <= n) return s; const i = s.lastIndexOf(" ", n - 1); return s.slice(0, i > n / 2 ? i : n - 1).replace(/[\s,;:(—-]+$/, "") + "…"; };
// A title from a numbered backlog line: the number and markdown go, the first sentence stays.
const titleOf = s => String(s || "").replace(/^\s*\d+[.)]\s*/, "").replace(/[`*_~]/g, "").split(/(?<=[.:;])\s/)[0].replace(/[.:;]$/, "");
const score = (codes, steps) => steps.reduce((a, s) => { const k = typeof codes?.[s.no] === "string" ? codes[s.no] : codes?.[s.no]?.k; return a + (k === "y" ? 1 : k === "p" ? 0.5 : 0); }, 0);
// A step name for a chip: before the first colon or bracket, capped.
const stepLabel = n => { const h = String(n).split(/[:(]/)[0].replace(/"/g, "").trim(), c = h.split(",")[0].trim();
  return cut(/^(a|an|the)\s/i.test(c) || c.split(/\s+/).length < 2 ? h : c, 34); };
// A commit subject as a chip: "merge side/x:", "internal request 12:", "log:" prefixes and trailing refs go.
const clean = t => String(t || "").replace(/^merge\s+\S+:\s*/i, "").replace(/^(internal requests?|iç talep)\s+[\d, and]+:\s*/i, "").replace(/^[a-z][\w-]*:\s*/i, "").replace(/\s*\((internal requests?|iç talep)[^)]*\)\s*$/i, "").replace(/^\w/, c => c.toUpperCase());
// The team's own list says the owner decides this one.
const OWNER_CALL = /\b(owner)('s)? (call|decides|decision)\b|\bthe decision to\b|\bowner decides\b/i;

// The reason a published "Not doing" card carries (the full reason is waves.json's, on the owner's machine).
const offMeta = r => { const t = String(r || ""); return /knowingly/.test(t) ? "your standing call" : /^matrix:/.test(t) ? "decided in the matrix" : /^decision:/.test(t) ? "decided" : /^signal:/.test(t) ? "not doing" : ""; };

// refsOnly: the shipped tags name the references, not the commit subjects (what `nosy publish` sends).
export function glance(pm, { M = readJson(matrixFile(pm, readSourcesSafe(pm))), nextPicks = null, refsOnly = false } = {}) {
  const st = f => readJson(path.join(pm, "state", f));
  const W = st("waves.json"), F = st("psst-final.json"), T = st("team-next.json"), S = st("status.json");
  const G = {};

  const D = nextDecision(pm);
  if (D) {
    const days = D.size ? thresholds(pm).sizeDays?.[D.size] : null;
    const onList = (T?.items || []).find(i => titleOf(i.text || i.title).toLowerCase().slice(0, 40) === String(D.title).toLowerCase().slice(0, 40));
    // The size is its own badge, so a refuter's "L, not M:" opening doesn't repeat it in the why.
    G.decision = { title: cut(D.title, 90), why: cut(String(D.why || "").replace(/^\s*(S|M|L)(,\s*not\s+(S|M|L))?:\s*/, ""), 130), size: D.size || null, days: days || null, checked: !!D.checked,
      checks: [D.checked ? "checked by psst's refuter" : "not checked yet: run psst", onList ? `on your own list · ${onList.file}:${onList.line}` : null].filter(Boolean) };
  }

  const steps = M?.steps || [], me = M?.biz, active = (M?.products || []).filter(p => (p.statusType || "active") === "active");
  if (steps.length && me && active.length) {
    const code = (p, no) => p === me ? me.codes?.[no] : p.codes?.[no]?.k;
    const strip = steps.map(s => { const us = code(me, s.no), ry = active.filter(p => code(p, s.no) === "y").length;
      const d = me.declined?.[s.no], declined = us !== "y" && (d === true || (typeof d === "string" && d.trim() !== "")); // the owner decided against it (matrix contract, read-matrix.mjs and Cloud: `true` or a non-empty reason): not "behind", not "missing"
      return { no: s.no, name: s.name, us, kind: declined ? "declined" : us === "y" && !ry ? "only" : us !== "y" && ry ? "behind" : "shared", rivalsWithIt: ry }; });
    const ranked = active.map(p => ({ name: p.name.replace(/\s*\(.*$/, "").replace(/\s+—.*$/, ""), score: score(p.codes, steps) })).sort((a, b) => b.score - a.score);
    G.stand = { steps: steps.length, rivals: active.length, me: { name: me.name, score: score(me.codes, steps) }, top: ranked.slice(0, 4), strip };
    G.only = strip.filter(s => s.kind === "only"); G.behind = strip.filter(s => s.kind === "behind");
  }

  if (W) {
    const nowT = (W.waves?.find(w => w.name === "Now")?.tasks || []);
    const open = (T?.items || []).map(i => ({ title: titleOf(i.text || i.title), text: i.text || i.title, where: `${i.file}:${i.line}` }));
    const call = [...(W.owner_decision_of || []).map(o => ({ title: o.title || o.feature || String(o), meta: "your decision" })),
      ...open.filter(i => OWNER_CALL.test(i.text)).map(i => ({ title: i.title, meta: i.where }))];
    const callKeys = new Set(call.map(c => c.title.toLowerCase().slice(0, 40)));
    let now = nowT.filter(t => !callKeys.has(titleOf(t.title).toLowerCase().slice(0, 40))).map(t => ({ title: t.title, size: t.effort || null, meta: t.checked ? "checked" : "not checked" }));
    // An empty "Now" with checked work in a later wave (an L the refuter resized goes to "After"): show that work, with its wave.
    if (!now.length) now = (W.waves || []).flatMap(w => (w.tasks || []).filter(t => t.checked).map(t => ({ title: t.title, size: t.effort || null, meta: `${w.name} · checked` })));
    G.lanes = [
      { key: "now", name: nowT.length ? "Now" : "Next up", items: now },
      { key: "you", name: "Your call", items: call },
      // refsOnly (what `nosy publish` sends): what the refuter dropped stays home (its titles and its `why` are the refuter's notes), and the reason
      // is one of a few fixed phrases, never the text of a decision, a matrix note or a refuter's sentence.
      { key: "off", name: "Not doing", items: (W.outside || []).filter(o => !refsOnly || !/psst refuter/.test(o.source || "")).map(o => ({ title: o.title, meta: refsOnly ? offMeta(o.reason) : /knowingly/.test(o.reason || "") ? "your standing call" : cut(o.reason, 40) })) },
    ].map(l => ({ ...l, total: l.items.length, items: l.items.slice(0, 3).map(i => ({ ...i, title: cut(i.title, 70) })) }));
    if (!G.lanes.some(l => l.total)) delete G.lanes;
  }

  // What only a person can do (pm/todo/, todo.mjs). refsOnly (what `nosy publish` sends) carries the count and the age, never a title or a name.
  const P = todoSummary(pm);
  if (P.open) G.todo = { open: P.open, oldestDays: P.oldestDays, people: P.people.length,
    items: refsOnly ? [] : P.items.slice(0, 4).map(i => ({ title: cut(i.title, 70), who: cut(i.who, 20), days: i.days })), more: refsOnly ? 0 : Math.max(0, P.open - 4) };

  const checkedWins = F?.items?.length ?? null;
  G.tiles = [
    G.only && { key: "good", label: "Only we have", value: G.only.length, unit: `/ ${steps.length} steps`, note: G.only.length ? "no active rival has these" : "every step has a rival" },
    G.behind && { key: "warn", label: "We're behind", value: G.behind.length, unit: "steps", note: cut(G.behind.map(s => stepLabel(s.name)).join(", "), 60) || "nowhere" },
    checkedWins != null && { key: "", label: "Cheap wins, checked", value: checkedWins, unit: "items", note: F?.dropped?.length ? `${F.dropped.length} dropped by the refuter` : "psst's list after the refuter" },
    G.lanes && { key: "you", label: "Waiting on you", value: G.lanes[1].total, unit: "", note: cut(G.lanes[1].items.map(i => i.title).join(" · "), 60) || "nothing" },
    G.todo && { key: "people", label: "Waiting on people", value: G.todo.open, unit: G.todo.open === 1 ? "thing" : "things", note: G.todo.oldestDays ? `the oldest for ${G.todo.oldestDays} day${G.todo.oldestDays === 1 ? "" : "s"}` : "all added today" },
  ].filter(Boolean);

  // What shipped: the shipped record's groups (one per request/issue ref), biggest first.
  if (S?.groups?.length) {
    const refd = S.groups.filter(g => g.ref && g.ref !== "(no ref)");
    // "09.28 10:29 PM" (collect-status's local format) → a sortable number; newest first.
    const when = g => { const m = String(g.last || "").match(/(\d+)\.(\d+)\s+(\d+):(\d+)\s*(AM|PM)?/i); if (!m) return 0; const h = (+m[3] % 12) + (/pm/i.test(m[5] || "") ? 12 : 0); return ((+m[1] * 31 + +m[2]) * 24 + h) * 60 + +m[4]; };
    const seen = new Set(), byN = [...S.groups].sort((a, b) => when(b) - when(a)).filter(g => { const k = clean(refsOnly ? g.ref : g.topic || g.ref).toLowerCase(); return !seen.has(k) && seen.add(k); });
    G.shipped = { since: (String(S.range || "").match(/--since (\S+)/) || [])[1] || null, commits: S.main ?? null, refs: refd.length,
      tags: byN.slice(0, 7).map(g => cut(refsOnly ? g.ref : clean(g.topic || g.ref), 46)) };
  }
  const yard = (nextPicks || []).find(p => p.command === "frontyard");
  if (yard) G.roundup = cut(yard.reason, 150);
  return G;
}

// The page's first screen. `esc` comes from the page builder (one escaping rule for the whole page).
export function renderGlance(G, { esc }) {
  const parts = [];
  if (G.decision) { const d = G.decision;
    parts.push(`<section class="gl-hero" aria-labelledby="gl-dec"><div><div class="lab">Your next product decision</div><h2 id="gl-dec">${esc(d.title)}</h2>${d.why ? `<p class="why">${esc(d.why)}</p>` : ""}</div>${d.size ? `<div class="gl-size"><span class="s">${esc(d.size)}</span><span class="l">size${d.days ? `<br>≈ ${esc(d.days)} day${d.days === 1 ? "" : "s"}` : ""}</span></div>` : ""}<div class="gl-checks">${d.checks.map((c, i) => `<span class="${i === 0 && !d.checked ? "no" : ""}">${i === 0 && !d.checked ? "!" : "✓"} ${esc(c)}</span>`).join("")}</div></section>`); }
  else parts.push(`<section class="gl-hero" aria-labelledby="gl-dec"><div><div class="lab">Your next product decision</div><h2 id="gl-dec">None yet</h2><p class="why">Run /nosy:psst, then /nosy:scoop: the decision comes from the checked list.</p></div></section>`);
  if (G.tiles.length) parts.push(`<section class="gl-tiles" aria-label="Key numbers">${G.tiles.map(t => `<div class="gl-tile ${t.key}"><span class="lab">${esc(t.label)}</span><span class="v">${esc(t.value)}${t.unit ? `<small>${esc(t.unit)}</small>` : ""}</span><span class="note">${esc(t.note)}</span></div>`).join("")}</section>`);
  const row = [];
  if (G.stand) { const s = G.stand, max = s.steps || 1, bar = (name, v, me) => `<div class="gl-b${me ? " me" : ""}"><span class="n">${esc(name)}</span><span class="t"><i style="width:${Math.round(Number(100 * v / max)) || 0}%"></i></span><span class="x">${esc(v)}</span></div>`;
    row.push(`<section class="gl-panel" aria-labelledby="gl-st"><div><h3 id="gl-st">Where we stand</h3><p class="sub">Steps covered out of ${esc(s.steps)} (partial counts half) · ${esc(s.rivals)} active rival${s.rivals === 1 ? "" : "s"}</p></div><div class="gl-bars">${bar(s.me.name, s.me.score, true)}${s.top.map(t => bar(t.name, t.score)).join("")}</div><div class="gl-strip" role="img" aria-label="${esc(s.steps)} steps: ${G.only.length} only we have, ${G.behind.length} behind">${s.strip.map(x => `<span class="${x.kind}${x.us === "p" ? " part" : ""}" title="${esc(`${x.no}. ${x.name}: ${x.kind === "only" ? "only we have it" : x.kind === "behind" ? `${x.rivalsWithIt} rival${x.rivalsWithIt === 1 ? " has" : "s have"} it, we don't fully` : x.kind === "declined" ? "we decided against it" : "shared"}`)}"></span>`).join("")}</div><div class="gl-legend"><span><i class="only"></i>only we have</span><span><i class="behind"></i>behind</span><span><i></i>shared</span>${s.strip.some(x => x.kind === "declined") ? `<span><i class="declined"></i>decided against</span>` : ""}</div>${G.only.length ? `<div class="gl-tags">${G.only.map(x => `<span>${esc(stepLabel(x.name))}</span>`).join("")}</div>` : ""}</section>`); }
  if (G.lanes) row.push(`<section class="gl-panel" aria-labelledby="gl-rm"><div><h3 id="gl-rm">Roadmap</h3><p class="sub">From the checked list; reasons are under Waves</p></div><div class="gl-lanes">${G.lanes.map(l => `<div class="gl-lane ${l.key}"><div class="h"><b>${esc(l.name)}</b><span>${esc(l.total)}</span></div>${l.items.length ? l.items.map(i => `<div class="gl-card">${esc(i.title)}<span class="m">${i.size ? `<b>${esc(i.size)}</b>` : ""}${esc(i.meta || "")}</span></div>`).join("") : `<div class="gl-card empty">nothing here</div>`}${l.total > l.items.length ? `<span class="more">+${esc(l.total - l.items.length)} more</span>` : ""}</div>`).join("")}</div></section>`);
  if (row.length) parts.push(`<div class="gl-row${row.length === 1 ? " one" : ""}">${row.join("")}</div>`);
  if (G.todo?.items?.length) parts.push(`<section class="gl-panel" aria-labelledby="gl-td"><div><h3 id="gl-td">Waiting on people</h3><p class="sub">Only a person can do these; nobody else touches them. Close one with nosy todo done &lt;id&gt;.</p></div><div class="gl-todo">${G.todo.items.map(i => `<div class="gl-card"><span><b>${esc(i.who)}</b> ${esc(i.title)}</span><span class="m">${i.days ? `${esc(i.days)} day${i.days === 1 ? "" : "s"}` : "today"}</span></div>`).join("")}${G.todo.more ? `<span class="more">+${esc(G.todo.more)} more: nosy todo</span>` : ""}</div></section>`);
  if (G.shipped || G.roundup) { const s = G.shipped;
    parts.push(`<section class="gl-panel" aria-labelledby="gl-sh"><h3 id="gl-sh">Shipped${s?.since ? ` since ${esc(s.since)}` : " lately"}</h3><div class="gl-shipped">${s ? `<div class="count">${esc(s.refs)}<small>requests touched${s.commits != null ? `<br>${esc(s.commits)} commits` : ""}</small></div><div class="gl-tags">${s.tags.map(t => `<span>${esc(t)}</span>`).join("")}</div>` : ""}${G.roundup ? `<p class="ask"><b>Landing page:</b> ${esc(G.roundup)} Run <code>/nosy:frontyard</code>.</p>` : ""}</div></section>`); }
  return `<div class="glance">${parts.join("")}</div>`;
}

// Styles for the first screen, on the page's own tokens.
export const GLANCE_CSS = `
.glance{display:grid;gap:14px;padding-block:22px 10px}
.gl-hero{background:var(--hero-bg);color:var(--hero-ink);border-radius:12px;padding:22px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px 26px;align-items:start}
.gl-hero .lab{color:var(--hero-muted)}
.gl-hero h2{font-size:clamp(24px,3.6vw,36px);line-height:1.08;margin-top:10px;max-width:26ch;text-transform:none}
.gl-hero .why{color:var(--hero-muted);margin-top:10px;max-width:64ch}
.gl-size{display:grid;justify-items:center;gap:6px;min-width:84px}
.gl-size .s{font:400 54px/1 var(--display)}
.gl-size .l{font:500 11px/1.3 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--hero-muted);text-align:center}
.gl-checks{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px}
.gl-checks span{font-size:12.5px;padding:6px 10px;border-radius:7px;background:var(--hero-chip)}
.gl-checks span.no{background:var(--mag);color:#fff}
.gl-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:12px}
.gl-tile{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:15px;display:grid;gap:6px;align-content:start}
.gl-tile .v{font:400 40px/1 var(--display);font-variant-numeric:tabular-nums}
.gl-tile .v small{font:500 14px/1 var(--mono);color:var(--muted);margin-left:5px}
.gl-tile .note{font-size:13px;color:var(--muted)}
.gl-tile.good .v{color:var(--ok)}.gl-tile.warn .v{color:var(--part)}.gl-tile.you .v,.gl-tile.people .v{color:var(--mag)}
.gl-row{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:12px}.gl-row.one{grid-template-columns:minmax(0,1fr)}
.gl-panel{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:17px;display:grid;gap:13px;align-content:start;min-width:0}
.gl-panel h3{font-size:19px}.gl-panel .sub{font-size:13px;color:var(--muted);margin-top:3px}
.gl-bars{display:grid;gap:8px}
.gl-b{display:grid;grid-template-columns:minmax(0,150px) minmax(0,1fr) 40px;gap:10px;align-items:center;font-size:13.5px}
.gl-b .n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gl-b .t{height:11px;background:var(--soft);border-radius:3px;overflow:hidden}.gl-b .t i{display:block;height:100%;background:var(--bar-c);border-radius:3px}
.gl-b.me .n,.gl-b.me .x{font-weight:600;color:var(--ink)}.gl-b.me .t i{background:var(--ink)}
.gl-b .x{font:500 12.5px/1 var(--mono);text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
.gl-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(9px,1fr));gap:3px}
.gl-strip span{aspect-ratio:1;max-width:100%;border-radius:3px;background:var(--bar-c);cursor:help}
.gl-strip span.only{background:var(--ink)}.gl-strip span.behind{background:var(--mag)}.gl-strip span.declined{background:var(--line,#c8c8c8)}
.gl-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12.5px;color:var(--muted)}
.gl-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px;background:var(--bar-c)}
.gl-legend i.only{background:var(--ink)}.gl-legend i.behind{background:var(--mag)}.gl-legend i.declined{background:var(--line,#c8c8c8)}
.gl-tags{display:flex;flex-wrap:wrap;gap:6px}.gl-tags span{font-size:12.5px;line-height:1.3;padding:5px 9px;border-radius:6px;background:var(--sea-soft)}
.gl-lanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr));gap:10px}
.gl-lane{display:grid;gap:8px;align-content:start;min-width:0}
.gl-lane .h{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid var(--line);padding-bottom:6px}
.gl-lane.now .h{border-color:var(--ink)}.gl-lane.you .h{border-color:var(--mag)}
.gl-lane .h b{font:600 11.5px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase}.gl-lane .h span{font:500 12px/1 var(--mono);color:var(--muted)}
.gl-card{background:var(--soft);border-radius:7px;padding:9px 10px;font-size:13.5px;line-height:1.35;display:grid;gap:5px}
.gl-card .m{display:flex;gap:6px;align-items:center;font:500 11.5px/1.2 var(--mono);color:var(--muted)}
.gl-card .m b{font-weight:600;padding:2px 5px;border-radius:3px;background:var(--ink);color:var(--paper)}
.gl-todo{display:grid;gap:8px}.gl-todo .gl-card b{font-weight:600}.gl-todo .more{font:500 11.5px/1 var(--mono);color:var(--muted)}
.gl-card.empty{color:var(--muted);background:transparent;border:1px dashed var(--line)}
.gl-lane.off .gl-card{color:var(--muted)}.gl-lane .more{font:500 11.5px/1 var(--mono);color:var(--muted)}
.gl-shipped{display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px 18px;align-items:center}
.gl-shipped .count{font:400 42px/1 var(--display);font-variant-numeric:tabular-nums}
.gl-shipped .count small{display:block;font:500 11px/1.35 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-top:6px}
.gl-shipped .ask{grid-column:1/-1;border-top:1px dashed var(--line);padding-top:11px;font-size:14px;max-width:none}
@media (max-width:820px){.gl-row{grid-template-columns:minmax(0,1fr)}}
@media (max-width:520px){.gl-hero{grid-template-columns:minmax(0,1fr)}.gl-size{justify-items:start;grid-auto-flow:column;align-items:baseline;gap:10px}.gl-b{grid-template-columns:minmax(0,100px) minmax(0,1fr) 36px}.gl-strip{gap:2px}}
`;
