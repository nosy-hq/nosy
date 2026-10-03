// atlas-seed: per-country facts from a registry file, counted without a model (the seed of `atlas`, step 2).
// A registry is a public list of data sources by country. The one this reads today is the Legal Data Hunter status file
// (profile `legal-data-hunter`: { generated_at, summary, sources: [{ id, country, status, data_types, auth, url, notes,
// indexing: { case_law_rows, legislation_rows } }] }). The agent fetches the file once; this script only reads a local copy and
// never opens a connection. Counting here, judgment in the scout: it prints facts and says what they are not.
//   Per country: sources, complete, blocked, open (complete and no key needed), case-law rows, legislation rows, the biggest
//   complete sources, why the blocked case-law ones are blocked, and hosts shared by two or more sources that carry rows.
// What the numbers are not: the registry's own counts, unverified; the same rows can sit under several sources (one court's API
// mirrored under other names), which is why shared hosts are flagged, not added up or removed; "complete" is a collection
// status, never a licence (the registry file's own licence is not stated in it either).
// Usage: node atlas-seed.mjs <registry.json> [CC CC …] [--profile legal-data-hunter] [--top 40] [--json <file>]
//        no country codes: the countries with the most rows, at most --top.
// Exit: 0 read · 1 the file isn't a registry this knows how to read, or it can't be read.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

export const PROFILES = ["legal-data-hunter"];
export const CAVEATS = [
  "These are the registry's own counts, not checked.",
  "Rows can repeat across sources that read the same API (hosts shared by two or more sources are flagged); the totals are not unique records.",
  "\"complete\" says the collection finished, not that you may use the data: read each source's own terms.",
];
const num = x => Number(x) > 0 ? Number(x) : 0;
const rowsOf = s => ({ caseLaw: num(s?.indexing?.case_law_rows), legislation: num(s?.indexing?.legislation_rows) });
const total = s => { const r = rowsOf(s); return r.caseLaw + r.legislation; };
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };
const shortId = id => String(id ?? "").split("/").pop();
const fmt = n => Math.round(n).toLocaleString("en-US");

export function read(file) {
  let d;
  try { d = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")); } catch (e) { throw new Error(`can't read ${file}: ${e.code === "ENOENT" ? "no such file" : "not valid JSON"}`); }
  if (!d || !Array.isArray(d.sources) || !d.sources.every(s => s && typeof s === "object" && "country" in s && "status" in s))
    throw new Error(`${file} isn't a registry I know: expected { sources: [{ country, status, … }] } (profile legal-data-hunter)`);
  return d;
}

// summarize(d, { countries, top }) → { generated_at, summary, caveats, countries: [...] }
export function summarize(d, { countries = [], top = 40 } = {}) {
  const by = new Map();
  for (const s of d.sources) { const c = String(s.country ?? "").toUpperCase() || "??"; if (!by.has(c)) by.set(c, []); by.get(c).push(s); }
  const wanted = countries.map(c => c.toUpperCase());
  const order = wanted.length ? wanted : [...by.keys()].sort((a, b) => by.get(b).reduce((n, s) => n + total(s), 0) - by.get(a).reduce((n, s) => n + total(s), 0)).slice(0, top);
  const out = order.map(c => {
    const ss = by.get(c) ?? [], ok = ss.filter(s => s.status === "complete");
    const hosts = new Map();
    for (const s of ss) { const h = hostOf(s.url); if (h && total(s)) hosts.set(h, [...(hosts.get(h) ?? []), s]); }
    return {
      country: c, listed: ss.length > 0, sources: ss.length, complete: ok.length, blocked: ss.filter(s => s.status === "blocked").length,
      open: ok.filter(s => s.auth == null || s.auth === "none").length,
      caseLawRows: ss.reduce((n, s) => n + rowsOf(s).caseLaw, 0), legislationRows: ss.reduce((n, s) => n + rowsOf(s).legislation, 0),
      top: ok.filter(total).sort((a, b) => total(b) - total(a)).slice(0, 3).map(s => ({ id: shortId(s.id), rows: total(s) })),
      blockedCaseLaw: ss.filter(s => s.status === "blocked" && (s.data_types ?? []).includes("case_law")).slice(0, 2).map(s => ({ id: shortId(s.id), note: String(s.notes ?? "").slice(0, 80) })),
      sharedHosts: [...hosts].filter(([, v]) => v.length > 1).map(([host, v]) => ({ host, sources: v.map(s => shortId(s.id)), rows: v.reduce((n, s) => n + total(s), 0) })),
    };
  });
  return { generated_at: d.generated_at ?? null, summary: d.summary ?? null, caveats: CAVEATS, countries: out };
}

export function render(r) {
  const L = [`registry generated_at=${r.generated_at ?? "unknown"}${r.summary ? ` total=${r.summary.total} complete=${r.summary.complete} blocked=${r.summary.blocked}` : ""}`, ""];
  for (const c of r.caveats) L.push(`Not: ${c}`);
  L.push("", "country | complete/sources | open (no key) | case-law rows | legislation rows | biggest sources | blocked case-law, why | hosts shared by 2+ sources");
  for (const c of r.countries) {
    if (!c.listed) { L.push(`${c.country} | not listed in this registry`); continue; }
    L.push([c.country, `${c.complete}/${c.sources}`, c.open, fmt(c.caseLawRows), fmt(c.legislationRows),
      c.top.map(t => `${t.id} (${fmt(t.rows)})`).join(", ") || "-",
      c.blockedCaseLaw.map(b => `${b.id}: ${b.note || "no reason given"}`).join("; ") || "-",
      c.sharedHosts.map(h => `${h.host} (${h.sources.join(" + ")}, ${fmt(h.rows)} rows)`).join("; ") || "-"].join(" | "));
  }
  return L.join("\n");
}

function main(argv) {
  const al = n => { const i = argv.indexOf(n); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const profile = al("--profile") ?? PROFILES[0], top = Number(al("--top") ?? 40), jsonFile = al("--json");
  const [file, ...codes] = argv;
  if (!file || !PROFILES.includes(profile) || !(top > 0)) { console.error(`Usage: atlas-seed.mjs <registry.json> [CC …] [--profile ${PROFILES.join("|")}] [--top N] [--json file]`); return 1; }
  let r;
  try { r = summarize(read(file), { countries: codes, top }); } catch (e) { console.error(`Psst… ${e.message}`); return 1; }
  console.log(render(r));
  if (jsonFile) { fs.mkdirSync(path.dirname(path.resolve(jsonFile)), { recursive: true }); fs.writeFileSync(jsonFile, JSON.stringify({ profile, ...r }, null, 1) + "\n"); console.log(`\nWrote ${jsonFile}`); }
  return 0;
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
