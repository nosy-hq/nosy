// One command to check a decision page (BlogFactory field test: tea told the agent to "lint the script, run node --check, confirm row and cell counts with a DOM
// stub", and `node --check page.html` can't read HTML, so every agent improvised, and a page with the product's own column missing passed all of it).
//   1. the page is there (where sources.json or product.md says, else pm/page.html)
//   2. every inline <script> parses (checked, never run)
//   3. the data the page draws: steps, products, our own column. A page with rows but no own-product column would show "0 done" for the product itself.
//   4. hand-written lines that went stale (find-stale.mjs)
//   5. the privacy scan (privacy-scan.mjs): a secret or personal data in a page that is about to be shared
// Usage: node page-validate.mjs <pm> [--page <file>] [--json <file>]
// Exit: 0 every check passed · 2 something needs a look (it is listed, with the line or count) · 1 the page or pm folder isn't there.
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm"; import { spawnSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { pagePath } from "./page-path.mjs"; import { readSourcesSafe } from "./sources-file.mjs";

const Tool = path.dirname(fileURLToPath(import.meta.url));
const lineOf = (html, index) => html.slice(0, index).split("\n").length;

export function validate(pm, { page: pageArg = null } = {}) {
  const K = readSourcesSafe(pm), found = pagePath(pm, K, { explicit: pageArg }), checks = [], add = (name, ok, detail, extra = {}) => checks.push({ name, ok, detail, ...extra });
  if (!fs.existsSync(pm)) return { error: `no pm folder at ${pm}`, checks };
  if (!found.exists) return { error: `no page at ${found.path} (${found.source}); build it with \`nosy page\` or pass --page <file>`, checks };
  const html = fs.readFileSync(found.path, "utf8");
  add("page", true, `${path.relative(process.cwd(), found.path) || found.path}, ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB (${found.source})`);

  // 2. inline scripts: parsed, not run. A JSON data block (type="application/json" and the like) is parsed as JSON.
  const bad = []; let scripts = 0, data = null;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    const type = (m[1].match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "";
    const at = lineOf(html, m.index);
    if (/json/i.test(type)) { scripts++; try { JSON.parse(m[2]); } catch (e) { bad.push(`line ${at}: invalid JSON (${String(e.message).split("\n")[0]})`); } continue; }
    if (type && !/javascript|module|ecmascript/i.test(type)) continue;
    scripts++;
    try { new vm.Script(m[2], { filename: "page.html" }); } catch (e) { bad.push(`script at line ${at}: ${String(e.message).split("\n")[0]}`); }
    const d = m[2].match(/\bconst\s+D\s*=\s*(\{[\s\S]*?\});\s*(?:\n|$)/); // build-page's data: const D={…};
    if (d && !data) { try { data = JSON.parse(d[1]); } catch { /* a hand-built page keeps its data its own way */ } }
  }
  add("scripts parse", !bad.length, bad.length ? bad.join("; ") : `${scripts} inline script${scripts === 1 ? "" : "s"} parse`, bad.length ? { problems: bad } : {});

  // 3. the data, when the page is one Nosy built
  if (data && typeof data === "object") {
    const steps = Array.isArray(data.steps) ? data.steps.length : 0, products = Array.isArray(data.products) ? data.products.length : 0;
    const problems = [];
    if (!steps) problems.push("no steps (the matrix has no rows)");
    if (steps && data.biz == null) problems.push(`${steps} steps but no column for your own product: the page would show it with 0 done (pm/matrix.json has biz: null)`);
    if (data.biz && steps) { const have = Object.keys(data.biz.codes || {}).length; if (!have) problems.push("our own column has no codes"); }
    add("data", !problems.length, problems.length ? problems.join("; ") : `${steps} steps × ${products} rival${products === 1 ? "" : "s"}${data.biz ? " + our own column" : ""}`, problems.length ? { problems } : {});
  } else add("data", true, "no Nosy data block (a hand-built page): not checked");

  // 4. stale hand-written lines
  const tmp = path.join(path.dirname(found.path), `.nosy-stale-${process.pid}.json`);
  const st = spawnSync(process.execPath, [path.join(Tool, "find-stale.mjs"), pm, found.path, "--json", tmp], { encoding: "utf8", maxBuffer: 32 << 20, cwd: process.cwd() });
  let stale = null; try { stale = JSON.parse(fs.readFileSync(tmp, "utf8")); } catch { /* not written */ } try { fs.rmSync(tmp, { force: true }); } catch { /* fine */ }
  const staleN = stale ? (stale.findings || stale.items || []).length : null, unchecked = stale && Array.isArray(stale.unchecked) ? stale.unchecked : [];
  if (staleN === 0 && unchecked.length) add("stale lines", true, `none found, but ${unchecked.length} PR status check${unchecked.length === 1 ? "" : "s"} could not run (gh unavailable or no issue.repo): ${unchecked.map(n => `#${n}`).join(", ")}`, { skipped: true });
  else if (st.status !== 0 && st.status !== 2 && staleN === null) add("stale lines", true, "not checked (find-stale couldn't run: " + String((st.stderr || st.stdout || "").trim().split("\n")[0] || "no output").slice(0, 120) + ")", { skipped: true });
  else add("stale lines", !staleN, staleN ? `${staleN} possibly stale line${staleN === 1 ? "" : "s"}: node find-stale.mjs ${pm} ${found.path}` : "none found");

  // 5. privacy scan
  const ps = spawnSync(process.execPath, [path.join(Tool, "privacy-scan.mjs"), found.path, "--pm", pm], { encoding: "utf8", maxBuffer: 32 << 20 });
  if (ps.status === 0) add("privacy scan", true, "no secret or personal data found");
  else if (ps.status === 2) add("privacy scan", false, "a secret or personal data is in the page: " + (ps.stdout || "").split("\n").filter(l => /\|/.test(l)).slice(0, 3).join(" · ").slice(0, 300), { output: ps.stdout });
  else add("privacy scan", true, "not checked (the scan couldn't run)", { skipped: true });
  return { page: found.path, source: found.source, checks };
}

export function render(R) {
  if (R.error) return `Psst… ${R.error}`;
  return [`# Page check · ${R.page}`, "", ...R.checks.map(c => `${c.skipped ? "–" : c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`)].join("\n");
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const jsonOut = take("--json"), pageArg = take("--page"), pm = argv[0] || "pm";
  const R = validate(pm, { page: pageArg });
  if (jsonOut) { fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(R, null, 1)); }
  console.log(render(R));
  process.exitCode = R.error ? 1 : R.checks.some(c => !c.ok) ? 2 : 0;
}
