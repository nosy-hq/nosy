// The calendar day the owner is living in (BlogFactory field test, 3-4 Oct 2026). Tools stamped reports with `new Date().toISOString().slice(0, 10)`,
// which is the UTC day: in Europe/Istanbul at 02:00 on 4 October that said 3 October, and `rival-signals note --date 2026-10-04` was refused as
// "in the future". A calendar day shown to the owner (a report's date, a bet's placed-on date, "today" in a check) is the local one; a timestamp
// that is stored or compared stays UTC. The zone is NOSY_TZ, else sources.json `timezone` (nosy.mjs sets NOSY_TZ from it for the scripts it runs),
// else the machine's own zone.
const zone = () => {
  const z = process.env.NOSY_TZ;
  if (z) { try { new Intl.DateTimeFormat("en-CA", { timeZone: z }); return z; } catch { /* a bad name falls through to the machine's zone */ } }
  return undefined;
};
const fmt = () => new Intl.DateTimeFormat("en-CA", { timeZone: zone(), year: "numeric", month: "2-digit", day: "2-digit" });

// YYYY-MM-DD in the owner's zone for a Date, a timestamp in ms, or an ISO string; null for anything that isn't a date.
export function localDayOf(when) {
  const d = when instanceof Date ? when : new Date(when);
  return Number.isNaN(d.getTime()) ? null : fmt().format(d);
}
export const localDay = () => localDayOf(new Date());
export const timezoneName = () => zone() || Intl.DateTimeFormat().resolvedOptions().timeZone;
