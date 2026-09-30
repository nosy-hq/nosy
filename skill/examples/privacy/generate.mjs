// Generates sample data for privacy-scan.mjs: fake secrets/personal data are assembled from PARTS at
// runtime, none of them sit as a fixed string in this file (so a real-pattern secret never lands in the repo).
// Usage: node generate.mjs <output-folder> [--json <file>]   Always point the output folder outside the repo.
// Source: the "Never your data" shield task — gitleaks/GitHub secret scanning prefix patterns, the Turkish
// national ID (TCKN)/IBAN/Luhn official checksum algorithms.
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const al = (name) => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const jsonOut = al("--json");
const out = argv[0];
if (!out) { console.error("Usage: node generate.mjs <output-folder> [--json <file>]"); process.exit(2); }

// ---- Turkish sample name/pattern data for the deny-list matching feature (see skill/data/lang/tr/generate.json) ----
const here = path.dirname(fileURLToPath(import.meta.url));
const trData = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "data", "lang", "tr", "generate.json"), "utf8"));

const ri = (n) => crypto.randomInt(n);
const rndAlnum = (n, letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") => Array.from({ length: n }, () => letters[ri(letters.length)]).join("");
const rndDigits = (n) => Array.from({ length: n }, () => ri(10)).join("");
const digitRunDirt = (s) => s.replace(/\d{11,}/g, (m) => m.slice(0, Math.floor(m.length / 2)) + "g" + m.slice(Math.floor(m.length / 2) + 1)); // 11+ digits in a row can false-positive as a TCKN/card number

// ---- checksum-valid fake personal data generation ----
function tcknGenerate() { const d = [1 + ri(9), ...Array.from({ length: 8 }, () => ri(10))]; const single = d[0] + d[2] + d[4] + d[6] + d[8], pair = d[1] + d[3] + d[5] + d[7]; const d10 = (((single * 7 - pair) % 10) + 10) % 10; const d11 = (single + pair + d10) % 10; return [...d, d10, d11].join(""); }
function ibanGenerate() { const bban = rndDigits(22); const remaining97 = (s) => { let k = 0n; for (const ch of s) k = (k * 10n + BigInt(ch)) % 97n; return k; }; const check = (98n - remaining97(bban + "2927" + "00")).toString().padStart(2, "0"); return "TR" + check + bban; }
function cardGenerate() { const body = "4" + rndDigits(14); let sum = 0, dbl = true; for (let i = body.length - 1; i >= 0; i--) { let n = +body[i]; if (dbl) { n *= 2; if (n > 9) n -= 9; } sum += n; dbl = !dbl; } return body + ((10 - (sum % 10)) % 10); }

// ---- one part-assembled fake sample per type (the full pattern is never fixed anywhere in a single line) ----
const Example = {
  aws: ["AKIA", rndAlnum(16, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")].join(""),
  github: ["ghp_", rndAlnum(40)].join(""),
  slack: ["xoxb", "-", rndDigits(11), "-", rndDigits(11), "-", rndAlnum(24)].join(""),
  stripe: ["sk", "_live_", rndAlnum(24)].join(""),
  google: ["AIza", rndAlnum(35, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")].join(""),
  anthropic: ["sk-ant-", "api03-", rndAlnum(60)].join(""),
  openai: ["sk-", "proj-", rndAlnum(48)].join(""),
  jwt: [Buffer.from(JSON.stringify({ algorithm: "HS256", type: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ feb: "trial", name: "test" })).toString("base64url"), rndAlnum(43)].join("."),
  connection: ["postgres://", "demo_user", ":", rndAlnum(18), "@", "db.example-host.internal:5432/app"].join(""),
  general: rndAlnum(32),
  email: "sample.user@example-domain.com",
  wireTr: ["+90 ", "532 ", rndDigits(3), " ", rndDigits(2), " ", rndDigits(2)].join(""),
  wireE164: ["+1 415 555 ", rndDigits(4)].join(""),
  tckn: tcknGenerate(),
  iban: ibanGenerate(),
  card: cardGenerate(),
  privateIp: ["192.168.", ri(255), ".", ri(255)].join(""),
  localPath: ["/Users/", "example-", rndAlnum(6).toLowerCase(), "/Desktop/hidden-notes/plan.txt"].join(""),
  internalHost: "source-server.internal",
  localhost: ["http://localhost:", 3000 + ri(999), "/api/panel"].join(""),
  // Turkish sample data on purpose (loaded from skill/data/lang/tr/generate.json): a fake Turkish name to
  // prove the deny-list matcher's Turkish-insensitive matching (pm/private.json.names → matches the sample
  // name case- and diacritic-insensitively) still works.
  hiddenName: trData.hiddenName,
  hiddenPattern: "customer-" + rndDigits(4), // pm/private.json.patterns → trData.denyListPattern
  permittedDomain: "contact@example-safe.com", // pm/private.json.permission → "example-safe.com" (should be suppressed)
};
const privateKey = ["-----BEGIN RSA PRIVATE KEY-----", ...Array.from({ length: 4 }, () => rndAlnum(64, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")), "-----END RSA PRIVATE KEY-----"].join("\n");

fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(out, "pm"), { recursive: true });

// ---- pm/private.json: deny-list ----
fs.writeFileSync(path.join(out, "pm", "private.json"), JSON.stringify({ names: trData.denyListNames, patterns: [trData.denyListPattern], permission: ["example-safe.com"] }, null, 1));

// ---- leak-present.md: one of each type, with headings for file:line evidence ----
const md = `# Sample: content that must not be published

This file was generated at runtime by \`generate.mjs\`; none of the secrets are real.

## Secrets
- AWS access key: ${Example.aws}
- GitHub token: ${Example.github}
- Slack token: ${Example.slack}
- Stripe live key: ${Example.stripe}
- Google API key: ${Example.google}
- Anthropic API key: ${Example.anthropic}
- OpenAI API key: ${Example.openai}
- JWT: ${Example.jwt}
- Connection string: ${Example.connection}
- Generic assignment: \`api_key: "${Example.general}"\`

\`\`\`
${privateKey}
\`\`\`

## Personal data
- Email: ${Example.email}
- Phone (TR): ${Example.wireTr}
- Phone (E.164): ${Example.wireE164}
- Turkish national ID (TCKN): ${Example.tckn}
- IBAN: ${Example.iban}
- Card number: ${Example.card}
- Private IP: ${Example.privateIp}

## Nosy-specific
- Local path: ${Example.localPath}
- Internal host: ${Example.internalHost}
- Localhost: ${Example.localhost}
- Deny-list name: met with customer ${Example.hiddenName}
- Deny-list pattern: record ${Example.hiddenPattern}
- Permitted domain (should be suppressed): ${Example.permittedDomain}
`;
fs.writeFileSync(path.join(out, "leak-present.md"), md);

// ---- leak-present.html: the same samples inside a <script> JS array (Nosy page pattern) ----
const lineStartOf = []; // put each sample on its own line: to manually verify line-number accuracy
for (const [k, v] of Object.entries(Example)) { const field = k === "general" ? "api_key" : "value"; lineStartOf.push(`  { type: "${k}", ${field}: "${String(v).replace(/"/g, '\\"')}" },`); }
const html = `<meta charset="utf-8"><title>Sample page</title>
<body>
<h1>Sample decision page</h1>
<p>Verifies that privacy-scan.mjs also scans data inside HTML &lt;script&gt; blocks.</p>
<script>
const DATA = [
${lineStartOf.join("\n")}
];
const PRIVATE_KEY = \`${privateKey}\`;
console.log(DATA.length);
</script>
</body>`;
fs.writeFileSync(path.join(out, "leak-present.html"), html);

// ---- clean.md: a file that should produce zero findings ----
const commitHash = digitRunDirt(crypto.randomBytes(20).toString("hex"));
const uuid = digitRunDirt(crypto.randomUUID());
const dataUri = "data:font/woff2;base64," + crypto.randomBytes(60).toString("base64");
const clean = `# Sample: clean file (no findings expected)

- Commit: \`${commitHash}\`
- UUID: \`${uuid}\`
- Color: \`#2F6F8F\`
- Contact: contact@example.com
- Font: \`${dataUri}\`

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
`;
fs.writeFileSync(path.join(out, "clean.md"), clean);

// ---- report ----
let o = `# Privacy sample data generated · ${out}\n\n| File | Purpose |\n|---|---|\n`;
o += `| leak-present.md | ${Object.keys(Example).length + 1} types, at least one sample each |\n| leak-present.html | same samples, as a JS array inside \`<script>\` |\n| clean.md | zero findings expected |\n| pm/private.json | deny-list: ${JSON.parse(fs.readFileSync(path.join(out, "pm", "private.json"), "utf8")).names.join(", ")} |\n`;
o += `\nVerify: \`node ../../tools/privacy-scan.mjs ${out} --pm ${path.join(out, "pm")} --all\`\n`;
process.stdout.write(o);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ type: "privacy-example", generated: new Date().toISOString(), folder: out, kinds: Object.keys(Example) }, null, 1));
