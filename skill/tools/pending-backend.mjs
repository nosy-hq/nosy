// pending-backend: psst's other direction. "Backend ready, no screen" had a mirror nobody
// looked at: a screen that's built and waiting for the backend. That's often the cheapest valuable work there is (the
// UI, copy and design are done; one endpoint or field ships it), and it's what plain Claude found in blind test v4
// (the first product's <PendingBackend label="Önceki döneme göre karşılaştırma" need="… §28">).
// Usage: node pending-backend.mjs <pm folder> [--json <file>]   (reads pm/sources.json, pm/state/inventory.json)
// Structural signals only, never UI words like "coming soon" (the language audit: the product's text can be in any language):
//   marker  a placeholder component the product uses for "backend not there yet": named in sources.json
//           `pending.markers`, or found as a component defined in the frontend whose identifier says so
//           (PendingBackend, ComingSoon, NotImplemented, Placeholder…; code identifiers, not UI text) and used 2+ times.
//           Every use site is one waiting screen; its string props are carried as-is (label → title, the rest → detail).
//   call    an explicit API call in the frontend (`"GET /x"`, `.GET("/x")`, `fetch("/api/x")`, `axios.get("/x")`) whose
//           path has no endpoint in the backend inventory. Needs inventory.json; skipped without it.
//   mock    a non-test screen file importing from a mocks/fixtures/stubs folder: the screen runs on fake data.
// Counting only; the agent checks each item against the backend and sizes it (psst.md).
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { redactLine } from "./redact.mjs";
import { pathEstimated } from "./inventory.mjs";
import { patternsOfLoad, refRegex } from "./refs.mjs";
import { readSourcesSafe } from "./sources-file.mjs";

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Identifiers that mean "the backend isn't there yet". Code-level names (English by convention even in a Turkish or
// Japanese product). A state word alone isn't enough: `NotReadyNextStep` or `PendingInvites` are runtime states the
// user sees, not unbuilt work (the first product's NotReadyNextStep was the first false positive), so the state word has to sit
// next to Backend/Api/Server/Endpoint, or be one of the few names that only ever mean "not built".
const MARKER_NAME = /(Pending|Awaiting|Waiting|Missing|NotReady|Todo|Stub|Mock)(Backend|Api|Server|Endpoint)|^(Backend|Api|Server|Endpoint)(Pending|Missing|Stub|NotReady|Todo)|^(ComingSoon|NotImplemented|Unimplemented)[A-Z]?\w*$/;
const MARKER_GREP = "(function|const|class)[[:space:]]+[A-Za-z0-9]*(Backend|Api|Server|Endpoint|ComingSoon|NotImplemented|Unimplemented)";
// Test and Storybook scaffolding isn't a screen: on Twenty the "screens on mock data" were testing/decorators/*.tsx
//.
// Histoire/Storybook previews (`X.story.vue`, `X.stories.tsx`) are for developers, not screens: the suffix counts on any file extension.
const TEST_FILE = /(^|\/)(tests?|testing|test-utils|__tests__|__mocks__|__stories__|stories|storybook|\.storybook|decorators|fixtures?|e2e|cypress|playwright)\/|\.(test|spec|stories|story)\.[a-z]+$/i;
const SCREEN = /\.(jsx|tsx|vue|svelte|astro|js|ts)$/;
const MOCK_DIR = /(^|[/@~])(mocks?|__mocks__|fixtures?|stubs?|fake[-_]?data|dummy[-_]?data|sample[-_]?data)(\/|$|\.|["'])/i;
// Props that usually carry the name of the waiting feature; the rest go to detail.
const TITLE_PROPS = ["label", "title", "name", "feature", "what"];

const normPath = p => {
  let q = String(p).split("?")[0].replace(/\$\{[^}]*\}/g, "*").replace(/:[A-Za-z_]\w*/g, "*").replace(/\{[^}]*\}/g, "*").replace(/\/\d+(?=\/|$)/g, "/*").replace(/\/+$/, "");
  q = q.replace(/^\/(?:api\/)?(?:v\d+\/)?/, "/");
  return q.startsWith("/") ? q || "/" : "/" + q;
};
const tail = (p, n) => p.split("/").filter(Boolean).slice(-n).join("/");

export function pending(pm) {
  const K = readSourcesSafe(pm);
  if (!K) return null;
  const repo = K.repo || ".", ref = K.ref || "HEAD";
  const git = (...a) => { try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
  const E = K.inventory || pathEstimated(repo, ref);
  const frontend = [].concat(E.frontend || []);
  const excludedRe = (E.excluded || []).map(g => new RegExp("^" + g.split("**").map(p => p.split("*").map(esc).join("[^/]*")).join(".*") + "$"));
  const skip = f => TEST_FILE.test(f) || excludedRe.some(r => r.test(f));
  const refRe = refRegex(patternsOfLoad(K));
  const firstRef = s => { refRe.lastIndex = 0; return (String(s).match(refRe) || [])[0] || null; };
  const items = [], notes = [];
  if (!frontend.length) return { type: "pending", generated: new Date().toISOString(), ref, frontend, markers: [], items, notes: ["no frontend folder found (sources.json inventory.frontend)"] };
  const grep = (flags, pattern) => git("grep", "-n", ...flags, pattern, ref, "--", ...frontend).split("\n").filter(Boolean)
    .map(l => l.match(/^[^:]+:([^:]+):(\d+):(.*)$/)).filter(Boolean).map(([, file, no, text]) => ({ file, no: +no, text })).filter(x => !skip(x.file));

  // --- marker: placeholder components ---
  const named = [].concat(K.pending?.markers || []);
  const defs = grep(["-E"], MARKER_GREP).flatMap(x => {
    const m = x.text.match(/\b(?:export\s+)?(?:default\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9]*)/);
    return m && MARKER_NAME.test(m[1]) ? [{ name: m[1], file: x.file }] : [];
  });
  const candidates = [...new Set([...named, ...defs.map(d => d.name)])];
  const markers = [];
  for (const name of candidates) {
    const defFile = defs.find(d => d.name === name)?.file;
    const uses = grep(["-E"], `<${name}([[:space:]>/]|$)`).filter(x => x.file !== defFile);
    if (!uses.length || (!named.includes(name) && uses.length < 2)) continue;
    markers.push({ name, defined: defFile || null, uses: uses.length, source: named.includes(name) ? "sources.json" : "found" });
    const byFile = new Map(); for (const u of uses) byFile.set(u.file, [...(byFile.get(u.file) || []), u.no]);
    for (const [file, nos] of byFile) {
      const body = git("show", `${ref}:${file}`).split("\n");
      for (const no of nos) {
        // The element's own text: from the tag to its first close (`/>` or `>` at the end of a line), at most 12 lines.
        let chunk = ""; for (let i = no - 1; i < Math.min(body.length, no + 11); i++) { chunk += body[i] + "\n"; if (/\/>|>\s*$/.test(body[i]) && i >= no - 1) break; }
        const props = Object.fromEntries([...chunk.matchAll(/([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\})/g)].map(m => [m[1], m[2] ?? m[3] ?? m[4]]));
        const tKey = TITLE_PROPS.find(k => props[k]) || Object.keys(props).find(k => props[k].length > 3);
        const area = file.split("/").slice(-3, -1).join("/");
        const rest = Object.entries(props).filter(([k, v]) => k !== tKey && v.length > 3 && !/^(size|variant|tone|kind|className|class|id|key|as)$/.test(k));
        items.push({ kind: "marker", marker: name, title: tKey ? props[tKey] : `${area} (label set at runtime)`, area, evidence: `${file}:${no}`,
          detail: rest.map(([k, v]) => `${k}: ${v}`).slice(0, 3), ref: firstRef(Object.values(props).join(" ")) });
      }
    }
  }

  // --- call: explicit API calls with no backend endpoint ---
  const INV = readJson(path.join(pm, "state", "inventory.json"));
  const endpoints = (INV?.endpoints || []).map(e => normPath(e.path));
  if (!endpoints.length) notes.push("no pm/state/inventory.json endpoints: the \"call, no endpoint\" signal was skipped (run inventory.mjs first)");
  else {
    const have = new Set(endpoints), have2 = new Set(endpoints.map(p => tail(p, 2)).filter(p => p.includes("/")));
    const CALL = [/["'`](GET|POST|PUT|PATCH|DELETE)\s+(\/[^"'`\s]+)["'`]/, /\.(GET|POST|PUT|PATCH|DELETE)\(\s*["'`](\/[^"'`]+)["'`]/,
      /\bfetch\(\s*["'`](\/(?:api|v\d)\/[^"'`]+)["'`]/, /\baxios\.(get|post|put|patch|delete)\(\s*["'`](\/[^"'`]+)["'`]/];
    const lines = grep(["-E"], "[\"'`](GET|POST|PUT|PATCH|DELETE)[[:space:]]+/|\\.(GET|POST|PUT|PATCH|DELETE)\\(|fetch\\(|axios\\.(get|post|put|patch|delete)\\(");
    // The frontend's own route handlers (Next/Remix/Nuxt api routes, a BFF folder) answer some calls: not a backend gap.
    const own = new Set(git("ls-tree", "-r", "--name-only", ref, "--", ...frontend).split("\n")
      .filter(f => /(^|\/)(api|api-routes|routes|server)\//.test(f)).map(f => f.replace(/\/(route|index|\+server)\.[jt]sx?$/, "").replace(/\.[jt]sx?$/, "").split("/").pop()));
    const generated = new Map(), isGenerated = f => { if (!generated.has(f)) generated.set(f, /generated by|do not edit|@generated|auto-generated|code generated/i.test(git("show", `${ref}:${f}`).slice(0, 400))); return generated.get(f); };
    const missing = new Map();
    for (const l of lines) {
      for (const re of CALL) {
        const m = l.text.match(re); if (!m) continue;
        const [method, raw] = m.length === 3 ? [m[1].toUpperCase(), m[2]] : ["?", m[1]];
        const p = normPath(raw);
        if (p === "/" || have.has(p) || (p.split("/").filter(Boolean).length >= 2 && have2.has(tail(p, 2)))) break;
        if (own.has(p.split("/").filter(Boolean).pop()) || isGenerated(l.file)) break;
        const k = `${method} ${p}`; if (!missing.has(k)) missing.set(k, { method, path: p, at: [] });
        missing.get(k).at.push(`${l.file}:${l.no}`); break;
      }
    }
    for (const c of missing.values()) items.push({ kind: "call", title: `${c.method} ${c.path}`, area: c.path.split("/").filter(Boolean)[0] || "/", evidence: c.at[0], detail: c.at.slice(1, 3).map(a => `also ${a}`), ref: null });
  }

  // --- mock: screens importing fake data ---
  const imports = grep(["-E"], "(import|require)[^;]*[\"'][^\"']*(mocks?|__mocks__|fixtures?|stubs?|fake[-_]?data|dummy[-_]?data|sample[-_]?data)");
  const mockFiles = new Map();
  for (const x of imports) if (SCREEN.test(x.file) && MOCK_DIR.test(x.text.replace(/^.*?["']/, "\"")) && !MOCK_DIR.test(x.file)) if (!mockFiles.has(x.file)) mockFiles.set(x.file, x);
  for (const x of mockFiles.values()) items.push({ kind: "mock", title: x.file.split("/").slice(-2).join("/"), area: x.file.split("/").slice(-3, -1).join("/"), evidence: `${x.file}:${x.no}`, detail: [redactLine(x.file, x.text.trim()).slice(0, 120)], ref: null });

  return { type: "pending", generated: new Date().toISOString(), ref, frontend, markers, items, notes };
}

export function formatMd(R) {
  if (!R) return "No pm/sources.json: run move-in first.\n";
  const by = k => R.items.filter(i => i.kind === k);
  let o = `# Screen built, waiting for the backend · ${R.ref}\n\n`;
  o += R.markers.length ? `Markers: ${R.markers.map(m => `\`${m.name}\` ×${m.uses} (${m.source})`).join(", ")}\n\n` : "No placeholder component found (name one in sources.json → pending.markers).\n\n";
  const section = (title, list, row) => { if (list.length) o += `## ${title} (${list.length})\n\n${list.slice(0, 25).map(row).join("\n")}\n${list.length > 25 ? `…and ${list.length - 25} more\n` : ""}\n`; };
  section("Waiting screens", by("marker"), i => `- **${i.title}** · ${i.evidence}${i.ref ? ` · ${i.ref}` : ""}${i.detail.length ? `\n  ${i.detail.join(" · ")}` : ""}`);
  section("Calls with no endpoint", by("call"), i => `- \`${i.title}\` · ${i.evidence}`);
  section("Screens on mock data", by("mock"), i => `- ${i.title} · ${i.evidence}`);
  for (const n of R.notes) o += `_${n}_\n`;
  return o;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const jsonOut = take("--json"), R = pending(argv[0] || "pm");
  process.stdout.write(formatMd(R));
  if (R && jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(R, null, 1)); }
}
