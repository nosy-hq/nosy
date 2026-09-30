// "Never your data" shield: looks for secrets and personal data before tea/spill write anything
// outbound (Artifact, PRD, issue).
// Usage: node privacy-scan.mjs <file|folder>... [--pm <pm>] [--json <file>] [--mask <output>] [--all] [--names a,b,c]
//   --pm: reads <pm>/private.json ({names,patterns,permission}). --mask: writes a copy with findings
//   replaced by [hidden:type] (output file for a single input file, output folder for multiple inputs).
//   --all: also lists low severity in the table. --names: more names to look for (the people who wrote the commits,
//   say); each one found in free text is a finding of the "personal" kind.
// Exit code 2 when a send must stop: a secret (always high severity) or personal data (e-mail, phone, IBAN, card number,
// national ID, or a name from private.json / --names). Notes about your machine (a home-directory path, a private IP,
// an internal hostname) are listed but do not stop a send. tea, spill, notify and publish call this before sending;
// notify and publish can be told to go on anyway with --allow-sensitive.
// Patterns: gitleaks (config/gitleaks.toml) and GitHub secret scanning's public common prefixes; for
// personal data, the Turkish national ID (TCKN)/IBAN official checksum algorithms, Luhn for card numbers.
import fs from "node:fs"; import path from "node:path";
import { luhnValid, tcknValid, ibanValid, ibanSpans, phoneSpans } from "./pii.mjs";
import { SecretRules, Placeholder, shannon } from "./secret-rules.mjs";

const argv = process.argv.slice(2);
const al = (name) => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const pmPath = al("--pm"), jsonOut = al("--json"), maskOut = al("--mask"), extraNames = (al("--names") || "").split(",").map(x => x.trim()).filter(Boolean);
const hi = argv.indexOf("--all"), all = hi >= 0; if (all) argv.splice(hi, 1);
const input = argv;
if (!input.length) { console.error("Usage: node privacy-scan.mjs <file|folder>... [--pm <pm>] [--json <file>] [--mask <output>] [--all] [--names a,b,c]"); process.exit(1); }

// ---- helpers: masking, Turkish-insensitive normalize, checksum algorithms ----
const mask = (s, on = 4, last = 2) => { s = String(s); return s.length <= on + last + 1 ? s[0] + "*".repeat(Math.max(1, s.length - 1)) : `${s.slice(0, on)}****…${s.slice(-last)}`; };
const maskEmail = (s) => { const [l, d] = s.split("@"); return (l.length <= 2 ? l[0] + "*" : l.slice(0, 2) + "*".repeat(l.length - 2)) + "@" + d; };
const maskPhone = (s) => { const d = s.replace(/\D/g, ""); return d.slice(0, 3) + "*".repeat(Math.max(3, d.length - 5)) + d.slice(-2); };
const maskCard = (s) => { const d = s.replace(/[\s-]/g, ""); return "*".repeat(d.length - 4) + d.slice(-4); };
const trNorm = (s) => String(s).replace(/[İIı]/g, "i").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g").replace(/[Üü]/g, "u").replace(/[Öö]/g, "o").replace(/[Çç]/g, "c").toLowerCase();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const Priority = (b) => (b.category === "secret" ? 0 : b.category === "personal" ? 1 : 2) * 10 + (b.severity === "high" ? 0 : b.severity === "medium" ? 1 : 2); // smaller = more precise/important; picks the label for overlapping spans

// ---- private.json (deny-list): { names:[...], patterns:[...], permission:[...] } ----
let hiddenNames = [], hiddenPatterns = [], hiddenPermission = [];
if (pmPath) { try { const g = JSON.parse(fs.readFileSync(path.join(pmPath, "private.json"), "utf8")); hiddenNames = g.names || []; hiddenPatterns = g.patterns || []; hiddenPermission = g.permission || []; } catch {} }

// ---- allow-list: example domains, test keys, documented sample keys, a nosy:permit line, private.json.permission ----
function isPermitted(rawLine, value) {
  if (/nosy:permit/.test(rawLine)) return true;
  if (/co-authored-by/i.test(rawLine)) return true; // attribution line: the email is already there to be published
  if (/^noreply@/i.test(value)) return true;
  if (/\b(sk|pk|rk)_test_/i.test(value)) return true;
  if (/EXAMPLE/.test(value)) return true; // e.g. AWS's EXAMPLE-suffixed key in its docs
  if (/\bexample\.(com|org|net)\b/i.test(value)) return true;
  if (Placeholder.test(value.trim())) return true;
  return hiddenPermission.some(s => s && (rawLine.includes(s) || value.includes(s)));
}

// ---- rule table: one engine scans every line. norm:true → scan against Turkish-insensitive normalized text.
// finder: a function that returns the spans itself (IBAN and phone numbers need more than one regex). ----
const Rules = [
  ...SecretRules,
  { type: "E-mail", slug: "email", severity: "medium", category: "personal", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, maskDraw: maskEmail },
  { type: "Phone", slug: "phone", severity: "medium", category: "personal", finder: phoneSpans, maskDraw: maskPhone }, // Turkish, +/00 international, US, UK
  { type: "Turkish national ID (TCKN)", slug: "tckn", severity: "medium", category: "personal", re: /\b\d{11}\b/g, valid: (value) => tcknValid(value), maskDraw: (s) => mask(s, 1, 2) },
  { type: "IBAN", slug: "iban", severity: "medium", category: "personal", finder: ibanSpans, maskDraw: (s) => mask(s.replace(/\s/g, ""), 4, 2) }, // any country: registry length + mod-97
  { type: "Card number", slug: "card-no", severity: "medium", category: "personal", re: /(?<![\d/])(?:\d[ -]?){12,18}\d\b/g, valid: (value) => luhnValid(value), maskDraw: maskCard },
  { type: "Private IP", slug: "private-ip", severity: "medium", category: "nosy", re: /\b(?:10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2})\b/g,
    maskDraw: (s) => s.replace(/\.\d{1,3}$/, ".***") },
  { type: "Local home directory path", slug: "local-path", severity: "medium", category: "nosy", re: /(?:\/Users\/|\/home\/|C:\\Users\\)([A-Za-z0-9._-]{2,32})[/\\]/g,
    valid: (_d, m) => !/^\d+$/.test(m[1]), // a purely numeric "username" isn't a real home directory, it's a URL segment like businesswire.com/news/home/2025…
    maskDraw: (s) => s.replace(/([/\\](?:Users|home)[/\\])[A-Za-z0-9._-]{2,32}([/\\])/, "$1***$2") },
  { type: "Internal hostname", slug: "internal-host", severity: "medium", category: "nosy", re: /\b[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.(?:internal|local|corp)\b/gi },
  { type: "localhost:port", slug: "localhost", severity: "low", category: "nosy", re: /\blocalhost:\d{2,5}\b/g },
];

// Names are personal data: the ones in private.json and the ones given with --names (commit authors, for example).
const nameList = [...new Set([...hiddenNames, ...extraNames])];
for (const name of nameList) { const n = trNorm(name).trim(); if (n.length < 3) continue; Rules.push({ type: `name: ${name}`, slug: "hidden-name", severity: "medium", category: "personal", norm: true, re: new RegExp(`(?<![a-z0-9])${escRe(n)}(?![a-z0-9])`, "gi") }); }
if (pmPath) {
  hiddenPatterns.forEach((d, i) => { try { Rules.push({ type: `private.json pattern #${i + 1}`, slug: "hidden-pattern", severity: "medium", category: "nosy", re: new RegExp(d, "g") }); } catch (e) { console.error(`private.json pattern #${i + 1} is broken: ${e.message}`); } });
}

// ---- file collection: .md .html .json .jsonl .txt .csv .mjs .js, excluding node_modules/.git ----
const External = new Set(["node_modules", ".git"]), Extension = new Set([".md", ".html", ".json", ".jsonl", ".txt", ".csv", ".mjs", ".js"]);
function aggregate(p, acc = []) {
  let st; try { st = fs.statSync(p); } catch { return acc; }
  if (st.isDirectory()) { if (External.has(path.basename(p))) return acc; for (const name of fs.readdirSync(p)) aggregate(path.join(p, name), acc); }
  else if (Extension.has(path.extname(p).toLowerCase())) acc.push(p);
  return acc;
}
const files = [...new Set(input.flatMap(g => aggregate(g)))];

// ---- scan ----
const start = Date.now();
const findings = []; // {file, line, type, slug, severity, category, part, index, length}
const maskedLines = new Map(); // file -> line array (for masking, in a second pass)

for (const file of files) {
  let content; try { content = fs.readFileSync(file, "utf8"); } catch { continue; }
  const lines = content.split(/\r\n|\n/);
  const fileFindings = [];
  lines.forEach((rawLine, i) => {
    for (const k of Rules) {
      const text = k.norm ? trNorm(rawLine) : rawLine;
      // every rule yields hits: {index, length, m} (m = the regex match, for rules with a capture group)
      const hits = [];
      if (k.finder) for (const x of k.finder(text)) hits.push({ index: x.index, length: x.length, m: null });
      else {
        k.re.lastIndex = 0; let m;
        while ((m = k.re.exec(text))) {
          // if valueGroup is set (password/assignment etc.) only that capture group's span is masked; "key: " and quotes stay.
          const [gHead, gBit] = k.valueGroup && m.indices?.[k.valueGroup] ? m.indices[k.valueGroup] : [m.index, m.index + m[0].length];
          if (m.index === k.re.lastIndex) k.re.lastIndex++;
          hits.push({ index: gHead, length: gBit - gHead, m });
        }
      }
      for (const { index, length, m } of hits) {
        const raw = rawLine.slice(index, index + length);
        const value = k.value && m ? k.value(m) : raw;
        if (k.valid && !k.valid(value, m)) continue;
        if (isPermitted(rawLine, value)) continue;
        const severity = k.severity;
        const part = k.maskDraw ? k.maskDraw(value) : mask(value);
        fileFindings.push({ file, line: i + 1, type: k.type, slug: k.slug, severity, category: k.category, part, index, length });
      }
    }
  });
  // density: if a file has >=5 personal-data findings, all of them get bumped to high (spec: "medium; high if dense")
  const personal = fileFindings.filter(b => b.category === "personal");
  if (personal.length >= 5) personal.forEach(b => { if (b.severity === "medium") { b.severity = "high"; b.density = true; } });
  findings.push(...fileFindings);
  maskedLines.set(file, { lines: lines.slice(), fileFindings });
}
const duration = Date.now() - start;

// ---- --mask: copy with findings replaced by [hidden:slug] ----
if (maskOut) {
  const singleFile = input.length === 1 && fs.existsSync(input[0]) && fs.statSync(input[0]).isFile();
  for (const file of files) {
    const record = maskedLines.get(file); if (!record) continue;
    const lines = record.lines.slice();
    const groups = new Map(); // line no -> [finding] (by index, to avoid overlaps)
    for (const b of record.fileFindings) { if (!groups.has(b.line - 1)) groups.set(b.line - 1, []); groups.get(b.line - 1).push(b); }
    for (const [lineNo, list] of groups) {
      let s = lines[lineNo];
      // overlapping/nested spans (e.g. an email/host match inside a connection-string password) break a plain
      // left-to-right slice: merge them first and only remove the widest, non-overlapping ranges.
      const ordered = list.slice().sort((a, c) => a.index - c.index || (c.length - a.length));
      const merged = [];
      for (const b of ordered) {
        const last = merged[merged.length - 1];
        if (last && b.index < last.index + last.length) {
          last.length = Math.max(last.length, b.index + b.length - last.index); // merge the span (for full masking)
          if (Priority(b) < Priority(last)) last.slug = b.slug; // but keep the more precise/important label (e.g. "connection password" not "email")
          continue;
        }
        merged.push({ ...b });
      }
      for (const b of merged.sort((a, c) => c.index - a.index)) s = s.slice(0, b.index) + `[hidden:${b.slug}]` + s.slice(b.index + b.length);
      lines[lineNo] = s;
    }
    // private key block: the BEGIN line was already [hidden:]'d in the pass above; the body (between BEGIN and
    // END, END included) doesn't match any single rule, so it's closed in a separate pass. Detection always
    // runs against the ORIGINAL lines.
    const beginRe = /-----BEGIN[ A-Z0-9]*PRIVATE KEY-----/, endRe = /-----END[ A-Z0-9]*PRIVATE KEY-----/;
    for (let i = 0; i < record.lines.length; i++) {
      if (!beginRe.test(record.lines[i])) continue;
      let j = i + 1;
      while (j < record.lines.length && !endRe.test(record.lines[j])) { lines[j] = "[hidden:private-key]"; j++; }
      if (j < record.lines.length) {
        // close the END line too, but like the BEGIN line only replace the matched part: if the same line has a
        // closing quote/backtick after it (e.g. the end of a template string), keep that suffix, don't wipe the whole line.
        const eOrig = record.lines[j], em = eOrig.match(endRe);
        lines[j] = em ? eOrig.slice(0, em.index) + "[hidden:private-key]" + eOrig.slice(em.index + em[0].length) : "[hidden:private-key]";
      }
      i = j;
    }
    const maskedText = lines.join("\n");
    let goalPath;
    if (singleFile) goalPath = maskOut;
    else { const rel = path.isAbsolute(file) ? file.replace(/^\/+/, "").replace(/^[A-Za-z]:[\\/]/, "") : file; goalPath = path.join(maskOut, rel); }
    fs.mkdirSync(path.dirname(goalPath), { recursive: true });
    fs.writeFileSync(goalPath, maskedText);
  }
}

// ---- output ----
const numbers = { "high": 0, "medium": 0, "low": 0 };
findings.forEach(b => numbers[b.severity]++);
// What stops a send: any secret, and any personal data (e-mail, phone, IBAN, card, national ID, a listed name).
// Notes about your machine (category "nosy": home path, private IP, internal host) are shown but never stop it.
const blocking = findings.filter(b => b.category === "secret" || (b.category === "personal" && b.severity !== "low"));
numbers.blocking = blocking.length;
const toBeShown = findings.filter(b => all || b.severity !== "low").sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

let o = `# Privacy scan · ${new Date().toISOString().slice(0, 16).replace("T", " ")}\n\n`;
o += `${files.length} files · ${duration}ms · high ${numbers["high"]} · medium ${numbers["medium"]} · low ${numbers["low"]}${all ? "" : " (low hidden from table, show with --all)"}\n\n`;
o += blocking.length ? `**${blocking.length} finding${blocking.length === 1 ? "" : "s"} stop a send** (secrets or personal data).\n\n` : "";
o += `| File:line | Type | Severity | Part |\n|---|---|---|---|\n`;
toBeShown.forEach(b => { o += `| ${b.file}:${b.line} | ${b.type} | ${b.severity}${b.density ? " (dense)" : ""} | \`${String(b.part).replace(/\|/g, "/")}\` |\n`; });
if (!toBeShown.length) o += `| – | – | – | no findings |\n`;
process.stdout.write(o);

if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ type: "privacy", generated: new Date().toISOString(), files: files.length, durationMs: duration,
  findings: findings.map(({ file, line, type, severity, part }) => ({ file, line, type, severity, part })), numbers }, null, 1));

// Exit contract (docs/CLI-CONTRACT.md): 2 = a secret or personal data, don't send; 1 = couldn't run.
process.exit(blocking.length || numbers["high"] > 0 ? 2 : 0);
