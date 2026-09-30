// Hides secrets in a line of the user's code before a command prints it. Nosy reads committed files through git; if a
// secret was committed, `nosy find`, `canwe` and the like would otherwise print the matching line to the agent's model.
// The file:line stays (so you can go and remove it); the value does not.
//   - a file that looks like it holds secrets (.env*, *.env, *.pem/.key/.p12…, id_rsa…, credentials*, secrets.*, .npmrc,
//     .netrc, *.tfvars…): a KEY=value / "key": "value" line keeps the key and loses the value; any other line is hidden whole;
//   - any other file: the values the secret detector recognises (cloud keys, tokens, private-key headers, connection-string
//     passwords, password = "…") are replaced, the rest of the line stays.
// A library: no side effects.
import { secretSpans } from "./secret-rules.mjs";

// Code and documentation files are never treated as secret files (credentials.ts, secrets.md, .env.d.ts): their lines go
// through the line rules below instead.
const CodeOrDoc = /\.(?:[cm]?[jt]sx?|py|go|rb|rs|java|kt|cs|php|swift|md|mdx|html?|css|scss|vue|svelte)$/i;
// Names that hold secrets by convention.
const SecretName = [
  /^\.env(\..+)?$/i, /\.env$/i, /^\.(npmrc|netrc|pgpass|htpasswd|pypirc|git-credentials)$/i,
  /\.(pem|key|p12|pfx|jks|keystore|ppk|kdbx|tfvars)$/i, /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /^credentials?([._-].*)?$/i, /^secrets?([._-].*)?$/i, /^service[-_]?account.*\.json$/i, /^client[-_]secrets?.*\.json$/i,
];
export function isSecretFile(file) {
  const base = String(file).split(/[\\/]/).pop();
  return !CodeOrDoc.test(base) && SecretName.some(re => re.test(base));
}

export const HIDDEN = "[redacted]";

export function redactLine(file, text) {
  const line = String(text);
  if (isSecretFile(file)) {
    const kv = line.match(/^(\s*(?:export\s+)?["']?[\w.-]+["']?\s*[:=]\s*)(.*)$/);
    if (kv && !/^\s*[#;/]/.test(line)) return kv[2].trim() === "" ? line : `${kv[1]}${HIDDEN}`;
    return line.trim() ? `${HIDDEN} (${String(file).split(/[\\/]/).pop()} holds secrets)` : line;
  }
  let out = line;
  for (const s of secretSpans(line).sort((a, b) => b.index - a.index)) out = out.slice(0, s.index) + HIDDEN + out.slice(s.index + s.length);
  return out;
}
