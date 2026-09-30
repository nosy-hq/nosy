// Shared detectors for personal data: e-mail, phone numbers (Turkish, international +/00, US, UK), IBANs of any country
// (country length table + mod-97), payment card numbers (Luhn) and the Turkish national ID (checksum). One place, so the
// masker (mask.mjs, which rewrites customer quotes) and the privacy scan (privacy-scan.mjs, which stops a send) find the
// same things. A library: no side effects, no I/O.
//
// What this does NOT find: names, postal addresses, other kinds of national ID, phone numbers written without a
// separator or a country prefix in a country other than Turkey, the US or the UK.

export const luhnValid = s => {
  const d = String(s).replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(d)) return false;
  let sum = 0, dbl = false;
  for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (dbl) { n *= 2; if (n > 9) n -= 9; } sum += n; dbl = !dbl; }
  return sum % 10 === 0;
};

export const tcknValid = s => {
  if (!/^[1-9]\d{10}$/.test(s)) return false;
  const d = [...s].map(Number), single = d[0] + d[2] + d[4] + d[6] + d[8], pair = d[1] + d[3] + d[5] + d[7];
  if ((((single * 7 - pair) % 10) + 10) % 10 !== d[9]) return false;
  return (single + pair + d[9]) % 10 === d[10];
};

// IBAN length per country (ISO 13616 registry). An IBAN is valid when its country is listed, its length matches and
// the mod-97 check passes.
const IbanLength = Object.fromEntries(("AD24 AE23 AL28 AT20 AZ28 BA20 BE16 BG22 BH22 BR29 BY28 CH21 CR22 CY28 CZ24 DE22 DK18 DO28 EE20 EG29 ES24 FI18 FO18 FR27 GB22 GE22 GI23 GL18 GR27 GT28 HR21 HU28 IE22 IL23 IQ23 IS26 IT27 JO30 KW30 KZ20 LB28 LC32 LI21 LT20 LU20 LV21 LY25 MC27 MD24 ME22 MK19 MR27 MT31 MU30 NL18 NO15 PK24 PL28 PS29 PT25 QA29 RO24 RS22 SA24 SC31 SE24 SI19 SK24 SM27 ST25 SV28 TL23 TN24 TR26 UA29 VA22 VG24 XK20")
  .split(" ").map(x => [x.slice(0, 2), +x.slice(2)]));

export const ibanValid = s => {
  const t = String(s).replace(/\s/g, "").toUpperCase(), L = IbanLength[t.slice(0, 2)];
  if (!L || t.length !== L || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(t)) return false;
  let rest = 0n;
  for (const ch of (t.slice(4) + t.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55))) rest = (rest * 10n + BigInt(ch)) % 97n;
  return rest === 1n;
};

// Where IBANs sit in a text: [{index, length, value}]. Groups may be separated by single spaces; the span stops at
// exactly the country's IBAN length, so words after it are not swallowed.
export function ibanSpans(text) {
  const out = [], re = /\b[A-Za-z]{2}\d{2}(?: ?[A-Za-z0-9]){11,30}/g;
  let m;
  while ((m = re.exec(text))) {
    const L = IbanLength[m[0].slice(0, 2).toUpperCase()];
    let n = 0, end = -1;
    if (L) for (let i = 0; i < m[0].length; i++) { if (m[0][i] !== " ") n++; if (n === L) { end = i + 1; break; } }
    const next = end > 0 ? text[m.index + end] : "x";
    if (end > 0 && !/[A-Za-z0-9]/.test(next || "") && ibanValid(m[0].slice(0, end))) { out.push({ index: m.index, length: end, value: m[0].slice(0, end) }); re.lastIndex = m.index + end; }
    else re.lastIndex = m.index + 2;
  }
  return out;
}

// Card-like numbers (13-19 digits, spaces or dashes between) that pass Luhn.
export function cardSpans(text) {
  const out = [], re = /(?<![\d/])\d(?:[ -]?\d){12,18}(?!\d)/g;
  let m;
  while ((m = re.exec(text))) if (luhnValid(m[0])) out.push({ index: m.index, length: m[0].length, value: m[0] });
  return out;
}

const digits = s => s.replace(/\D/g, "").length;
// Phone forms. Turkish mobile and landline; anything starting +<country code> or 00<country code> (E.164 written with
// spaces, dots, dashes or brackets); US/Canada (needs separators or brackets, so a plain 10-digit number is not a
// phone); UK national numbers starting 0 (mobile 07…, or area code + number, with separators).
const Phone = [
  { kind: "tr-mobile", re: /\b(?:\+?90[\s.-]?)?0?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g },
  { kind: "tr-landline", re: /\b0\d{2,3}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g },
  { kind: "intl", re: /(?<![\w+])(?:\+|00[ .-]?)[1-9][\d \t().-]{6,22}/g, fit: s => { // trim to the last digit, at most 15 digits (E.164)
    let out = "", n = 0; for (const ch of s) { if (/\d/.test(ch)) { if (n === 15) break; n++; } out += ch; }
    out = out.replace(/[^\d]+$/, ""); const total = digits(out) - (out.startsWith("00") ? 2 : 0); return total >= 8 && total <= 15 ? out : null; } },
  { kind: "us", re: /(?<![\w.+-])(?:\+?1[\s.-]?)?(?:\([2-9]\d{2}\)[\s.-]?|[2-9]\d{2}[\s.-])\d{3}[\s.-]\d{4}(?![\w-])/g },
  { kind: "uk", re: /(?<![\w.+-])0(?:7\d{3}|\d{2,4})[ -]\d{3,4}[ -]?\d{3,4}(?![\w-])/g },
  { kind: "uk-mobile", re: /(?<![\w.+-])07\d{9}(?!\w)/g },
];
export function phoneSpans(text) {
  const spans = [];
  for (const { kind, re, fit } of Phone) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(text))) {
      if (m[0] === "") { re.lastIndex++; continue; }
      const v = fit ? fit(m[0]) : m[0];
      if (v) { spans.push({ index: m.index, length: v.length, value: v, kind }); if (fit) re.lastIndex = m.index + Math.max(1, v.length); }
    }
  }
  spans.sort((a, b) => a.index - b.index || b.length - a.length);
  const merged = [];
  for (const s of spans) { const last = merged[merged.length - 1]; if (last && s.index < last.index + last.length) continue; merged.push(s); }
  return merged;
}

// Replaces spans (as returned above, non-overlapping) with one label.
export function replaceSpans(text, spans, label) {
  let out = text;
  for (const s of [...spans].sort((a, b) => b.index - a.index)) out = out.slice(0, s.index) + label + out.slice(s.index + s.length);
  return out;
}

export const EmailRe = /[\w.+-]+@[\w.-]+\.\w+/g;
