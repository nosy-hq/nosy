// sources-file: the one way to read pm/sources.json. Two things every reader needs and none should redo:
//  1. A UTF-8 byte-order mark (PowerShell 5's `Out-File`/`Set-Content -Encoding UTF8` and old Notepad write one) is not
//     part of the JSON: strip it, or JSON.parse throws and the file is reported "missing" or "not valid".
//  2. A relative `repo` (setup writes "." on purpose, so the file is the same on every teammate's machine) means "the
//     product this pm/ belongs to", not "whatever folder the process was started in": resolve it, or a run from another
//     folder (an MCP client, a CI step, `--pm ../elsewhere/pm`) points git at the wrong place and crashes.
// No dependencies; reads only.
import fs from "node:fs"; import path from "node:path";

export const stripBom = text => String(text ?? "").replace(/^﻿/, "");
// JSON.parse that tolerates a leading BOM. Throws like JSON.parse otherwise.
export const parseJson = text => JSON.parse(stripBom(text));

const isAbs = p => path.isAbsolute(p) || path.win32.isAbsolute(p);
// The nearest folder at or above `dir` that holds a .git (folder or file), or null.
const gitRoot = dir => { for (let d = dir; ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, ".git"))) return d; if (path.dirname(d) === d) return null; } };

// Where a relative `repo` points. "." is the repo the pm/ lives in: the git root at or above the folder that holds pm/
// (so the same file works from any folder, and from a pm/ nested in docs/); without a git root, the folder Nosy runs from
// when it holds pm/, else the folder that holds pm/. Any other relative path is taken from the folder that holds pm/.
export function resolveRepo(pm, repo, { cwd = process.cwd() } = {}) {
  if (typeof repo !== "string" || repo === "" || isAbs(repo)) return repo;
  const pmAbs = path.resolve(cwd, pm), home = path.dirname(pmAbs), from = path.resolve(cwd, repo);
  if (path.normalize(repo) === ".") return gitRoot(home) || ((pmAbs === from || pmAbs.startsWith(from + path.sep)) && fs.existsSync(from) ? from : home);
  const base = path.resolve(home, repo);
  return fs.existsSync(base) ? base : from;
}

// <pm>/sources.json as an object, `repo` made absolute (pass { raw: true } to get the file as written, e.g. to edit and
// write it back). Throws when the file is missing or isn't JSON, exactly like JSON.parse(fs.readFileSync(...)).
export function readSources(pm, { raw = false, cwd } = {}) {
  const K = parseJson(fs.readFileSync(path.join(pm, "sources.json"), "utf8"));
  if (!raw && K && typeof K === "object" && !Array.isArray(K) && typeof K.repo === "string") {
    Object.defineProperty(K, "repoAsWritten", { value: K.repo, enumerable: false }); // messages quote what the file says
    K.repo = resolveRepo(pm, K.repo, { cwd });
  }
  return K;
}
// Same, but null when the file is missing or isn't JSON (for readers that treat that as "no sources yet").
export function readSourcesSafe(pm, opts) { try { return readSources(pm, opts); } catch { return null; } }
