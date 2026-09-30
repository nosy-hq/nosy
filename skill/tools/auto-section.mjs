// Generates a page section from status and lowhanging results; replaces hand-written "as of" lines.
// Reads: <pm>/state/status.json (collect-status --json), <pm>/state/lowhanging.json (lowhanging --json),
//   <pm>/state/stale.json (find-stale --json) if present and it has findings, a third box "May be stale".
// Usage: node auto-section.mjs <pm folder> <page.html>
//   Replaces the content between <!-- pm:auto --> ... <!-- /pm:auto --> on the page; if the marker is missing, inserts it before </footer>.
// build-page.mjs puts the same section into its own page via `section()`.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { nextDecision } from "./next-decision.mjs";
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const read = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const hour = iso => new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const range = a => { const m = a.match(/^--since (\S+)(?: (\S+))? (\S+)$/); return m ? `since ${new Date(m[1]).toLocaleDateString("en-US", { day: "numeric", month: "short" })} ${m[2] || ""} · ${m[3]}` : a; };
const Head = "<!-- pm:auto -->", Last = "<!-- /pm:auto -->";

export function section(pm) {
  // If the owner's feedback exists (learn.mjs apply → lowhanging.filtered.json), the page shows that: a muted item shouldn't return to the page.
  const d = read(path.join(pm, "state", "status.json")), l = read(path.join(pm, "state", "lowhanging.filtered.json")) || read(path.join(pm, "state", "lowhanging.json"));
  const b = read(path.join(pm, "state", "stale.json"));
  const t = read(path.join(pm, "state", "dresscode.json")); // design system (dresscode.mjs): one box, a summary of the 20 fields + what's important right now
  // psst's check step: the next decision, what survived the refuter, what's
  // held on purpose, the team's own notes. A stale check (older than the list) isn't shown as checked.
  const F = read(path.join(pm, "state", "psst-final.json")), R = read(path.join(pm, "state", "receipts.json")), TN = read(path.join(pm, "state", "team-next.json"));
  const mt = f => { try { return fs.statSync(path.join(pm, "state", f)).mtimeMs; } catch { return 0; } };
  const checkedFresh = F && mt("psst-final.json") >= mt("lowhanging.json");
  const heldList = (R?.items || []).filter(r => r.gate?.held), heldTitles = new Set(heldList.map(r => r.title));
  const D = nextDecision(pm);
  if (!d && !l && !(b?.findings?.length) && !t?.fields && !D && !TN?.items?.length) return "";
  const css = `<style>
.pmo{display:grid;gap:12px}.pmo-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr));gap:12px}
.pmo-b{background:var(--paper,#fff);border:1px solid var(--line,#d9e0de);border-radius:10px;padding:16px;display:grid;gap:10px;align-content:start;min-width:0}
.pmo-b h3{margin:0}.pmo-m{font-family:var(--mono,ui-monospace,Menlo,monospace);font-size:11.5px;color:var(--muted,#5b6967)}
.pmo-s{overflow-x:auto}.pmo table{border-collapse:collapse;width:100%;font-size:13px}
.pmo th,.pmo td{padding:6px 8px;border-bottom:1px solid var(--line,#d9e0de);text-align:left;vertical-align:top}
.pmo th{font-family:var(--mono,ui-monospace,Menlo,monospace);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#5b6967);white-space:nowrap}
.pmo td.n{font-family:var(--mono,ui-monospace,Menlo,monospace);white-space:nowrap}.pmo tr.pr td{opacity:.6}
.pmo .pmo-k{word-break:break-all}.pmo-t{display:inline-block;font-family:var(--mono,ui-monospace,Menlo,monospace);font-size:10.5px;color:var(--muted,#5b6967);margin-bottom:2px}
.pmo ul{margin:0;padding-left:18px;display:grid;gap:4px;font-size:14px}
</style>`;
  let h = "";
  if (D) h += `<div class="pmo-b"><h3>Next product decision</h3><p><b>${esc(D.title)}</b>${D.size ? ` <span class="pmo-t">${esc(D.size)}</span>` : ""}${D.why ? ` — ${esc(D.why)}` : ""}</p>
<p class="pmo-m">${D.checked ? "Checked against the code by psst's refuter." : "Not checked yet: run psst's check step before committing to it."} The after-commit nudge and <code>/nosy</code> say the same one. Source: ${esc(D.source)}.</p></div>`;
  if (checkedFresh && (F.items?.length || F.dropped?.length)) h += `<div class="pmo-b"><h3>Checked this week</h3><p class="pmo-m">${F.stats?.stands ?? 0} stand · ${F.stats?.weakened ?? 0} corrected · ${F.stats?.refuted ?? 0} dropped after checking${F.stats?.fromReading ? ` · ${F.stats.fromReading} from reading the code` : ""} · generated ${hour(F.generated)}</p>
<ul>${(F.items || []).map(i => `<li><b>${esc(i.title)}</b> <span class="pmo-t">${esc(i.verdict === "weakened" ? `corrected: ${String(i.fix).slice(0, 90)}` : i.size || "")}</span></li>`).join("")}${(F.dropped || []).map(x => `<li><s>${esc(x.title)}</s> <span class="pmo-t">dropped: ${esc(String(x.why).slice(0, 90))}</span></li>`).join("")}</ul></div>`;
  if (heldList.length) h += `<div class="pmo-b"><h3>Held on purpose</h3><p class="pmo-m">The code or a decision parks these; they stay off the cheap list until the owner says otherwise.</p>
<ul>${heldList.slice(0, 8).map(r => `<li>${esc(r.title)} <span class="pmo-t">${esc(r.gate.because.map(x => `${x.at} (${[...x.refs, ...x.decisions].join(", ")})`).join("; ").slice(0, 120))}</span></li>`).join("")}</ul></div>`;
  if (TN?.items?.length) h += `<div class="pmo-b"><h3>On the team's own list</h3><p class="pmo-m">${esc(TN.files.join(", "))} · the latest paragraphs that cite the code · ${esc(TN.found)}</p>
<ul>${TN.items.slice(0, 6).map(i => `<li>${esc(i.title)} <span class="pmo-t">${esc(i.file)}:${i.line} · ${esc(i.date)}</span></li>`).join("")}</ul></div>`;
  if (d) {
    // Every decision/request ref the product uses (sources.json refs), not one product's prefixes: the box used to keep only
    // the first product's K/§/SAH refs, so on any other product it read "no decision-referenced commits". Bare issue numbers stay in the report.
    const gr = d.groups.filter(g => g.ref && g.ref !== "(no ref)" && !/^#\d+$/.test(g.ref)).slice(0, 12);
    h += `<div class="pmo-b"><h3>Delivery</h3><p class="pmo-m">${esc(range(d.range))} · ${d.main} on main, ${d.pr} commits on open PRs · last main <code>${esc(d.lastMain)}</code> · generated ${hour(d.generated)}</p>
${d.prs.length ? `<ul>${d.prs.map(p => `<li><b>#${p.n}</b>${p.draft ? " (draft)" : ""} ${esc(p.t.slice(0, 90))} · ${esc(p.a)} · ${p.count} commits${p.last ? `, last ${esc(p.last)}` : ""}</li>`).join("")}</ul>` : ""}
${gr.length ? `<div class="pmo-s"><table><thead><tr><th>Ref</th><th>Latest topic</th></tr></thead><tbody>${gr.map(g => `<tr><td class="n">${esc(g.ref)}<br><span class="pmo-m">${g.n} · ${esc(g.where.join(", "))}</span></td><td>${esc(g.topic.slice(0, 120))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="pmo-m">No decision- or item-referenced commits in this range.</p>`}
<p class="pmo-m">Decision- and item-referenced groups; issue references and ${d.withoutReference} commits without a reference are in the detailed report.</p></div>`;
  }
  if (l) {
    const top = l.items.filter(m => m.type !== "Warning" && !heldTitles.has(m.title)).slice(0, 10);
    h += `<div class="pmo-b"><h3>Low-hanging fruit${checkedFresh ? " (full list)" : " (unchecked)"}</h3><p class="pmo-m">${esc(l.ref)} · score = value / effort · faded row = in an open PR · generated ${hour(l.generated)}</p>
<div class="pmo-s"><table><thead><tr><th>Score</th><th>Effort</th><th>Work</th></tr></thead><tbody>${top.map(m => `<tr class="${/in PR/.test(m.type) ? "pr" : ""}"><td class="n">${m.score}</td><td class="n">${esc(m.effort || "?")}</td><td><span class="pmo-t">${esc(m.type)}</span><br>${esc(m.title)}${m.evidence ? `<br><span class="pmo-m pmo-k">${esc(String(m.evidence).slice(0, 110))}</span>` : ""}</td></tr>`).join("")}</tbody></table></div>
<p class="pmo-m">${l.items.length ? `The list is evidence; a decision-maker owns what gets done. ${l.items.length} items total.` : `Nothing found this time.${l.empty_why?.length ? ` Missing inputs: ${esc(l.empty_why.join("; "))}.` : ""}`}</p></div>`;
  }
  if (b?.findings?.length) {
    h += `<div class="pmo-b"><h3>May be stale</h3><p class="pmo-m">${esc(b.page || "")} · a hand-written line conflicts with the script's output · generated ${b.generated ? hour(b.generated) : "—"}</p>
<div class="pmo-s"><table><thead><tr><th>Type</th><th>Ref</th><th>Line</th><th>Evidence</th></tr></thead><tbody>${b.findings.map(x => `<tr><td>${esc(x.type)}</td><td class="n">${esc(x.ref)}</td><td class="n">${esc((x.lines || []).join(", "))}</td><td>${esc(String(x.not || "").slice(0, 140))}</td></tr>`).join("")}</tbody></table></div>
<p class="pmo-m">A conflict found by find-stale; the page wasn't changed, the owner fixes the line.</p></div>`;
  }
  if (t?.fields) {
    const o = t.summary;
    h += `<div class="pmo-b"><h3>Design system</h3><p class="pmo-m">${o["ready"]} ready · ${o["partial"]} partial · ${o.missing} missing · ${o.ask} to ask (20 fields) · ${esc(t.date)}</p>
<ul>${(t.plan || []).map(p => `<li><b>${esc(p.area)}</b> · ${esc(p.status)} — missing: ${esc((p.missing || []).join(", "))}</li>`).join("")}</ul>
<p class="pmo-m">Picked by dresscode, what's important right now against the roadmap; detail at pm/design/${esc(t.date)}.md.</p></div>`;
  }
  return `${Head}\n${css}<section id="auto"><div class="sec-head head"><div class="eyebrow lab">Automatic · script output</div><h2>What shipped today, what's cheap</h2><p>This section was written by <code>collect-status</code> and <code>lowhanging</code>; don't edit it by hand, it's refreshed on every run.</p></div><div class="pmo"><div class="pmo-g">${h}</div></div></section>\n${Last}`;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [pm = "pm", page] = process.argv.slice(2);
  if (!page) { console.error("Usage: node auto-section.mjs <pm folder> <page.html>"); process.exit(1); }
  const b = section(pm); if (!b) { console.error(`no data: ${pm}/state/status.json, lowhanging.json, or stale.json`); process.exit(1); }
  let s = fs.readFileSync(page, "utf8"); const i = s.indexOf(Head), j = s.indexOf(Last);
  if (i >= 0 && j > i) s = s.slice(0, i) + b + s.slice(j + Last.length);
  else { const f = s.indexOf("<footer"); if (f < 0) { console.error("no marker and no <footer> either; say where to put the section"); process.exit(1); } s = s.slice(0, f) + b + "\n" + s.slice(f); console.log("no marker, inserted before <footer>"); }
  fs.writeFileSync(page, s); console.log("written:", page);
}
