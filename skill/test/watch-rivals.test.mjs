// Contract test for skill/tools/watch-rivals.mjs against a local HTTP server (no network): the first run saves a
// baseline; a new sentence on the changelog marks the rival "changed" and quotes it; a counter move on the landing
// page stays "same" but a price move on the pricing page is a change; a failing page is reported as not read instead of crashing; pages come from "## Sources".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { temporary, clean, Tool } from "./helpers.mjs";

let server, base, pm;
const pages = {
  "/": "<html><head><script>var t=1</script></head><body><h1>Acme tracks every rival for you.</h1><p>Visitors this week: 1204 and counting today.</p></body></html>",
  "/changelog": "<ul><li>Sept 2026: Battlecards now export to PDF for every sales rep.</li></ul>",
  "/pricing": "<p>Team plan costs $49 per seat per month, billed yearly.</p>",
};
before(async () => {
  server = http.createServer((q, r) => { if (q.url === "/broken") { r.writeHead(500); return r.end(); } const b = pages[q.url]; if (b == null) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": "text/html" }); r.end(b); });
  await new Promise(res => server.listen(0, "127.0.0.1", res));
  base = `http://127.0.0.1:${server.address().port}`;
  pm = temporary("nosy-watch-");
  fs.mkdirSync(path.join(pm, "rivals"), { recursive: true });
  fs.writeFileSync(path.join(pm, "rivals", "acme.md"), `# Acme\n\n## Loop matrix\n\n## Sources\n- ${base}/ (read 2026-09-28)\n- ${base}/changelog (read 2026-09-28)\n- ${base}/pricing (read 2026-09-28)\n- https://news.example.org/acme-raises (read 2026-09-28)\n`);
  fs.writeFileSync(path.join(pm, "rivals", "gone.md"), `# Gone\n\n## Sources\n- http://127.0.0.1:1/broken (read 2026-09-28)\n`);
  fs.writeFileSync(path.join(pm, "rivals", "_TEMPLATE.md"), "# <Product name>\n");
});
after(() => { server.close(); clean(pm); });

// The server lives in this process, so the script must run asynchronously (spawnSync would block the server).
const watch = () => new Promise(res => {
  const json = path.join(pm, "state", "watch.json");
  const c = spawn(process.execPath, [path.join(Tool, "watch-rivals.mjs"), pm, "--json", json, "--timeout", "5000"]);
  let out = "", err = ""; c.stdout.on("data", d => out += d); c.stderr.on("data", d => err += d);
  c.on("close", code => res({ code, out, err, j: fs.existsSync(json) ? JSON.parse(fs.readFileSync(json, "utf8")) : null }));
});
const rival = (j, slug) => j.rivals.find(r => r.slug === slug);

test("first run is a baseline; pages come from the rival's own host in ## Sources", async () => {
  const r = await watch();
  assert.equal(r.code, 0, r.err);
  const a = rival(r.j, "acme");
  assert.equal(a.state, "baseline");
  assert.deepEqual(a.pages.map(p => new URL(p.url).pathname).sort(), ["/", "/changelog", "/pricing"], "press links on another host are not watched");
  assert.equal(rival(r.j, "gone").state, "unreachable");
  assert.ok(!r.j.rivals.some(x => x.slug.startsWith("_")), "the template is not a rival");
});

test("a new changelog sentence and a price move mark the rival changed; a visitor counter doesn't", async () => {
  pages["/changelog"] = "<ul><li>Oct 2026: Win-loss interviews are now built in for every plan.</li><li>Sept 2026: Battlecards now export to PDF for every sales rep.</li></ul>";
  pages["/"] = pages["/"].replace("1204", "1377");
  pages["/pricing"] = pages["/pricing"].replace("$49", "$59");
  const r = await watch();
  assert.equal(r.code, 0, r.err);
  const a = rival(r.j, "acme");
  assert.equal(a.state, "changed");
  const ch = a.pages.find(p => p.url.endsWith("/changelog"));
  assert.equal(ch.status, "changed");
  assert.ok(ch.added.some(s => /Win-loss interviews/.test(s)), JSON.stringify(ch.added));
  assert.equal(a.pages.find(p => p.url.endsWith("/")).status, "same", "a visitor counter is noise");
  const pr = a.pages.find(p => p.url.endsWith("/pricing"));
  assert.equal(pr.status, "changed", "on a pricing page a price move is the change we want");
  assert.ok(pr.added.some(s => /\$59/.test(s)));
  assert.match(r.out, /## Changed[\s\S]*Acme[\s\S]*Win-loss interviews/);
});

test("a third run with no change says unchanged", async () => {
  const r = await watch();
  assert.equal(rival(r.j, "acme").state, "same");
  assert.match(r.out, /Unchanged: Acme/);
});
