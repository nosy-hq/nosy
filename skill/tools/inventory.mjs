// Backend inventory: extracts endpoints (routes/OpenAPI) and their usage from the screen. Product-agnostic —
// doesn't rely on any product-specific habit (the `dropped:` comment, the BACKEND-NEEDS format).
// Usage: node inventory.mjs <pm folder> [--json <file>]   (reads pm/sources.json)
// Reads: <pm>/sources.json → repo, ref, inventory: { backend:[path], frontend:[path], openapi:"path"?, excluded:[glob], product_excluded:[glob] }.
// If there's no inventory block, it guesses from the repo root (marked "estimate"). Files are read via <ref> with
// git ls-tree/show/grep; no checkout. Test files and generated contract files don't count as "usage"
// (generated types include every endpoint; counting them would make everything look "used").
// Screen matching (frontendUsage) counts not just literal call syntax like `fetch("/api/...`
// but also custom wrappers (authApiFetch('/login')), a path held in a constant (const LOGIN="/x"; ...client.get(LOGIN)),
// template strings (`/v1/${id}`), and calls split across multiple lines — it looks at the path string's OWN line,
// not the call's line. Backend directories without a product surface (cmd/smoke-*, scripts/, tools/, mock/…) are
// marked `product_excluded` by default (not counted as no-screen the way infrastructure is); if sources.json gives
// `inventory.product_excluded`, the default list is replaced by it.
// canwe.mjs imports this file's `compute()` directly if <pm>/state/inventory.json doesn't exist.
// Backend heuristics: Express/Koa/Fastify-style lowercase `.get(`/`.post(`/`.route({...})` route
// registrations are also caught now (a lowercase alternative was added to the GREP pre-filter; Go chi/gin's
// UPPERCASE heuristic and the Python decorator heuristic are unaffected, RULES' ext+pattern mapping stays the same).
// Callers vs. screens: a real product screen (`inventory.frontend`) is what sets `used`.
// A product can also ship OTHER in-repo API clients that are not a customer-facing screen at all — a browser
// extension's background script, a desktop app, a release tool. `inventory.callers` (optional, `[{name, paths}]`
// in sources.json) is scanned with the SAME usage matcher, but a match there sets `e.callers` (who calls it),
// never `e.used` — it drops the endpoint out of "no screen" (something DOES call it) without pretending a screen
// exists. Reported separately ("Callers, not a screen") so the two questions ("is anything calling this?" vs.
// "does the product show it?") don't get conflated.
// Raw fetch/axios/ky/$fetch/useFetch: these were already caught by the SAME
// quote-adjacent-literal matcher used for wrapper calls (frontendUsage's `LIT_RE` pass doesn't care what
// function the literal is an argument to) — confirmed by fixtures below. FGREP's pre-filter now also names
// `ky(`/`ky.<method>(`, `$fetch(`, `useFetch(`, and a bare `axios({...})` object-call form explicitly, so the
// candidate-line selection documents (and stays robust for) every syntax the task asked for, not only the ones
// it happened to already catch through the generic quote+"/" adjacency rule.
// Superseded: `e.superseded` is set ONLY from language-independent STRUCTURAL signals —
// a `@deprecated`/TSDoc tag or Go's own `// Deprecated:` convention on the route registration or the handler
// definition, `deprecated: true` in an OpenAPI operation, or a handler body that does nothing but return
// 410 Gone / a 301-308 redirect. It never matches comment WORDS (see the language audit — "veraltet" in a
// German comment must NOT flip this). A no-screen endpoint that ISN'T structurally superseded but whose path is
// a prefix of another, USED endpoint's path (e.g. `/sync` no-screen next to a used `/sync/preview`) gets
// `e.possiblySuperseded` instead — a hand-to-the-agent "check this" flag, not a claim.
// confidence: every NO-SCREEN endpoint gets "sure" | "shouldLookAt". sure = no part of
// the path (last two segments, params wildcarded) appears anywhere on the frontend AND the endpoint is defined
// heuristically (via a code line), not just from the generated contract file (E.openapi). shouldLookAt = there's a
// weak trace (a single-segment match — e.g. a common trailing "/id" segment — or the endpoint only comes from the
// contract, so it could be wired up via a dynamic path). The `noScreen` field stays for backward compat (sure +
// shouldLookAt combined); the new `no_screen_sure` field gives only the certain subset. Consumers (e.g. lowhanging.mjs)
// should use `no_screen_sure`, not `noScreen`, for headline/priority signals — the "N endpoints, E of them definitely
// no-screen, B should be checked" report reflects this split too.
// Frontend-app SHAPE detection: `pathEstimated`'s old frontend guess only matched by NAME
// (apps/*frontend*) — an app named "apps/admin-app" matches, but "apps/dashboard"/"apps/portal" wouldn't. A
// real check on the first product (internal request 111's the first product run) found 64 of its "no screen" endpoints were false
// positives purely because apps/admin-app was missing from sources.json's own hand-set inventory.frontend —
// a name guess alone can't catch that once sources.json has an explicit (non-estimated) inventory block.
// `frontendAppsFind` below reads each candidate app's package.json dependencies (react/vue/next/nuxt/svelte/
// angular/solid/preact) or, failing that, a screen-shaped subfolder (pages/app/routes) — exported separately so
// `verify-setup.mjs` can compare it against sources.json's own inventory.frontend and warn when the repo has more
// frontend-shaped apps than are listed.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { readSources } from "./sources-file.mjs";

const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// --- partial clones (Twenty, 30 Sep): `git show <ref>:f`, `git grep <ref>` and `cat-file --batch` read file
// contents from the object store, and a blobless clone fetches every missing one over the network, writing it
// into the repo. When the ref is the checked-out HEAD and the working tree is clean, the same contents are on
// disk: read them there. Any other ref in a partial clone would fetch: say so instead (`partialRefProblem`).
const gitOut = (repo, a) => { try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
export function isPartial(repo) { const o = gitOut(repo, ["config", "--get-regexp", "^remote\\..*\\.promisor$"]); return !!o && /\strue/.test(o) || !!(gitOut(repo, ["config", "--get", "extensions.partialclone"]) || "").trim(); }
export function worktreeFor(repo, ref) {
  if (!isPartial(repo)) return null;
  const at = r => (gitOut(repo, ["rev-parse", "--verify", `${r}^{commit}`]) || "").trim();
  const head = at("HEAD"), clean = (gitOut(repo, ["status", "--porcelain", "--untracked-files=no"]) ?? "x") === "";
  const top = (gitOut(repo, ["rev-parse", "--show-toplevel"]) || "").trim();
  return head && at(ref) === head && clean && top ? top : null;
}
export function partialRefProblem(repo, ref) {
  if (!isPartial(repo) || worktreeFor(repo, ref)) return null;
  return `this is a partial clone and "${ref}" isn't the clean, checked-out HEAD: reading its files would fetch each one from the remote and write it into the repo. Check out ${ref} (or set sources.json "ref" to HEAD), or run from a full clone.`;
}

// --- glob → regex (only * and ** and ?, enough for file paths) ---
function globRe(g) {
  let re = "", i = 0;
  while (i < g.length) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") { re += ".*"; i += 2; if (g[i] === "/") i++; }
    else if (c === "*") { re += "[^/]*"; i++; }
    else if (c === "?") { re += "[^/]"; i++; }
    else { re += /[.+^${}()|[\]\\]/.test(c) ? "\\" + c : c; i++; }
  }
  return new RegExp("^" + re + "$");
}

// --- frontend-app shape detector --------------------------------------------------------
const FRONTEND_DEPS = /^(react|react-dom|next|vue|nuxt3?|svelte|@sveltejs\/kit|@angular\/core|solid-js|preact)$/;
const FRONTEND_SHAPE_DIRS = ["pages", "app", "routes", "src/pages", "src/app", "src/routes"];
function frontendShaped(tryGit, dirExists, ref, dir) {
  const pkgRaw = tryGit("show", `${ref}:${dir}/package.json`);
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (Object.keys(deps).some(d => FRONTEND_DEPS.test(d))) return true;
    } catch { /* not valid JSON — fall through to the dir-shape check */ }
  }
  return FRONTEND_SHAPE_DIRS.some(sub => dirExists(`${dir}/${sub}`));
}
// Every app with a frontend SHAPE under apps/, packages/, clients/ (Acme Books/Kargo-style monorepos) — matched by
// package.json dependencies or a screen-shaped subfolder, not by the directory's own NAME. Exported so
// verify-setup.mjs can compare it against sources.json's own inventory.frontend directly.
export function frontendAppsFind(repo, ref) {
  const wt = worktreeFor(repo, ref);
  const tryGit = (...a) => {
    if (wt && a[0] === "show") { try { return fs.readFileSync(path.join(wt, a[1].slice(a[1].indexOf(":") + 1)), "utf8"); } catch { return ""; } }
    try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; }
  };
  const dirExists = d => wt ? fs.existsSync(path.join(wt, d)) : (() => { try { execFileSync("git", ["-C", repo, "cat-file", "-e", `${ref}:${d}`], { stdio: "ignore" }); return true; } catch { return false; } })();
  const root = tryGit("ls-tree", "--name-only", ref).split("\n").filter(Boolean);
  const containers = ["apps", "packages", "clients"].filter(c => root.includes(c));
  const subApps = containers.flatMap(c => tryGit("ls-tree", "--name-only", ref, c + "/").split("\n").filter(Boolean).map(a => a.replace(/\/$/, "")).map(a => a.startsWith(c + "/") ? a : `${c}/${a}`));
  return subApps.filter(a => frontendShaped(tryGit, dirExists, ref, a));
}

// Backend apps in a monorepo (apps/, packages/, clients/), by name: *-server, *-api, *-backend, or exactly server/
// api/backend (Twenty's packages/twenty-server was listed as a frontend: its package.json pulls in react for
// e-mail templates, and nothing guessed a backend under packages/).
const BACKEND_NAME = /(^|[-_])(server|api|backend)$/;
export function backendAppsFind(repo, ref) {
  const tryGit = (...a) => { try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
  const root = tryGit("ls-tree", "--name-only", ref).split("\n").filter(Boolean);
  const containers = ["apps", "packages", "clients", "services"].filter(c => root.includes(c));
  return containers.flatMap(c => tryGit("ls-tree", "-d", "--name-only", ref, c + "/").split("\n").filter(Boolean).map(a => a.replace(/\/$/, "")).map(a => a.startsWith(c + "/") ? a : `${c}/${a}`))
    .filter(a => BACKEND_NAME.test(a.split("/").pop()));
}

// Guesses inventory paths from the repo if they're not in sources.json. find-sources.mjs (move-in) uses the same guess.
// `git ls-tree <ref> apps/` gives names with the full path already ("apps/x"); the old version used to prepend "apps/"
// once more ("apps/apps/x"): the frontend was never found, and without an inventory block, 490 of the first product's 490
// endpoints came out "no-screen".
export function pathEstimated(repo, ref) {
  const wt = worktreeFor(repo, ref);
  const tryGit = (...a) => { try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
  const dirExists = d => wt ? fs.existsSync(path.join(wt, d)) : (() => { try { execFileSync("git", ["-C", repo, "cat-file", "-e", `${ref}:${d}`], { stdio: "ignore" }); return true; } catch { return false; } })();
  const root = tryGit("ls-tree", "--name-only", ref).split("\n").filter(Boolean);
  const apps = root.includes("apps") ? tryGit("ls-tree", "--name-only", ref, "apps/").split("\n").filter(Boolean).map(a => a.replace(/\/$/, "")).map(a => a.startsWith("apps/") ? a : "apps/" + a) : [];
  const guess = cands => { const out = new Set(); for (const c of cands) { if (c.includes("*")) { const re = globRe(c); for (const a of [...root, ...apps]) if (re.test(a)) out.add(a); } else if (dirExists(c)) out.add(c); } return [...out]; };
  // Frontend: the old NAME-only guess (apps/web, apps/*frontend*, web, src) UNIONED with the SHAPE detector
  // — the union keeps a name-only match (a repo whose only signal is its folder name)
  // while adding apps a name guess alone would miss (apps/dashboard, apps/portal, packages/web-client…).
  const backend = [...new Set([...guess(["apps/*api*", "apps/backend", "server", "backend"]), ...backendAppsFind(repo, ref)])];
  const frontend = [...new Set([...guess(["apps/web", "apps/*frontend*", "web", "src"]), ...frontendAppsFind(repo, ref)])].filter(f => !backend.includes(f));
  return { backend, frontend, excluded: [] };
}

function works(pm) {
  const K = readSources(pm);
  // said once, before the heavy part (grep across backend/frontend history, batched
  // `cat-file` reads) - on a partial clone those fetch the missing blobs from the remote one at a time, which
  // otherwise just sits silent for minutes and looks hung, not slow.
  // (A partial clone no longer fetches at all: at a clean HEAD the files are read from disk, and any other ref
  // stops with partialRefProblem below. partialCloneNoticeOf's "may fetch, slow" warning is no longer needed.)
  // stdio: so git's diagnostic lines like "fatal: path does not exist" don't hit stderr (they're all
  // handled with try/catch anyway); during dirExists/estimation, plenty of "missing" is tried, which is normal.
  const refProblem = partialRefProblem(K.repo, K.ref);
  if (refProblem) throw new Error(`inventory: ${refProblem}`);
  const wt = worktreeFor(K.repo, K.ref); // partial clone at a clean HEAD: read the files on disk, fetch nothing
  const rawGit = (...a) => execFileSync("git", ["-C", K.repo, ...a], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] });
  // `git grep … <ref> -- paths` prints "<ref>:file:line:text"; on disk the ref argument goes and the prefix is
  // put back, so every parser below reads the same shape.
  const git = (...a) => {
    if (!wt || a[0] !== "grep") return rawGit(...a);
    const i = a.indexOf(K.ref); const args = i >= 0 ? [...a.slice(0, i), ...a.slice(i + 1)] : a;
    return execFileSync("git", ["-C", wt, ...args], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }).split("\n").map(l => l ? `${K.ref}:${l}` : l).join("\n");
  };
  const tryGit = (...a) => { try { return git(...a); } catch { return ""; } };
  const readDisk = f => { try { return fs.readFileSync(path.join(wt, f)); } catch { return null; } };
  const show = f => wt ? (readDisk(f)?.toString("utf8") ?? "") : tryGit("show", `${K.ref}:${f}`);
  const dirExists = d => wt ? fs.existsSync(path.join(wt, d)) : (() => { try { git("cat-file", "-e", `${K.ref}:${d}`); return true; } catch { return false; } })();
  // cat-file --batch's own output shape ("<name> blob <size>\n<content>\n", "<name> missing\n"), from disk
  // when the files are there, from git otherwise.
  const catBatch = files => {
    if (!wt) return execFileSync("git", ["-C", K.repo, "cat-file", "--batch"], { input: files.map(f => `${K.ref}:${f}\n`).join(""), maxBuffer: 256 << 20 });
    return Buffer.concat(files.flatMap(f => { const b = readDisk(f); return b ? [Buffer.from(`${K.ref}:${f} blob ${b.length}\n`), b, Buffer.from("\n")] : [Buffer.from(`${K.ref}:${f} missing\n`)]; }));
  };
  // Reads the head of many files with a SINGLE git process (cat-file --batch); avoids running
  // `git show` hundreds of times one by one (matters for performance in a large monorepo).
  const headFind = files => {
    const map = new Map(); if (!files.length) return map;
    let buf; try { buf = catBatch(files); } catch { return map; }
    let off = 0;
    for (const f of files) {
      const nl = buf.indexOf(10, off); if (nl < 0) break;
      const head = buf.toString("utf8", off, nl); off = nl + 1;
      const mm = head.match(/ (?:blob|tree|commit) (\d+)$/);
      if (!mm) continue; // "<ref> missing"
      const size = +mm[1]; map.set(f, buf.toString("utf8", off, off + Math.min(size, 400))); off += size + 1;
    }
    return map;
  };

  // --- inventory block or estimate ---
  let E = K.inventory, estimate = false;
  if (!E) { estimate = true; E = pathEstimated(K.repo, K.ref); }
  const excluded = E.excluded || [];
  const excludedRe = excluded.map(globRe);
  // Default exclusion: test files never count as "usage"/"endpoint" in any product.
  const withTest = f => /(^|\/)(tests?|__tests__|testdata)\//i.test(f) || /\.(test|spec)\.[jt]sx?$/i.test(f) || /_test\.go$/.test(f) || /(^|\/)test_[^/]+\.py$/.test(f);
  const exclude = f => withTest(f) || excludedRe.some(r => r.test(f));

  // Backend binaries/directories without a product surface: smoke-test binaries, script/tool
  // folders, test helpers, mocks. These are NOT fully excluded (like exclude()); they're marked with their own
  // separate flag (product_excluded), similar to the infrastructure flag, aren't counted as no-screen, and get
  // reported in their own count line — so "how many endpoints fell outside the product surface" stays visible.
  // If sources.json gives `inventory.product_excluded` (even as an empty array), the default list is fully replaced by it.
  // Starts with "**/": catches it whether the backend root is the repo root or a subfolder like apps/backend
  // (as in the first product) — see globRe's "**" behavior (zero or more directories).
  const PRODUCT_EXCLUDED_DEFAULT = [
    "**/cmd/smoke-*", "**/cmd/smoke-*/**",
    "**/cmd/*-worker", "**/cmd/*-worker/**",
    "**/scripts/**", "**/tools/**",
    "**/internal/testutil/**",
    "**/mock/**", "**/mocks/**",
  ];
  const productExcludedRe = (Array.isArray(E.product_excluded) ? E.product_excluded : PRODUCT_EXCLUDED_DEFAULT).map(globRe);

  const backend = (E.backend || []).filter(dirExists);
  const frontend = (E.frontend || []).filter(dirExists);
  const backendMissing = !backend.length && !E.openapi;
  if (backendMissing) return { type: "inventory", generated: new Date().toISOString(), ref: K.ref, estimate, backend_missing: true, total: 0, noScreen: 0, endpoints: [] };

  // --- backend: OpenAPI/JSON Schema contract (if any) ---
  // `deprecated: true` on an operation is a structural signal, read here so `superseded`
  // downstream doesn't need to re-parse the contract file.
  function contractEndpoints(f) {
    const raw = show(f); if (!raw) return [];
    const out = [];
    if (/\.ya?ml$/i.test(f)) {
      // Simple yaml: a "  /path:" line, with method lines like "    get:" underneath it. `deprecated: true`
      // is looked for a few indented lines below the method line, before the next method/path line starts.
      let inPaths = false, curPath = null;
      const lines = raw.split("\n");
      lines.forEach((l, i) => {
        if (/^paths:\s*$/.test(l)) return void (inPaths = true);
        if (!inPaths) return;
        const pm2 = l.match(/^\s+(\/\S*):\s*$/); if (pm2) return void (curPath = pm2[1]);
        const mm = l.match(/^\s+(get|post|put|patch|delete|options|head):\s*$/i);
        if (mm && curPath) {
          let deprecated = false;
          for (let j = i + 1; j < lines.length; j++) {
            if (/^\s+deprecated:\s*true\s*$/i.test(lines[j])) { deprecated = true; break; }
            if (/^\s+(get|post|put|patch|delete|options|head):\s*$/i.test(lines[j]) || /^\s+\/\S*:\s*$/.test(lines[j]) || /^\S/.test(lines[j])) break;
          }
          out.push({ method: mm[1].toUpperCase(), path: curPath, file: f, line: i + 1, deprecated });
        } else if (/^\S/.test(l)) inPaths = false;
      });
    } else {
      let J; try { J = JSON.parse(raw); } catch { return []; }
      if (Array.isArray(J.routes)) for (const r of J.routes) { const [mo, pa] = r.method && r.path ? [r.method, r.path] : String(r.key || "").split(/\s+/); if (mo && pa) out.push({ method: mo.toUpperCase(), path: pa, file: f, line: 1, deprecated: !!r.deprecated }); }
      else if (J.paths && typeof J.paths === "object") for (const [p, ops] of Object.entries(J.paths)) for (const [m, op] of Object.entries(ops || {})) if (/^(get|post|put|patch|delete|options|head)$/i.test(m)) out.push({ method: m.toUpperCase(), path: p, file: f, line: 1, deprecated: !!(op && op.deprecated) });
    }
    return out;
  }

  // --- backend: framework heuristics (Go net/http 1.22, chi/gin/echo/fiber, custom registrar,
  //     Node Express/Fastify/Koa/Hono, Python FastAPI/Flask/Django, Rails) ---
  const U = s => s.toUpperCase();
  const RULES = [
    { ext: /\.go$/, re: /\.(?:HandleFunc|Handle)\(\s*"([A-Z]+)\s+([^"]+)"/, fn: m => [[m[1], m[2]]] }, // mux.HandleFunc("GET /path", ...)
    { ext: /\.go$/, re: /\.\w*(?:Register|Route)\w*\(\s*"([A-Z]+)"\s*,\s*"(\/[^"]*)"/, fn: m => [[m[1], m[2]]] }, // rr.Register("PUT", "/path", ...)
    { ext: /\.go$/, re: /\.(Get|GET|Post|POST|Put|PUT|Patch|PATCH|Delete|DELETE|Head|HEAD|Options|OPTIONS)\(\s*"(\/[^"]*)"/, fn: m => [[U(m[1]), m[2]]] }, // chi/gin/echo/fiber
    { ext: /\.(m|c)?[jt]sx?$/, re: /\b[\w.]+\.(get|post|put|patch|delete|head|options)\(\s*["'`](\/[^"'`]*)["'`]/i, fn: m => [[U(m[1]), m[2]]] }, // Express/Koa/Hono
    { ext: /\.(m|c)?[jt]sx?$/, re: /\.route\(\s*\{/, fn: (m, t) => { const mm = t.match(/method:\s*["'](\w+)["']/i), uu = t.match(/url:\s*["'](\/[^"']*)["']/i); return mm && uu ? [[U(mm[1]), uu[1]]] : null; } }, // fastify.route({method,url})
    { ext: /\.py$/, re: /@[\w.]+\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/i, fn: m => [[U(m[1]), m[2]]] }, // FastAPI
    { ext: /\.py$/, re: /@[\w.]+\.route\(\s*["']([^"']+)["']/i, fn: (m, t) => { const mm = t.match(/methods\s*=\s*\[([^\]]*)\]/i); return (mm ? (mm[1].match(/[A-Za-z]+/g) || ["GET"]) : ["GET"]).map(x => [U(x), m[1]]); } }, // Flask
    { ext: /urls?\.py$/, re: /^\s*path\(\s*["']([^"']*)["']/, fn: m => [["ANY", "/" + m[1].replace(/^\/+/, "")]] }, // Django
    { ext: /routes\.rb$/, re: /\b(get|post|put|patch|delete)\s+["']([^"']+)["']/i, fn: m => [[U(m[1]), m[2]]] }, // Rails basic
    { ext: /routes\.rb$/, re: /\bresources\s+:(\w+)/, fn: m => { const n = m[1]; return [["GET", `/${n}`], ["POST", `/${n}`], ["GET", `/${n}/{id}`], ["PATCH", `/${n}/{id}`], ["PUT", `/${n}/{id}`], ["DELETE", `/${n}/{id}`], ["GET", `/${n}/new`], ["GET", `/${n}/{id}/edit`]]; } }, // Rails resources
  ];
  // "\\.(Get|GET|...)\\(" only catches Go/chi/gin forms (a method starting with a capital letter); Express/Koa/Fastify-style
  // lowercase `.get(`/`.post(` (app.get('/x'), router.post("/y")) was NOT in this pattern — the JS rule in RULES
  // (line ~128, with the /i flag) could already sense these, but the line never reached RULES because the GREP
  // pre-filter rejected it first. A lowercase alternative was added; even if it matches a Go
  // file, RULES' .go rule only accepts UPPERCASE methods, so it doesn't produce a fake endpoint (just an unnecessary GREP candidate).
  const GREP = '(\\.(Register|Route)[A-Za-z]*\\(|\\.(HandleFunc|Handle)\\(|\\.(Get|GET|Post|POST|Put|PUT|Patch|PATCH|Delete|DELETE|Head|HEAD|Options|OPTIONS)\\(|\\.(get|post|put|patch|delete|head|options)\\(|\\.route\\(|@[A-Za-z_.]+\\.(get|post|put|patch|delete|route)\\(|^[[:space:]]*path\\(|resources[[:space:]]+:)';

  function heuristicEndpoints() {
    if (!backend.length) return [];
    let raw; try { raw = git("grep", "-n", "-E", GREP, K.ref, "--", ...backend); } catch { raw = ""; }
    const out = [];
    for (const line of raw.split("\n")) {
      if (!line) continue;
      const m = line.match(/^[^:]+:([^:]+):(\d+):(.*)$/); if (!m) continue;
      const [, file, no, text] = m;
      if (exclude(file)) continue;
      for (const r of RULES) {
        if (!r.ext.test(file)) continue;
        const mm = r.re.exec(text); if (!mm) continue;
        const pairs = r.fn(mm, text); if (!pairs) continue;
        // `regLine` is kept (internal, not in outwardGive) so the superseded check can look at this exact
        // registration line's own trailing comment/identifier without a second grep pass.
        for (const [method, p] of pairs) out.push({ method, path: p, file, line: +no, regLine: text });
        break;
      }
    }
    return out;
  }

  // --- path normalization and area ---
  const normPath = p => { let q = String(p).replace(/\$\{[^}]*\}/g, "*").replace(/:[A-Za-z_]\w*/g, "*").replace(/\{[^}]*\}/g, "*").replace(/\/+$/, ""); return q.startsWith("/") ? q || "/" : "/" + q; };
  const areaOf = p => (p.match(/^\/api\/v\d+\/([^/]+)/) || p.match(/^\/v\d+\/([^/]+)/) || p.match(/^\/([^/]+)/) || [, "other"])[1];
  const segs = p => p.split("/").filter(Boolean);
  const suffixMatches = (a, b, n = 2) => { const sa = segs(a), sb = segs(b), k = Math.min(n, sa.length, sb.length); return k > 0 && sa.slice(-k).join("/") === sb.slice(-k).join("/"); };

  // Heuristically found ones take priority (file:line is more useful); the contract only fills gaps.
  const heur = heuristicEndpoints();
  const contract = E.openapi ? contractEndpoints(E.openapi) : [];
  const seen = new Map();
  for (const e of [...heur, ...contract]) { const k = `${e.method} ${normPath(e.path)}`; if (!seen.has(k)) seen.set(k, e); }
  // path: original (readable, {id}/:id preserved) · np: a copy normalized only for matching.
  const endpoints = [...seen.values()].map(e => ({ ...e, np: normPath(e.path), area: areaOf(normPath(e.path)) }));

  // --- screen (frontend) usage ---
  // Used to only pick lines carrying a known call syntax like fetch(/axios./client.GET(...; this missed
  // custom wrappers like `authApiFetch('/login')` and paths held in a constant like `client.get(PATH_CONST)`
  //. Now it FIRST collects EVERY string literal inside quotes/template strings that
  // starts with "/" (FGREP doesn't look for the call name, it looks for quote+"/" adjacency) — this covers both
  // wrapper calls and calls split across multiple lines (no -A context needed, since the path string is on its
  // own line). A path assigned to a constant (`const NAME = "/x"` or `name: "/x"`) is searched separately, by
  // name, in a second pass; so it still counts even if `client.get(NAME)` is used in a different file.
  // The old triggers (fetch(/axios./client.GET(/"GET /path" etc.) are KEPT — even though the main selector is now
  // quote+"/" adjacency, strings with a METHOD PREFIX like "GET /api/x" start right after the quote with the method
  // name, not "/", so that pattern still needs to be caught separately (the requestPaged("GET /api/x") pattern was
  // the first product's main match path — the first version forgot this and caused a regression).
  // Raw-client names: fetch/axios(.<method>(/bare object-call form)/ky(.<method>()/$fetch(/
  // useFetch( are named explicitly so candidate-line selection is self-documenting for every syntax the task
  // named — in practice almost all of these were already swept in by the generic quote+"/" adjacency rule above
  // (a literal's own line doesn't care which function it's an argument to); naming them here just makes that
  // coverage explicit instead of incidental, and covers the one form that generic rule can miss on its own:
  // `axios({ url: '/x', ... })`, a bare call with no `.<method>(` at all.
  const FGREP = "([\"'`]/[A-Za-z0-9_]|[\"'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)[[:space:]]|fetch\\(|axios\\(|axios\\.|ky\\(|ky\\.[a-z]+\\(|\\$fetch\\(|useFetch\\(|\\.request\\(|requestPaged\\(|client\\.(GET|POST|PUT|PATCH|DELETE)\\(|api\\.(get|post|put|patch|delete)\\(|new URL\\(|new EventSource\\(|window\\.location|location\\.href)";
  const GENERATED = /generated by|do not edit|@generated|auto-generated|code generated/i;
  const LIT_RE = /(["'`])(\/[^"'`]*)\1/g;
  const DECL_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'`])(\/[^"'`]*)\2/;
  const PROP_RE = /^\s*([A-Za-z_$][\w$]*)\s*:\s*(["'`])(\/[^"'`]*)\2/;
  // Parameterized on `dirs` so the exact same matcher can scan a `callers` group
  // (apps/extension, a desktop/release tool) with no logic fork — a caller is "does this path appear here",
  // identical question to "is this path on screen", just asked of a different directory set and reported
  // differently by the caller (see `works()` below: a callers-group hit never sets `e.used`).
  function frontendUsage(dirs) {
    if (!dirs.length) return { byMP: new Map(), byPath: new Map() };
    let raw; try { raw = git("grep", "-n", "-i", "-E", FGREP, K.ref, "--", ...dirs); } catch { raw = ""; }
    const byFile = new Map();
    for (const line of raw.split("\n")) {
      if (!line) continue;
      const m = line.match(/^[^:]+:([^:]+):(\d+):(.*)$/); if (!m) continue;
      const [, file, no, text] = m;
      if (exclude(file)) continue;
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push({ no: +no, text });
    }
    const titles = headFind([...byFile.keys()]); // batched read in a single process
    const generatedMi = f => GENERATED.test(titles.get(f) || "");
    const byMP = new Map(), byPath = new Map();
    const save = (map, key, file, no) => { if (!map.has(key)) map.set(key, `${file}:${no}`); };
    const constants = new Map(); // NAME -> { path, file, line } — the definition line ITSELF doesn't count as usage.
    for (const [file, lines] of byFile) {
      if (generatedMi(file)) continue; // a generated contract file (e.g. contract/routes.ts) includes every endpoint — doesn't count as usage
      for (const { no, text } of lines) {
        // Calls like `${encodeURIComponent(id)}` contain parens and break the path regex; convert to
        // a placeholder first (the same "*" that normPath uses for {id}/:id — so the suffix still matches).
        const t = text.replace(/\$\{[^}]*\}/g, "*");
        let m = t.match(/["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[^"'`]+)["'`]/); // request("GET /api/v1/x")
        if (m) { save(byMP, `${m[1]} ${normPath(m[2])}`, file, no); save(byPath, normPath(m[2]), file, no); continue; }
        m = t.match(/\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Get|Post|Put|Patch|Delete)\(\s*["'`](\/[^"'`]+)["'`]/); // client.GET("/x")
        if (m) { save(byMP, `${U(m[1])} ${normPath(m[2])}`, file, no); save(byPath, normPath(m[2]), file, no); continue; }
        // A constant-assignment line: only recorded into `constants` — the definition alone doesn't count as "used
        // on screen" ("assigned and used in ANOTHER FILE"); actual usage is looked for in the second pass below.
        const decl = t.match(DECL_RE) || t.match(PROP_RE);
        if (decl) { const name = decl[1]; if (!constants.has(name)) constants.set(name, { path: normPath(decl[3]), file: file, line: +no }); continue; }
        // A string literal inside quotes/template that starts with "/" end to end: authApiFetch('/login'), `/v1/${id}`, etc.
        for (const lm of t.matchAll(LIT_RE)) save(byPath, normPath(lm[2]), file, no);
        // Base-variable concatenation: segments like `${base}/resource/${id}` that aren't adjacent to a quote but
        // are still "/"-separated (a single segment "/login" counts too now — used to require two segments).
        for (const g of t.matchAll(/\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.$*{}:-]*)*/g)) save(byPath, normPath(g[0]), file, no);
      }
    }
    // Second pass: if the path assigned to a constant shows up by name on another line (other than the definition line), count it as used.
    const names = [...constants.keys()].filter(a => a.length >= 3);
    if (names.length) {
      // git grep (POSIX ERE) doesn't support \b; only a plain alternation is used here for pre-filtering,
      // the actual word-boundary check happens below with the JS regex (nameRe).
      const ADGREP = "(" + names.map(esc).join("|") + ")";
      let raw2; try { raw2 = git("grep", "-n", "-E", ADGREP, K.ref, "--", ...dirs); } catch { raw2 = ""; }
      const nameRe = new Map(names.map(a => [a, new RegExp(`\\b${esc(a)}\\b`)]));
      for (const line of raw2.split("\n")) {
        if (!line) continue;
        const m = line.match(/^[^:]+:([^:]+):(\d+):(.*)$/); if (!m) continue;
        const [, file, noS, text] = m; const no = +noS;
        if (exclude(file)) continue;
        for (const name of names) {
          const info = constants.get(name);
          if (file === info.file && no === info.line) continue; // not the definition itself
          if (nameRe.get(name).test(text)) save(byPath, info.path, file, no);
        }
      }
    }
    return { byMP, byPath };
  }
  // Shared lookup: exact method+path, else path-only, else a suffix fallback (n=3 then n=2 — n=1 stays reserved
  // for the weak-trace/confidence signal, see below). Used for both the real frontend and each `callers` group.
  function findUsage(byMP, byPath, e) {
    let usage = byMP.get(`${e.method} ${e.np}`) || byPath.get(e.np);
    if (!usage) outer: for (const n of [3, 2]) for (const [p, loc] of byPath) if (suffixMatches(p, e.np, n)) { usage = loc; break outer; }
    return usage || null;
  }
  const { byMP, byPath } = frontendUsage(frontend);
  for (const e of endpoints) {
    const usage = findUsage(byMP, byPath, e);
    e.used = !!usage; e.usage = usage;
    // Weak trace: for an endpoint not counted as fully used (used=false), is there a single-segment match?
    // Only meaningful in the "confidence" calculation for used=false endpoints; found and cached here ahead of time.
    e.weakTrace = !e.used && [...byPath.keys()].some(p => suffixMatches(p, e.np, 1));
  }

  // --- callers: in-repo API clients that AREN'T a product screen ---
  // `inventory.callers` in sources.json: [{ name, paths }]. Only checked for endpoints the real frontend
  // didn't already claim — a screen match always wins the report even if a caller group also references it.
  const callerGroups = Array.isArray(E.callers) ? E.callers : [];
  for (const e of endpoints) e.callers = [];
  for (const group of callerGroups) {
    if (!group || !Array.isArray(group.paths) || !group.paths.length) continue;
    const dirs = group.paths.filter(dirExists); if (!dirs.length) continue;
    const { byMP: cMP, byPath: cPath } = frontendUsage(dirs);
    for (const e of endpoints) {
      if (e.used) continue;
      const usage = findUsage(cMP, cPath, e);
      if (usage) e.callers.push({ name: group.name || "caller", usage });
    }
  }

  // Infrastructure endpoints (health, readiness, metrics, debug) don't expect a screen: not counted as "no-screen",
  // don't drop into psst, stay in the list flagged `infrastructure`. In the first product, GET /healthz used to sit at the top
  // of 28 "endpoint exists, no screen" items.
  const Infrastructure = /^\/?(?:healthz?|livez?|readyz?|ready|ping|metrics|debug|_[a-z]+|status\/?$)(?:\/|$)/i;
  for (const e of endpoints) e.infrastructure = Infrastructure.test(String(e.path || "").replace(/^\/(?:api\/)?(?:v\d+\/)?/, "/"));
  for (const e of endpoints) e.product_excluded = productExcludedRe.some(r => r.test(e.file));

  // --- superseded: language-independent STRUCTURAL signals only ------------------------
  // Never matches comment WORDS in any language (see the language audit) — only a fixed tag/convention/field/
  // response shape. `e.superseded` endpoints drop out of "no screen" entirely (reported in their own section);
  // `e.possiblySuperseded` (below) is a weaker, hand-to-the-agent flag that stays IN the no-screen list.
  const supersededCandidates = endpoints.filter(e => !e.used && !e.infrastructure && !e.product_excluded && !e.callers.length);
  const contractDeprecatedKeys = new Set(contract.filter(c => c.deprecated).map(c => `${c.method} ${normPath(c.path)}`));
  const DEPRECATED_TAG = /@deprecated\b/i;         // JSDoc/TSDoc convention — a fixed tag, not a prose word in any language
  const GO_DEPRECATED = /^\s*\/\/\s*Deprecated:/;  // Go's own godoc convention (staticcheck SA1019 reads exactly this)
  const GONE_OR_REDIRECT = /\bStatusGone\b|\b410\b|\bStatusMovedPermanently\b|\bStatusPermanentRedirect\b|\bRedirect\(|\b30[18]\b/;
  const isCommentLine = l => /^\s*(\/\/|#|\*|\/\*)/.test(l);
  // A line that's only punctuation (a lone "{", "}", ";", or whitespace) carries no statement of its own —
  // stripped before the check, so a closing brace doesn't itself get judged against GONE_OR_REDIRECT.
  const hasCode = l => !isCommentLine(l) && l.replace(/[{}\s;]/g, "").length > 0;
  // Full (untruncated) file reads for a SMALL, bounded set of files (only where a no-screen candidate's
  // registration or resolved handler lives) — headFind's 400-byte peek (used for the GENERATED check above)
  // isn't enough here, a deprecation comment or a handler body can sit anywhere in the file.
  function fullRead(files) {
    const map = new Map(); if (!files.length) return map;
    let buf; try { buf = catBatch(files); } catch { return map; }
    let off = 0;
    for (const f of files) {
      const nl = buf.indexOf(10, off); if (nl < 0) break;
      const head = buf.toString("utf8", off, nl); off = nl + 1;
      const mm = head.match(/ (?:blob|tree|commit) (\d+)$/);
      if (!mm) continue;
      const size = +mm[1]; map.set(f, buf.toString("utf8", off, off + size).split("\n")); off += size + 1;
    }
    return map;
  }
  // Best-effort trailing identifier on a route-registration line (mux.HandleFunc("GET /x", h.Name) /
  // rr.Register(...,h.Name) / router.get('/x', name)) — a guess, never required: without it, only the
  // registration-line comment and OpenAPI's `deprecated` still apply.
  function handlerToken(text) {
    const m = String(text || "").match(/,\s*([A-Za-z_][\w.]*)\s*\)\s*[,;]?\s*$/);
    if (!m) return null;
    const bare = m[1].split(".").pop();
    return /^[A-Za-z_]\w*$/.test(bare) ? bare : null;
  }
  // Contiguous comment block directly above line `idx` (0-based, the line itself not included), one blank
  // line tolerated (a JSDoc block separated from its function by one gap is still "on the handler").
  function deprecatedAbove(lines, idx) {
    let i = idx - 1, out = [], blanks = 0;
    while (i >= 0) {
      const l = lines[i];
      if (isCommentLine(l)) { out.unshift(l); i--; continue; }
      if (!/\S/.test(l) && blanks === 0) { blanks++; i--; continue; }
      break;
    }
    const block = out.join("\n");
    return DEPRECATED_TAG.test(block) || GO_DEPRECATED.test(block);
  }
  // A handler body (starting at its `func`/`function`/`def` line) that, once opened, only ever does
  // Gone/redirect before its closing brace — bounded to 40 lines so a real handler never gets misread.
  function bodyIsGoneOrRedirectOnly(lines, defIdx) {
    let depth = 0, opened = false, seenCode = false, onlySignal = true;
    for (let i = defIdx, n = 0; i < lines.length && n < 40; i++, n++) {
      const l = lines[i];
      for (const ch of l) { if (ch === "{") { depth++; opened = true; } else if (ch === "}") depth--; }
      if (i > defIdx && hasCode(l)) { seenCode = true; if (!GONE_OR_REDIRECT.test(l)) onlySignal = false; }
      if (opened && depth <= 0) break;
    }
    return seenCode && onlySignal;
  }
  const handlerNames = [...new Set(supersededCandidates.map(e => e.regLine ? handlerToken(e.regLine) : null).filter(Boolean))];
  // Definition sites for those handler names, resolved with the same two-step pattern used elsewhere in this
  // file (a plain-alternation git grep pre-filter, then a JS `\b` regex to confirm — git's ERE grep here
  // doesn't reliably support \b) — and only DEFINITION-shaped lines count, not every call site.
  function handlerDefLines(names) {
    if (!names.length || !backend.length) return new Map();
    const ALT = "(" + names.map(esc).join("|") + ")";
    let raw; try { raw = git("grep", "-n", "-E", ALT, K.ref, "--", ...backend); } catch { raw = ""; }
    const map = new Map();
    const nameRe = new Map(names.map(a => [a, new RegExp(`\\b${esc(a)}\\s*\\(`)]));
    const DEF_SHAPE = /^\s*(func\b|function\b|def\b|export\s+(async\s+)?function\b|[A-Za-z_][\w.]*\s*[:=]\s*(async\s*)?\()/;
    for (const line of raw.split("\n")) {
      if (!line) continue;
      const m = line.match(/^[^:]+:([^:]+):(\d+):(.*)$/); if (!m) continue;
      const [, file, no, text] = m;
      if (exclude(file) || !DEF_SHAPE.test(text)) continue;
      for (const name of names) if (!map.has(name) && nameRe.get(name).test(text)) map.set(name, { file, line: +no });
    }
    return map;
  }
  const handlerDefs = handlerDefLines(handlerNames);
  const filesToRead = new Set();
  for (const e of supersededCandidates) filesToRead.add(e.file);
  for (const d of handlerDefs.values()) filesToRead.add(d.file);
  const fileLinesMap = fullRead([...filesToRead]);
  for (const e of supersededCandidates) {
    const k = `${e.method} ${e.np}`;
    let structural = false, evidence = null;
    if (contractDeprecatedKeys.has(k)) { structural = true; evidence = "openapi: deprecated: true"; }
    if (!structural && e.regLine) {
      const lines = fileLinesMap.get(e.file);
      if (lines && deprecatedAbove(lines, e.line - 1)) { structural = true; evidence = `${e.file}:${e.line} (comment above the route registration)`; }
    }
    if (!structural && e.regLine) {
      const name = handlerToken(e.regLine);
      const def = name && handlerDefs.get(name);
      if (def) {
        const dLines = fileLinesMap.get(def.file);
        if (dLines) {
          if (deprecatedAbove(dLines, def.line - 1)) { structural = true; evidence = `${def.file}:${def.line} (comment above the handler)`; }
          else if (bodyIsGoneOrRedirectOnly(dLines, def.line - 1)) { structural = true; evidence = `${def.file}:${def.line} (handler body only returns 410/redirect)`; }
        }
      }
    }
    e.superseded = structural;
    if (structural) e.supersededEvidence = evidence;
  }
  // possiblySuperseded: no-screen, NOT structurally superseded, but its own path is a PREFIX of another
  // endpoint's path that IS used — e.g. a no-screen `/sync` right next to a used `/sync/preview`. A structural
  // (path-SHAPE) signal, never a comment-word match, so it holds regardless of the product's language — but
  // it's still only a "check this by hand" flag, not a claim, and stays IN the no-screen list.
  const usedNps = [...new Set(endpoints.filter(e => e.used).map(e => e.np))];
  for (const e of supersededCandidates) {
    if (e.superseded) continue;
    e.possiblySuperseded = usedNps.some(p => p.startsWith(e.np + "/"));
  }

  // confidence: only meaningful for no-screen endpoints (used=false, not infrastructure/product_excluded).
  // sure  = no part of the path appears anywhere on the frontend (last two segments, params wildcarded)
  //         (e.weakTrace is false — no single-segment match either) AND the endpoint is defined OUTSIDE the
  //         generated contract file (contractEndpoints only fills gaps from E.openapi; if e.file is that file,
  //         the endpoint itself came from the contract, there's no heuristically found code line).
  // shouldLookAt = there's a weak trace (a single-segment match — e.weakTrace) OR the endpoint only comes from
  //         the contract (a call set up dynamically/another way might not be visible in the line, can't be sure).
  const contractFileOf = e => !!E.openapi && e.file === E.openapi;
  for (const e of endpoints) {
    if (e.used || e.infrastructure || e.product_excluded || e.superseded || e.callers.length) { e.confidence = null; continue; }
    e.confidence = (e.weakTrace || contractFileOf(e)) ? "shouldLookAt" : "sure";
  }
  // superseded/caller-claimed endpoints drop out of "no screen" entirely (own sections below); possiblySuperseded
  // stays IN the list (it's only a flag, not a claim).
  const noScreenEndpoints = endpoints.filter(e => !e.used && !e.infrastructure && !e.product_excluded && !e.superseded && !e.callers.length);
  const noScreen = noScreenEndpoints.length;
  const noScreenSure = noScreenEndpoints.filter(e => e.confidence === "sure").length;
  const productExcludedCount = endpoints.filter(e => e.product_excluded).length;
  const supersededCount = endpoints.filter(e => e.superseded).length;
  const callerOnlyCount = endpoints.filter(e => !e.used && e.callers.length).length;
  const outwardGive = endpoints.map(e => ({
    method: e.method, path: e.path, file: e.file, line: e.line, area: e.area, used: e.used, usage: e.usage,
    ...(e.infrastructure ? { infrastructure: true } : {}),
    ...(e.product_excluded ? { product_excluded: true } : {}),
    ...(e.superseded ? { superseded: true, supersededEvidence: e.supersededEvidence } : {}),
    ...(e.possiblySuperseded ? { possiblySuperseded: true } : {}),
    ...(e.callers && e.callers.length ? { callers: e.callers } : {}),
    ...(e.confidence ? { confidence: e.confidence } : {}),
  }));
  // noScreen: stays for backward compat (sure + shouldLookAt combined, same count as the old behavior). no_screen_sure:
  // new, only the certain (sure) subset — consumers like lowhanging should use this field as their signal (see task report).
  return { type: "inventory", generated: new Date().toISOString(), ref: K.ref, estimate, backend_missing: false, total: outwardGive.length, noScreen, no_screen_sure: noScreenSure, product_excluded: productExcludedCount, superseded: supersededCount, caller_only: callerOnlyCount, endpoints: outwardGive };
}

function formatMd(R) {
  if (R.backend_missing) return `# Backend inventory\n\nNo backend found (no \`inventory.backend\` in sources.json, and no candidate folder at the repo root either). For this product, \`canwe\` only works from decisions/request document/rivals.\n`;
  const shouldLookAt = R.noScreen - R.no_screen_sure;
  let o = `# Backend inventory · ${R.ref}${R.estimate ? " · paths were estimated (no inventory block in sources.json)" : ""}\n\n${R.total} endpoints, ${R.no_screen_sure} definitely no-screen, ${shouldLookAt} should be checked${R.product_excluded ? ` (${R.product_excluded} endpoints excluded as outside the product surface — smoke/scripts/tools/mock)` : ""}.\n\n`;
  const groups = new Map();
  for (const e of R.endpoints) if (!e.used && !e.infrastructure && !e.product_excluded && !e.superseded && !(e.callers && e.callers.length)) { if (!groups.has(e.area)) groups.set(e.area, []); groups.get(e.area).push(e); }
  o += `## No screen\n\n`;
  if (!groups.size) o += "None; every matched endpoint is used on screen.\n\n";
  else for (const [area, es] of [...groups].sort((a, b) => b[1].length - a[1].length)) { o += `### ${area} (${es.length})\n\n`; for (const e of es) o += `- [${e.confidence === "sure" ? "sure" : "shouldLookAt"}] ${e.method} \`${e.path}\`${e.possiblySuperseded ? " — check: possibly superseded" : ""} — ${e.file}:${e.line}\n`; o += "\n"; }
  const used = R.endpoints.filter(e => e.used);
  const infrastructure = R.endpoints.filter(e => e.infrastructure);
  const productExcluded = R.endpoints.filter(e => e.product_excluded);
  const superseded = R.endpoints.filter(e => e.superseded);
  const callerOnly = R.endpoints.filter(e => !e.used && e.callers && e.callers.length);
  o += `## Used\n\n${used.length} endpoints are used on screen.${infrastructure.length ? ` ${infrastructure.length} infrastructure endpoints (health, metrics, debug) weren't counted since they don't expect a screen: ${infrastructure.slice(0, 6).map(e => `\`${e.path}\``).join(", ")}${infrastructure.length > 6 ? "…" : ""}.` : ""}\n`;
  if (productExcluded.length) o += `\n## Outside the product surface\n\n${productExcluded.length} endpoints weren't counted as no-screen because they're in smoke-test/script/tool/mock directories: ${productExcluded.slice(0, 6).map(e => `\`${e.path}\` (${e.file})`).join(", ")}${productExcluded.length > 6 ? "…" : ""}.\n`;
  if (superseded.length) o += `\n## Superseded (not counted)\n\n${superseded.length} endpoints weren't counted as no-screen — a structural signal (an OpenAPI \`deprecated: true\`, a \`@deprecated\`/\`Deprecated:\` tag, or a handler that only returns 410/redirects) marks them superseded: ${superseded.slice(0, 8).map(e => `\`${e.path}\` (${e.supersededEvidence})`).join("; ")}${superseded.length > 8 ? "…" : ""}.\n`;
  if (callerOnly.length) o += `\n## Callers, not a screen\n\n${callerOnly.length} endpoints have an in-repo caller outside the product's own screens (e.g. a browser extension or a release tool) — not counted as no-screen, but not a screen either: ${callerOnly.slice(0, 8).map(e => `\`${e.path}\` (caller: ${e.callers.map(c => c.name).join(", ")})`).join("; ")}${callerOnly.length > 8 ? "…" : ""}.\n`;
  return o;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), ji = argv.indexOf("--json"), jsonOut = ji >= 0 ? argv.splice(ji, 2)[1] : null;
  const pm = argv[0] || "pm";
  const R = works(pm);
  process.stdout.write(formatMd(R));
  if (jsonOut) fs.writeFileSync((fs.mkdirSync(path.dirname(jsonOut), { recursive: true }), jsonOut), JSON.stringify(R, null, 1));
}

export { works as compute };
