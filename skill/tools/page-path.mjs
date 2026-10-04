// Where the decision page lives (BlogFactory field test, 3 Oct 2026). Four commands each guessed: SKILL.md told a non-Claude agent to write
// pm/status-page.html, tea.md said pm/page.html, `next` and `tour` looked only at pm/page.html, and `freshness` read the "Page:" line of
// product.md only under its old Turkish label and joined a repo-relative "pm/status-page.html" onto pm/ a second time. So a page that existed and
// passed every check was reported as "no page yet". Everything now asks here.
//   order: an explicit path · sources.json `page` · the "Page:" line of product.md · pm/page.html · pm/status-page.html · (nothing yet: pm/page.html)
//   returns { path, source, exists, configured }: `configured` is true when the owner named it (sources.json or product.md), so a command that
//   builds the page writes where the owner said and not beside it.
// A relative path is tried against the pm folder first (sources.json `page: "page.html"`), then against the folder above it (product.md says
// `pm/status-page.html`, which is repo-relative).
import fs from "node:fs"; import path from "node:path";

const read = f => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
const isUrl = s => /^[a-z][a-z0-9+.-]*:\/\//i.test(s);

function at(pm, p) {
  if (path.isAbsolute(p)) return p;
  const root = path.resolve(pm), byPm = path.join(root, p), byRepo = path.resolve(path.dirname(root), p);
  if (fs.existsSync(byPm)) return byPm;
  if (fs.existsSync(byRepo)) return byRepo;
  return p.replace(/\\/g, "/").startsWith(`${path.basename(root)}/`) ? byRepo : byPm; // not there yet: "pm/…" means repo-relative
}

// The path in the product file's line labeled "Page" (or its old Turkish label "Sayfa"); other lines that happen to mention a .html don't count.
export function pageFromProduct(pm) {
  const text = read(path.join(pm, "product.md")) || read(path.join(pm, "urun.md"));
  const line = (text.match(/^\s*[-*]\s*\*\*\s*(?:Page|Sayfa)\s*:?\s*\*\*\s*:?.*$/mi) || [""])[0];
  const m = line.match(/`?([^\s`()<>"']+\.html?)`?/i);
  return m && !isUrl(m[1]) ? m[1] : null;
}

export function pagePath(pm, K = null, { explicit = null } = {}) {
  const pick = (p, source, configured) => { const full = at(pm, p); return { path: full, source, exists: fs.existsSync(full), configured }; };
  if (explicit) return pick(explicit, "argument", true);
  if (K && typeof K.page === "string" && K.page.trim() && !isUrl(K.page)) return pick(K.page.trim(), "sources.json page", true);
  const fromProduct = pageFromProduct(pm);
  if (fromProduct) return pick(fromProduct, "product.md Page line", true);
  for (const name of ["page.html", "status-page.html"]) { const f = path.join(pm, name); if (fs.existsSync(f)) return { path: f, source: `pm/${name}`, exists: true, configured: false }; }
  return { path: path.join(pm, "page.html"), source: "default", exists: false, configured: false };
}

// Is this HTML a page Nosy built (`nosy page`)? A page the owner made by hand (or one
// `page-adopt` marked) has neither: `nosy page` must never write over that (BlogFactory field test, hunt: it replaced a hand-built page with a 17 KB Nosy page, no backup).
// Its data block (`const D={"steps":…}`, present even when the matrix is empty) or its footer signature. A page with neither is the owner's.
export const builtByNosy = html => /\bconst\s+D\s*=\s*\{\s*"steps"/.test(html) || /by Nosy\. Nosy was here/.test(html);
