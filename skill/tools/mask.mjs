// Privacy masking for quotes (shared): what it masks, and only that. Customer text is passed through mask() before it
// is printed or written (collect-signals.mjs, interview-themes.mjs use exactly the same rules); the raw value is never printed.
//   masked:      e-mail addresses; IBANs of any country (registry length + mod-97) and Turkish-shaped IBANs; payment card
//                numbers (Luhn); phone numbers (Turkish mobile and landline, international +/00 numbers, US/Canada and UK
//                forms); Turkish national ID numbers (checksum); key=, token=, password= values.
//   NOT masked:  names, postal addresses, other kinds of ID, and phone numbers written without a country prefix or
//                separators outside Turkey, the US and the UK. Nothing here can find a name.
import fs from "node:fs"; import path from "node:path";
import { fileURLToPath } from "node:url";
import { tcknValid, ibanSpans, cardSpans, phoneSpans, replaceSpans, EmailRe } from "./pii.mjs";

export const mask = t => {
  let s = String(t).replace(EmailRe, "[email]");
  s = replaceSpans(s, ibanSpans(s), "[iban]");
  s = s.replace(/\bTR\d{2}(?:[ ]?\d{4}){5}[ ]?\d{2}\b/gi, "[iban]"); // Turkish shape, kept even when the check digits are wrong
  s = replaceSpans(s, cardSpans(s), "[card]");
  s = replaceSpans(s, phoneSpans(s), "[phone]");
  return s
    .replace(/\b\d{11}\b/g, m => tcknValid(m) ? "[national id]" : m)
    .replace(/\b((?:token|key|secret|auth|api[_-]?key|password|pwd)\s*=\s*)[^&\s]+/gi, "$1***");
};

// Library, not a CLI: a misdirected `node mask.mjs ...` would otherwise print nothing
// and exit 0. Callers are found at runtime by scanning skill/tools/*.mjs for an import of this file.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const self = "mask.mjs";
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const callers = fs.readdirSync(dir).filter(f => f.endsWith(".mjs") && f !== self)
    .filter(f => { try { return new RegExp(`["']\\./${self}["']`).test(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return false; } }).sort();
  console.error(`${self} is a library used by ${callers.join(", ") || "no other tool"}; did you mean \`nosy psst\` or \`node skill/tools/collect-signals.mjs\`?`);
  process.exit(1);
}
