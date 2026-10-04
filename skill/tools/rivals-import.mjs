// rivals-import: rival research that already exists outside pm/rivals (the first run on a real product kept it in
// references/<name>/competitive-*.md) is copied into pm/rivals/<slug>.md, so every tool that reads pm/rivals (the matrix build, the watch,
// the tiers, the page) works on it without learning a second layout. Copies, never moves: the original stays where the team keeps it.
// Which folder: sources.json `rivalsPath` (find-sources proposes it; the owner confirms), or --from <folder>. Which files: the rival-shaped ones
// (sources-file.mjs rivalDoc: the template's own headings or a matrix table, by structure). The slug is the parent folder's name when the file
// is nested (references/leagle/competitive-2026-09.md → leagle), else the file's own name; a slug that already exists in pm/rivals is never
// overwritten (it is listed as "already there"), and two files for one slug get -2, -3.
// Usage: node rivals-import.mjs <pm> [--from <folder>] [--dry-run]
// Exit: 0 ran · 1 no folder to read from · 2 markdown files were there but none was rival-shaped (each is listed with why).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { readSourcesSafe, rivalsDir, rivalFiles, rivalDocWhy, markdownFiles, markdownSlug } from "./sources-file.mjs";

// A file-system slug: ASCII, lower case, accents folded ("Çelik Hukuk" → "celik-hukuk", "Müller" → "muller"), anything else a dash. A name with no
// Latin letter at all (a title in another script) becomes "rival", then rival-2, rival-3: never an empty name, never a clash.
const slugBase = name => String(name).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/İ/g, "i").replace(/ß/g, "ss").replace(/[øØ]/g, "o").replace(/[æÆ]/g, "ae")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "rival";
// `taken` holds lower-case names: on macOS and Windows "Acme.md" and "acme.md" are one file, so the comparison ignores case (a copy must never overwrite).
const baseSlug = rel => { const parts = rel.split("/"), base = parts[parts.length - 1].replace(/\.md$/i, ""); return slugBase(parts.length > 1 ? parts[parts.length - 2] : base); };
const slugOf = (rel, taken) => {
  const s = baseSlug(rel);
  if (!taken.has(s)) return s;
  for (let n = 2; ; n++) if (!taken.has(`${s}-${n}`)) return `${s}-${n}`;
};
const same = (a, b) => { try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch { return false; } };

// Plans (and, unless dry, does) the copy. Returns { from, files: [{ from, slug, state: "copied"|"would copy"|"already there" }] }.
export function importRivals(pm, { from, dry = false } = {}) {
  const K = readSourcesSafe(pm) || {}, src = from ? path.resolve(from) : rivalsDir(pm, K), dest = path.join(pm, "rivals");
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) return { from: src, error: `no folder at ${src}` };
  if (path.resolve(src) === path.resolve(dest)) return { from: src, files: [], same: true };
  const taken = new Set(fs.existsSync(dest) ? fs.readdirSync(dest).map(f => markdownSlug(f).toLowerCase()) : []), files = [];
  const copiedFrom = new Map(); // slug -> source, so a second run recognises its own copies
  try { for (const l of fs.readFileSync(path.join(dest, ".imported"), "utf8").split("\n")) { const [slug, rel] = l.split("\t"); if (slug && rel) copiedFrom.set(rel, slug); } } catch {}
  const found = rivalFiles(src, { nested: true });
  // Nothing qualified: say what was looked at and why each file was passed over, instead of "nothing to import".
  if (!found.length) {
    const skipped = markdownFiles(src).slice(0, 12).map(rel => { let why = "unreadable"; try { why = rivalDocWhy(fs.readFileSync(path.join(src, rel), "utf8")) || why; } catch { /* keep the generic reason */ } return { from: rel, why }; });
    return { from: src, files: [], skipped };
  }
  for (const rel of found) {
    const known = copiedFrom.get(rel);
    if (known && fs.existsSync(path.join(dest, `${known}.md`))) { files.push({ from: rel, slug: known, state: "already there" }); continue; }
    // The same bytes already sit under that name (copied by hand earlier, or by a run whose log was lost): that is the copy, not a second rival.
    const first = baseSlug(rel);
    if (taken.has(first) && same(path.join(src, rel), path.join(dest, `${first}.md`))) { files.push({ from: rel, slug: first, state: "already there" }); continue; }
    const slug = slugOf(rel, taken); taken.add(slug);
    files.push({ from: rel, slug, state: dry ? "would copy" : "copied" });
    if (!dry) {
      fs.mkdirSync(dest, { recursive: true });
      // The copy keeps the original's modification time: a file's age is how long ago the research was done, and a copy made today would read as fresh.
      // COPYFILE_EXCL: if the name appeared since the listing above, this fails instead of overwriting.
      const from = path.join(src, rel), to = path.join(dest, `${slug}.md`);
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      try { const st = fs.statSync(from); fs.utimesSync(to, st.atime, st.mtime); } catch {}
      copiedFrom.set(rel, slug);
    }
  }
  if (!dry && files.some(f => f.state === "copied")) fs.writeFileSync(path.join(dest, ".imported"), [...copiedFrom].map(([rel, slug]) => `${slug}\t${rel.replace(/[\t\r\n]/g, " ")}`).join("\n") + "\n");
  return { from: src, files };
}

export function render(R, pm) {
  if (R.error) return `Psst… ${R.error}. Name the folder with --from <folder>, or set \`rivalsPath\` in ${path.join(pm, "sources.json")}.`;
  if (R.same) return "The rival folder is pm/rivals itself: nothing to import.";
  if (!R.files.length) {
    const look = (R.skipped || []).map(x => `  - ${x.from}: ${x.why}`);
    return [`Nothing imported: no rival-shaped markdown file under ${R.from}${look.length ? ` (${look.length} markdown file${look.length === 1 ? "" : "s"} looked at)` : " (it holds no markdown file)"}.`, ...look,
      "", "A file counts as a rival file when it has the template's own headings (\"Latest major announcement\" or \"Position relative to\") or a feature table with a column of the codes y p n u d (y yes, p partial, n no, u not found, d announced), at least 3 of them. Nosy's template is skill/templates/rival.md; recode or copy the tables into it, then run this again."].join("\n");
  }
  const n = s => R.files.filter(f => f.state === s).length;
  return [`${R.files.length} rival file${R.files.length === 1 ? "" : "s"} under ${R.from} (copies; the originals stay):`, ...R.files.map(f => `  ${f.state === "already there" ? "=" : "→"} ${f.from} → pm/rivals/${f.slug}.md${f.state === "already there" ? " (already there)" : f.state === "would copy" ? " (would copy)" : ""}`),
    "", `${n("copied") + n("would copy")} ${n("would copy") ? "to copy" : "copied"}, ${n("already there")} already there. \`nosy neighbors\` (or \`nosy watch\`) takes it from here; a rival file still needs its feature table for the matrix.`].join("\n");
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; }, dry = (() => { const i = argv.indexOf("--dry-run"); if (i >= 0) argv.splice(i, 1); return i >= 0; })();
  const from = take("--from"), pm = argv[0] || "pm", R = importRivals(pm, { from, dry });
  console.log(render(R, pm)); process.exitCode = R.error ? 1 : (R.skipped && R.skipped.length ? 2 : 0); // 2: markdown was there, none of it was importable
}
