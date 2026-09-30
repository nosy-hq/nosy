// The secret detector, shared: privacy-scan.mjs (stops a send) and redact.mjs (hides a secret in a line of your code
// that a command is about to print) use the same rules. Patterns follow gitleaks and the common public prefixes of
// GitHub secret scanning. A library: no side effects.

export const Placeholder = /^(changeme|change[-_]?me|xxx+|todo|fixme|placeholder|your[-_]?\w*|example\w*|test\w*|dummy\w*|sample\w*|null|none|undefined|password|secret|token|redacted|\.\.\.|<[^>]{0,40}>|\$\{[^}]{0,40}\}|%[a-z_]+%)$/i;
export const shannon = s => { const f = {}; for (const c of s) f[c] = (f[c] || 0) + 1; const n = s.length; return -Object.values(f).reduce((t, k) => t + (k / n) * Math.log2(k / n), 0); };
// so sk-… values that overlap with OpenAI/Anthropic aren't double-counted under the generic "secret-assignment" rule:
export const INSTANT_SECRET_PATTERN_OF = /^(?:AKIA|ASIA)[0-9A-Z]{16}$|^(?:gh[pousr]_|github_pat_)|^xox[baprs]-|^(?:sk|rk)_live_|^AIza|^sk-ant-|^sk-(?!ant-)/;

// One engine scans every line. valueGroup: only that capture group is the secret ("password: " and the quotes stay).
export const SecretRules = [
  { type: "AWS access key", slug: "aws", severity: "high", category: "secret", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { type: "GitHub token", slug: "github", severity: "high", category: "secret", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{20,255})\b/g },
  { type: "Slack token", slug: "slack", severity: "high", category: "secret", re: /\bxox[baprs]-[A-Za-z0-9-]{10,72}\b/g },
  { type: "Stripe live key", slug: "stripe", severity: "high", category: "secret", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,99}\b/g },
  { type: "Google API key", slug: "google", severity: "high", category: "secret", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { type: "Anthropic API key", slug: "anthropic", severity: "high", category: "secret", re: /\bsk-ant-[A-Za-z0-9_-]{20,120}\b/g },
  { type: "OpenAI API key", slug: "openai", severity: "high", category: "secret", re: /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,150}\b/g },
  { type: "Private key block", slug: "private-key", severity: "high", category: "secret", re: /-----BEGIN[ A-Z0-9]*PRIVATE KEY-----/g },
  { type: "JWT", slug: "jwt", severity: "high", category: "secret", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}\b/g },
  { type: "Connection string password", slug: "connection-password", severity: "high", category: "secret", valueGroup: 1,
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s/:@'"]+:([^\s/@'"]+)@[^\s'"]+/gd,
    value: m => m[1], valid: value => !Placeholder.test(value.trim()) },
  { type: "password/secret/token/api_key assignment", slug: "secret-assignment", severity: "high", category: "secret", valueGroup: 2,
    re: /(?:password|secret|token|api[_-]?key)[\w.-]{0,20}\s*[:=]\s*(["'])((?:(?!\1).){6,240})\1/gid,
    value: m => m[2], valid: value => !Placeholder.test(value.trim()) && shannon(value) >= 3.0 && !INSTANT_SECRET_PATTERN_OF.test(value) },
];

// Values that are meant to be public or fake.
export function isPublicValue(rawLine, value) {
  if (/nosy:permit/.test(rawLine)) return true;
  if (/\b(sk|pk|rk)_test_/i.test(value)) return true;
  if (/EXAMPLE/.test(value)) return true; // e.g. AWS's EXAMPLE-suffixed key in its docs
  return Placeholder.test(value.trim());
}

// Spans of secret values in one line: [{index, length, slug}], not overlapping.
export function secretSpans(line) {
  const spans = [];
  for (const k of SecretRules) {
    k.re.lastIndex = 0; let m;
    while ((m = k.re.exec(line))) {
      const [a, b] = k.valueGroup && m.indices?.[k.valueGroup] ? m.indices[k.valueGroup] : [m.index, m.index + m[0].length];
      if (m.index === k.re.lastIndex) k.re.lastIndex++;
      const value = k.value ? k.value(m) : line.slice(a, b);
      if (k.valid && !k.valid(value, m)) continue;
      if (isPublicValue(line, value)) continue;
      spans.push({ index: a, length: b - a, slug: k.slug });
    }
  }
  spans.sort((x, y) => x.index - y.index || y.length - x.length);
  const merged = [];
  for (const s of spans) { const last = merged[merged.length - 1]; if (last && s.index < last.index + last.length) { last.length = Math.max(last.length, s.index + s.length - last.index); continue; } merged.push({ ...s }); }
  return merged;
}
