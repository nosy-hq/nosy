// fields (the cheap version): which fields one type carries and the next one drops.
// Plain Claude's winning pick in psst blind test v4 was this shape: a real product's `readiness.Readiness` carries
// `ConnectionID`, the `errs.ErrorItem` the refusal becomes carries Message, Action and OwnerRequired but not
// ConnectionID, so the screen can't say which connection to fix. A repo-wide scanner for it would flood psst with
// fields that are dropped on purpose (the refuter sized that at L), so this is a lens, not a signal: the agent names
// the two types while drafting or refuting an item, and gets the fields each has, with file:line.
// Usage: node fields.mjs <repo> <From> <To> [--ref HEAD] [--json]
//   <From>/<To>: a type name (`Readiness`), or `pkg.Type` / `path-part:Type` when the name is defined more than once.
// Reads Go structs (`type X struct {…}`, json tags) and TypeScript interfaces / object types (`interface X {…}`,
// `type X = {…}`) at the ref, via git; nothing else. Names match across case and `_`/`-` (ConnectionID = connection_id),
// and a Go field matches by its json tag too.
import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";

const git = (repo, args) => { try { return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
export const norm = s => String(s || "").toLowerCase().replace(/[_-]/g, "");

// Every definition of `name` at the ref: [{ file, line, lang }].
export function definitions(repo, name, ref = "HEAD") {
  const [scope, bare] = name.includes(":") ? name.split(/:(?=[^:]+$)/) : name.includes(".") ? name.split(/\.(?=[^.]+$)/) : [null, name];
  // POSIX classes only: git grep -E has no \s or \b on every build.
  const S = "[[:space:]]", E = "([^A-Za-z0-9_]|$)";
  const re = `^${S}*(type${S}+${bare}${S}+struct${E}|(export${S}+)?(declare${S}+)?interface${S}+${bare}${E}|(export${S}+)?type${S}+${bare}${S}*(<[^=]*>)?${S}*=${S}*\\{)`;
  const out = git(repo, ["grep", "-n", "-E", re, ref, "--", "*.go", "*.ts", "*.tsx"]);
  return out.split("\n").filter(Boolean).map(l => { const m = l.match(/^[^:]+:(.+?):(\d+):/); return m && { file: m[1], line: +m[2], lang: /\.go$/.test(m[1]) ? "go" : "ts" }; })
    .filter(d => d && !/(^|\/)(node_modules|vendor|dist)\//.test(d.file) && (!scope || d.file.includes(scope) || d.file.split("/").slice(-2, -1)[0] === scope));
}

// The fields of the type defined at file:line: [{ name, tag, line }].
export function fieldsAt(repo, def, ref = "HEAD") {
  const lines = git(repo, ["show", `${ref}:${def.file}`]).split("\n");
  const out = []; let depth = 0;
  for (let i = def.line - 1; i < lines.length; i++) {
    const raw = lines[i], t = raw.replace(/\/\/.*$/, "").trim();
    const opens = (t.match(/\{/g) || []).length, closes = (t.match(/\}/g) || []).length;
    if (i > def.line - 1 && depth === 1 && t) {
      if (def.lang === "go") {
        const m = t.match(/^([A-Z_a-z][\w]*(?:\s*,\s*[A-Za-z_]\w*)*)\s+[^\s]/); // `Name Type`, `A, B Type`; an embedded type has no second word
        if (m) { const tag = (raw.match(/json:"([^",]+)/) || [])[1] || null; for (const n of m[1].split(/\s*,\s*/)) if (tag !== "-") out.push({ name: n, tag, line: i + 1 }); }
      } else {
        const m = t.match(/^(readonly\s+)?["']?([A-Za-z_$][\w$-]*)["']?\??\s*:/);
        if (m) out.push({ name: m[2], tag: null, line: i + 1 });
      }
    }
    depth += opens - closes;
    if (i > def.line - 1 && depth <= 0) break;
    if (i === def.line - 1 && !opens) break; // not a brace body
  }
  return out;
}

export function compare(repo, from, to, ref = "HEAD") {
  const side = n => { const defs = definitions(repo, n, ref); return { name: n, defs, def: defs[0] || null, fields: defs[0] ? fieldsAt(repo, defs[0], ref) : [] }; };
  const A = side(from), B = side(to);
  const keys = f => [norm(f.name), f.tag && norm(f.tag)].filter(Boolean);
  const inB = new Set(B.fields.flatMap(keys)), inA = new Set(A.fields.flatMap(keys));
  const where = (S, f) => `${S.def.file}:${f.line}`;
  return {
    type: "fields", ref, from: { name: from, at: A.def && `${A.def.file}:${A.def.line}`, also: A.defs.slice(1).map(d => `${d.file}:${d.line}`) },
    to: { name: to, at: B.def && `${B.def.file}:${B.def.line}`, also: B.defs.slice(1).map(d => `${d.file}:${d.line}`) },
    carried: A.def && B.def ? A.fields.filter(f => keys(f).some(k => inB.has(k))).map(f => ({ name: f.name, at: where(A, f) })) : [],
    dropped: A.def && B.def ? A.fields.filter(f => !keys(f).some(k => inB.has(k))).map(f => ({ name: f.name, at: where(A, f) })) : [],
    added: A.def && B.def ? B.fields.filter(f => !keys(f).some(k => inA.has(k))).map(f => ({ name: f.name, at: where(B, f) })) : [],
  };
}

export function render(R) {
  if (!R.from.at || !R.to.at) return `No definition found for ${[!R.from.at && R.from.name, !R.to.at && R.to.name].filter(Boolean).join(" and ")} at ${R.ref} (Go structs and TypeScript interfaces/object types only).`;
  const list = xs => xs.length ? xs.map(x => `${x.name} (${x.at})`).join(", ") : "none";
  let o = `${R.from.name} (${R.from.at}) → ${R.to.name} (${R.to.at})\n`;
  o += `  carried: ${list(R.carried)}\n  dropped: ${list(R.dropped)}\n  only in ${R.to.name}: ${list(R.added)}\n`;
  for (const s of [R.from, R.to]) if (s.also.length) o += `  ${s.name} is also defined at ${s.also.slice(0, 3).join(", ")}: name it as path-part:${s.name} to pick another.\n`;
  if (R.carried.length && R.dropped.length) o += `A dropped field is a lead, not a finding: most are dropped on purpose. Check whether the screen needs it (psst: cite both lines; the refuter checks the same).\n`;
  return o;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const pos = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1] === "--ref"));
  if (pos.length < 3) { console.error("usage: fields.mjs <repo> <From> <To> [--ref HEAD] [--json]"); process.exit(1); }
  const R = compare(pos[0], pos[1], pos[2], opt("--ref") || "HEAD");
  console.log(argv.includes("--json") ? JSON.stringify(R, null, 1) : render(R));
  process.exit(R.from.at && R.to.at ? 0 : 2);
}
