#!/usr/bin/env node
// Nosy · builds the Skill zip for claude.ai (web/desktop chat).
//
// claude.ai expects a zip whose ROOT is the skill folder itself (not just its
// contents) — so the contents of skill/ are copied into a folder named
// "nosy/" and zipped from there. skill/ is used READ-ONLY: no file in it is
// modified or moved.
//
// claude.ai has no git, and its Node runtime isn't like Claude Code's: so the
// tools/*.mjs scripts do NOT run there (they're only included in the zip for
// reference/reading). Which Nosy commands make sense on claude.ai is written
// in docs/SETUP.md (short version: neighbors, spill with pasted evidence,
// and scoop partially work; peek/psst/overheard need a repo and git, so they
// don't work).
//
// Usage: node packaging/claude-ai-zip.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(REPO, "skill");
const DIST = path.join(REPO, "dist");
const STAGE = path.join(DIST, ".stage");
const ROOT_NAME = "nosy"; // must match `name:` in SKILL.md's frontmatter
const STAGE_ROOT = path.join(STAGE, ROOT_NAME);
const ZIP_PATH = path.join(DIST, "nosy-skill.zip");

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`skill/ not found: ${SRC}`);
    process.exit(1);
  }

  fs.rmSync(STAGE, { recursive: true, force: true });
  copyDir(SRC, STAGE_ROOT);
  fs.mkdirSync(DIST, { recursive: true });
  fs.rmSync(ZIP_PATH, { force: true });

  try {
    execFileSync("zip", ["-r", "-X", ZIP_PATH, ROOT_NAME], { cwd: STAGE, stdio: "inherit" });
  } catch (e) {
    console.error("`zip` command not found or failed (needs the system zip on macOS/Linux).");
    fs.rmSync(STAGE, { recursive: true, force: true });
    process.exit(1);
  }

  fs.rmSync(STAGE, { recursive: true, force: true });

  console.log(`\nWritten: ${ZIP_PATH}\n`);
  try {
    const list = execFileSync("unzip", ["-l", ZIP_PATH], { encoding: "utf8" });
    console.log(list);
  } catch {
    console.log("(For the content listing: unzip -l " + ZIP_PATH + ")");
  }
}

main();
