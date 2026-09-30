// html-safe: the one way the generated pages (build-page, scoreboard, auto-section, glance) put data into HTML.
// Everything that comes from pm/ (matrix cells, rival names, evidence, state/*.json) is text, never markup, so it is
// escaped on the way in: & < > " ' all become entities, which makes it safe in a text node and in a quoted attribute.
// A link is only ever http or https (safeUrl); a `javascript:` or `data:` address becomes "". No dependencies.
export const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
// The address itself when it is http(s), else "" (use before putting it in an href).
export const safeUrl = u => { const s = String(u ?? "").trim(); return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : ""; };
