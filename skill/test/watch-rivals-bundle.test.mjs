// watch-rivals.mjs on a JavaScript-built page (empty HTML shell, copy compiled into a same-origin bundle): the marketing
// sentences in the bundle are the page's sentences, framework noise is left out, a changed sentence shows as changed on
// the next run, and a page with neither text nor scripts is still reported as unreadable. Local HTTP server, no network.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { temporary, clean, Tool } from "./helpers.mjs";

let server, base, pm;
const shell = `<!doctype html><html><head><title>Caddie</title><script type="module" crossorigin src="/assets/index-abc123.js"></script></head><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript></body></html>`;
const bundle = v => `var a=1;function Z(){return jsx("h1",{children:"Caddie reads your backlog and tells you what to build next."})}
const b="Every Friday it sends a short digest of what your rivals shipped this week.";
const c='${v}';
throw Error("Minified React error #418; visit https://reactjs.org/docs/error-decoder.html for the full message or use the non-minified dev environment.");
const d="Invalid hook call. Hooks can only be called inside of the body of a function component, useState must be used carefully.";
const e="mousedown mouseup mousemove touchstart touchend touchmove keydown keyup";
const f="flex items-center justify-between px-4 py-2 text-sm font-medium rounded-lg";
const g="Expected a string for the prop children but received undefined here";`;
const pages = {
  "/": { type: "text/html", body: shell },
  "/assets/index-abc123.js": { type: "text/javascript", body: bundle("Teams pick the plan that fits their roadmap, billed monthly.") },
  "/bare": { type: "text/html", body: `<html><head><title>x</title></head><body><div id="root"></div></body></html>` },
};
before(async () => {
  server = http.createServer((q, r) => { const p = pages[q.url]; if (!p) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": p.type }); r.end(p.body); });
  await new Promise(res => server.listen(0, "127.0.0.1", res)); server.unref();
  base = `http://127.0.0.1:${server.address().port}`;
  pm = temporary("nosy-watch-js-");
  fs.mkdirSync(path.join(pm, "rivals"), { recursive: true });
  fs.writeFileSync(path.join(pm, "rivals", "caddie.md"), `# Caddie\n\n## Sources\n- ${base}/ (read 2026-09-28)\n`);
  fs.writeFileSync(path.join(pm, "rivals", "bare.md"), `# Bare\n\n## Sources\n- ${base}/bare (read 2026-09-28)\n`);
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ watch: { bare: [`${base}/bare`] } })); // not the site root, which is the shell above
});
after(() => { server.close(); server.closeAllConnections?.(); clean(pm); });

const watch = () => new Promise(res => {
  const json = path.join(pm, "state", "watch.json");
  const c = spawn(process.execPath, [path.join(Tool, "watch-rivals.mjs"), pm, "--json", json, "--timeout", "5000"]);
  let out = "", err = ""; c.stdout.on("data", d => out += d); c.stderr.on("data", d => err += d);
  c.on("close", code => res({ code, out, err, j: fs.existsSync(json) ? JSON.parse(fs.readFileSync(json, "utf8")) : null }));
});
const rival = (j, slug) => j.rivals.find(r => r.slug === slug);
const saved = slug => JSON.parse(fs.readFileSync(path.join(pm, "history", "watch", `${slug}.json`), "utf8"))[`${base}/`]?.sentences || [];

test("a JavaScript-built page gets its sentences from the bundle, without framework noise", async () => {
  const r = await watch();
  assert.equal(r.code, 0, r.err);
  const c = rival(r.j, "caddie");
  assert.equal(c.state, "baseline");
  assert.equal(c.pages[0].status, "baseline");
  const s = saved("caddie");
  assert.ok(s.some(x => /reads your backlog and tells you what to build next/.test(x)), JSON.stringify(s));
  assert.ok(s.some(x => /digest of what your rivals shipped/.test(x)));
  assert.ok(s.some(x => /Teams pick the plan/.test(x)));
  assert.equal(c.pages[0].sentences, 3, JSON.stringify(s));
  for (const noise of [/Minified|React|useState|Hooks can only/, /mousedown/, /flex items-center/, /Expected a string/, /enable JavaScript/]) {
    assert.ok(!s.some(x => noise.test(x)), `noise kept: ${noise} in ${JSON.stringify(s)}`);
  }
});

test("a page with neither text nor scripts is still unreadable", async () => {
  const r = await watch();
  const b = rival(r.j, "bare");
  assert.equal(b.state, "unreachable");
  assert.match(b.pages[0].error, /no readable text/);
  assert.match(r.out, /Bare[\s\S]*no readable text/);
});

test("a changed sentence in the bundle shows as changed on the next run; an unchanged bundle stays same", async () => {
  let r = await watch();
  assert.equal(rival(r.j, "caddie").state, "same");
  pages["/assets/index-abc123.js"].body = bundle("Teams pick the plan that fits their roadmap, billed yearly only.");
  r = await watch();
  const c = rival(r.j, "caddie");
  assert.equal(c.state, "changed");
  assert.equal(c.pages[0].added_count, 1);
  assert.equal(c.pages[0].removed_count, 1);
  assert.match(c.pages[0].added[0], /billed yearly only/);
  assert.match(r.out, /## Changed[\s\S]*Caddie[\s\S]*billed yearly only/);
});
