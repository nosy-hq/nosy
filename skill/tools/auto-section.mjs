// Generates a page section from status and lowhanging results; replaces hand-written "as of" lines.
// Reads: <pm>/state/status.json (collect-status --json), <pm>/state/lowhanging.json (lowhanging --json),
//   <pm>/state/stale.json (find-stale --json) if present and it has findings, a third box "May be stale".
// Usage: node auto-section.mjs <pm folder> <page.html> [--lang <code>]
//   Replaces the content between <!-- pm:auto --> ... <!-- /pm:auto --> on the page; if the marker is missing, inserts it before </footer>.
// build-page.mjs puts the same section into its own page via `section()`.
// Shareable output: this block lands on a page the team, and sometimes Nosy Cloud, reads. It carries
//   titles, counts and the integration branch's own history, never what pm/state knows about one person's unpushed work: no branch
//   or author name, no commit subject from receipts.json / status.json `localBranches`, no psst correction or dropped-item text,
//   no item `detail` lines, no GitHub login. Where the receipts would say more (a decision parks an item, a branch or working tree
//   already has it), the block says how many, nothing else. The next decision shows its title and size only.
// Generation time (language-neutral): the block's wrapper carries `data-generated="<ISO time>"`, so a reader (freshness.mjs)
//   dates the block without parsing month names in any language. The `<!-- pm:auto -->` marker is unchanged, so pages written
//   by an older Nosy (no attribute) are still found and replaced; `generatedOf()` returns null for them and the reader falls back to the text.
// Language: the fixed phrases (headings and sentences) live in skill/data/lang/<code>/auto-section.json,
// English by default. `--lang tr`, else sources.json `language`, picks another; a language with no file falls back to English
// with one line on stderr. `section(pm)` itself stays English (build-page's page is English); `section(pm, { lang })` opts in.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { nextDecision } from "./next-decision.mjs"; import { esc } from "./html-safe.mjs";
import { readSourcesSafe } from "./sources-file.mjs";
const read = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const Head = "<!-- pm:auto -->", Last = "<!-- /pm:auto -->";
// The generation time a block carries (a Date), or null: no attribute (a block from an older Nosy) or one that is not an ISO time.
export const generatedOf = html => {
  const m = /<section\b[^>]*\sdata-generated="(\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:\d{2}))"/.exec(String(html || ""));
  const d = m ? new Date(m[1]) : null; return d && !isNaN(d) ? d : null;
};

// The phrase file of a language code ("tr", "tr-TR"; null or "en" is English). An unknown code is English and says so once.
const phraseFile = code => read(fileURLToPath(new URL(`../data/lang/${code}/auto-section.json`, import.meta.url)));
const warned = new Set();
export function phrases(lang) {
  const code = String(lang || "en").trim().toLowerCase().split(/[-_]/)[0];
  const P = /^[a-z]{2,3}$/.test(code) ? phraseFile(code) : null;
  if (P) return P;
  if (!warned.has(code)) { warned.add(code); console.error(`auto-section: no phrases for language "${lang}" yet (skill/data/lang/${code}/auto-section.json); using English`); }
  return phraseFile("en");
}
// "{name}" slots in a phrase; the caller escapes what it puts in. Missing slots stay empty.
const fill = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");

export function section(pm, { lang, now = new Date() } = {}) {
  const P = phrases(lang), t = (parts, v) => fill(parts.split(".").reduce((o, k) => o[k], P), v);
  const hour = iso => new Date(iso).toLocaleString(P.locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const range = a => { const m = a.match(/^--since (\S+)(?: (\S+))? (\S+)$/); return m ? t("since", { date: new Date(m[1]).toLocaleDateString(P.locale, { day: "numeric", month: "short" }), time: m[2] || "", ref: m[3] }) : a; };
  const gen = when => t("generated", { when });
  // If the owner's feedback exists (learn.mjs apply → lowhanging.filtered.json), the page shows that: a muted item shouldn't return to the page.
  const d = read(path.join(pm, "state", "status.json")), l = read(path.join(pm, "state", "lowhanging.filtered.json")) || read(path.join(pm, "state", "lowhanging.json"));
  const b = read(path.join(pm, "state", "stale.json"));
  const t_ = read(path.join(pm, "state", "dresscode.json")); // design system (dresscode.mjs): one box, a summary of the 20 fields + what's important right now
  // psst's check step: the next decision, what survived the refuter, what's
  // held on purpose, the team's own notes. A stale check (older than the list) isn't shown as checked.
  const F = read(path.join(pm, "state", "psst-final.json")), R = read(path.join(pm, "state", "receipts.json")), TN = read(path.join(pm, "state", "team-next.json"));
  const mt = f => { try { return fs.statSync(path.join(pm, "state", f)).mtimeMs; } catch { return 0; } };
  const checkedFresh = F && mt("psst-final.json") >= mt("lowhanging.json");
  const heldTitles = new Set((R?.items || []).filter(r => r.gate?.held).map(r => r.title)), progressTitles = new Set((R?.items || []).filter(r => r.inProgress).map(r => r.title));
  const D = nextDecision(pm);
  if (!d && !l && !(b?.findings?.length) && !t_?.fields && !D && !TN?.items?.length) return "";
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
  if (D) h += `<div class="pmo-b"><h3>${t("decision.heading")}</h3><p><b>${esc(D.title)}</b>${D.size ? ` <span class="pmo-t">${esc(D.size)}</span>` : ""}</p>
<p class="pmo-m">${D.checked ? t("decision.checked") : t("decision.unchecked")}${t("decision.same")}${t("decision.source", { source: esc(D.source) })}</p></div>`;
  if (checkedFresh && (F.items?.length || F.dropped?.length)) h += `<div class="pmo-b"><h3>${t("checkedList.heading")}</h3><p class="pmo-m">${t("checkedList.stats", { stands: esc(F.stats?.stands ?? 0), weakened: esc(F.stats?.weakened ?? 0), refuted: esc(F.stats?.refuted ?? 0) })}${F.stats?.fromReading ? t("checkedList.fromReading", { n: esc(F.stats.fromReading) }) : ""} · ${gen(hour(F.generated))}</p>
<ul>${(F.items || []).map(i => `<li><b>${esc(i.title)}</b> <span class="pmo-t">${esc(i.verdict === "weakened" ? t("checkedList.corrected") : i.size || "")}</span></li>`).join("")}</ul></div>`;
  if (TN?.items?.length) h += `<div class="pmo-b"><h3>${t("team.heading")}</h3><p class="pmo-m">${t("team.meta", { files: esc(TN.files.join(", ")), found: esc(TN.found) })}</p>
<ul>${TN.items.slice(0, 6).map(i => `<li>${esc(i.title)} <span class="pmo-t">${esc(i.file)}:${esc(i.line)} · ${esc(i.date)}</span></li>`).join("")}</ul></div>`;
  if (d) {
    // Every decision/request ref the product uses (sources.json refs), not one product's prefixes: the box used to keep only
    // the first product's K/§/SAH refs, so on any other product it read "no decision-referenced commits". Bare issue numbers stay in the report.
    const gr = d.groups.filter(g => g.ref && g.ref !== "(no ref)" && !/^#\d+$/.test(g.ref)).slice(0, 12);
    h += `<div class="pmo-b"><h3>${t("delivery.heading")}</h3><p class="pmo-m">${t("delivery.meta", { range: esc(range(d.range)), main: esc(d.main), pr: esc(d.pr), lastMain: esc(d.lastMain), generated: gen(hour(d.generated)) })}</p>
${d.prs.length ? `<ul>${d.prs.map(p => `<li><b>#${esc(p.n)}</b>${p.draft ? t("delivery.draft") : ""} ${esc(p.t.slice(0, 90))} · ${t("delivery.commits", { count: esc(p.count) })}${p.last ? t("delivery.last", { last: esc(p.last) }) : ""}</li>`).join("")}</ul>` : ""}
${gr.length ? `<div class="pmo-s"><table><thead><tr><th>${t("delivery.ref")}</th><th>${t("delivery.topic")}</th></tr></thead><tbody>${gr.map(g => `<tr><td class="n">${esc(g.ref)}<br><span class="pmo-m">${esc(g.n)} · ${esc(g.where.join(", "))}</span></td><td>${esc(g.topic.slice(0, 120))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="pmo-m">${t("delivery.none")}</p>`}
<p class="pmo-m">${t("delivery.note", { n: esc(d.withoutReference) })}</p></div>`;
  }
  if (l) {
    const top = l.items.filter(m => m.type !== "Warning" && !heldTitles.has(m.title)).slice(0, 10);
    // Only how many, never which or where: what the receipts know about an item (a held decision, a branch, a working tree) stays in pm/state.
    const parkedN = l.items.filter(m => heldTitles.has(m.title)).length, inProgressN = l.items.filter(m => progressTitles.has(m.title) && !heldTitles.has(m.title)).length;
    const counts = `${parkedN ? t("cheap.parked", { n: esc(parkedN) }) : ""}${inProgressN ? t("cheap.inProgress", { n: esc(inProgressN) }) : ""}`;
    h += `<div class="pmo-b"><h3>${t("cheap.heading")}${checkedFresh ? t("cheap.full") : t("cheap.unchecked")}</h3><p class="pmo-m">${t("cheap.meta", { ref: esc(l.ref), generated: gen(hour(l.generated)) })}</p>
<div class="pmo-s"><table><thead><tr><th>${t("cheap.score")}</th><th>${t("cheap.effort")}</th><th>${t("cheap.work")}</th></tr></thead><tbody>${top.map(m => `<tr class="${/in PR/.test(m.type) ? "pr" : ""}"><td class="n">${esc(m.score)}</td><td class="n">${esc(m.effort || "?")}</td><td><span class="pmo-t">${esc(m.type)}</span><br>${esc(m.title)}${m.evidence && m.type !== "Issue opened against us" ? `<br><span class="pmo-m pmo-k">${esc(String(m.evidence).slice(0, 110))}</span>` : ""}</td></tr>`).join("")}</tbody></table></div>
<p class="pmo-m">${l.items.length ? t("cheap.total", { n: esc(l.items.length) }) + counts : `${t("cheap.nothing")}${l.empty_why?.length ? t("cheap.missing", { why: esc(l.empty_why.join("; ")) }) : ""}`}</p></div>`;
  }
  if (b?.findings?.length) {
    h += `<div class="pmo-b"><h3>${t("stale.heading")}</h3><p class="pmo-m">${t("stale.meta", { page: esc(b.page || ""), generated: gen(b.generated ? hour(b.generated) : "—") })}</p>
<div class="pmo-s"><table><thead><tr><th>${t("stale.type")}</th><th>${t("stale.ref")}</th><th>${t("stale.line")}</th><th>${t("stale.evidence")}</th></tr></thead><tbody>${b.findings.map(x => `<tr><td>${esc(x.type)}</td><td class="n">${esc(x.ref)}</td><td class="n">${esc((x.lines || []).join(", "))}</td><td>${esc(String(x.not || "").slice(0, 140))}</td></tr>`).join("")}</tbody></table></div>
<p class="pmo-m">${t("stale.note")}</p></div>`;
  }
  if (t_?.fields) {
    const o = t_.summary;
    h += `<div class="pmo-b"><h3>${t("design.heading")}</h3><p class="pmo-m">${t("design.meta", { ready: esc(o["ready"]), partial: esc(o["partial"]), missing: esc(o.missing), ask: esc(o.ask), date: esc(t_.date) })}</p>
<ul>${(t_.plan || []).map(p => `<li>${t("design.item", { area: esc(p.area), status: esc(p.status), missing: esc((p.missing || []).join(", ")) })}</li>`).join("")}</ul>
<p class="pmo-m">${t("design.note", { date: esc(t_.date) })}</p></div>`;
  }
  return `${Head}\n${css}<section id="auto" data-generated="${now.toISOString()}"><div class="sec-head head"><div class="eyebrow lab">${t("eyebrow")}</div><h2>${t("title")}</h2><p>${t("intro")}</p></div><div class="pmo"><div class="pmo-g">${h}</div></div></section>\n${Last}`;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), li = argv.indexOf("--lang"), flagLang = li >= 0 ? argv.splice(li, 2)[1] : null;
  const [pm = "pm", page] = argv;
  if (!page || (li >= 0 && !flagLang)) { console.error("Usage: node auto-section.mjs <pm folder> <page.html> [--lang <code>]"); process.exit(1); }
  const b = section(pm, { lang: flagLang || readSourcesSafe(pm)?.language }); if (!b) { console.error(`no data: ${pm}/state/status.json, lowhanging.json, or stale.json`); process.exit(1); }
  let s = fs.readFileSync(page, "utf8"); const i = s.indexOf(Head), j = s.indexOf(Last);
  if (i >= 0 && j > i) s = s.slice(0, i) + b + s.slice(j + Last.length);
  else { const f = s.indexOf("<footer"); if (f < 0) { console.error("no marker and no <footer> either; say where to put the section"); process.exit(1); } s = s.slice(0, f) + b + "\n" + s.slice(f); console.log("no marker, inserted before <footer>"); }
  fs.writeFileSync(page, s); console.log("written:", page);
}
