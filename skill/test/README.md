# skill/test/ — hermetic regression setup

Nosy had no tests at all. This folder tests the scripts in
`skill/tools/*.mjs` **without touching any real product or GitHub**: it uses a fake product
("Cargo") and a fake `gh`.

## How to run

```sh
node --test skill/test/*.test.mjs
```

Note: running bare `node --test skill/test/` from the repo root (the directory as a single
argument, no glob) does NOT WORK in this repo — Node tries to resolve it as a single module via
CommonJS `require()` and blows up with `MODULE_NOT_FOUND` since there's no `package.json`/`index.js`
(a package-less-project constraint, see `rules.md`). Two working equivalents: the glob above, or
argument-less `cd skill/test && node --test` (both correctly find the tests). Argument-less
`node --test` also works from the repo ROOT, but because of Node's "every file under test/" rule it
also counts `fake-product.mjs` and `helpers.mjs` as "test files" (empty, zero assertions) and adds
them to the list — harmless (still exit code 0), but the count is two higher than the number of real tests; the glob form
is recommended for that reason.

Needs no network, no write permission, finishes in ~2 seconds. To run a single file:
`node --test skill/test/lowhanging.test.mjs`.

## Fake product: Cargo

`fake-product.mjs` sets up a small logistics SaaS called **Cargo** in every test's `before()`: a
real git repo (main branch + a local bare "origin"), `DECISIONS.md`, `BACKEND-NEEDS.md`, frontend
files with `// dropped:` lines, `pm/sources.json`, `matrix.json` in both shapes (see below), and the
JSON the fake `gh` should return. All dates are generated RELATIVE TO THE MOMENT IT RUNS
(`GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`), so "last 7/14/30 days" windows don't break no matter what
day you run the test.

Which file triggers which signal:

| Source | Content | Triggers |
|---|---|---|
| `frontend/shipments/.../List.jsx` | `// dropped: §21 ... ready` | lowhanging signal 1 (clean opportunity) |
| `frontend/reports/.../Panel.jsx` | `// dropped: §22 ... ready` + §22 also appears in our own PR | signal 1 + sinking with " · in PR" |
| `frontend/billing/.../Summary.jsx` | `// dropped: §23 ... ready but deliberately/intentionally` | **should NOT trigger** (deliberately left out) |
| `BACKEND-NEEDS.md` §1 | `exists`, UI "wired" | **should NOT trigger** (screen already built) |
| `BACKEND-NEEDS.md` §3 | `exists`, "no screen for this yet" | signal 2 ("Served, no screen") |
| `BACKEND-NEEDS.md` §5 | `missing`, dated but no related commit | **should NOT trigger** |
| `BACKEND-NEEDS.md` §7 | `partial`, dated + a `§7 barcode...` commit | signal 3 ("Status may be stale") |
| `BACKEND-NEEDS.md` §9 | `missing`, undated | **should NOT trigger** |
| `pm/matrix.json` (OLD/Acme Books shape) line 1 | `codes.Cargo === "b"` | signal 4 ("Matrix: backend ready") |
| `pm/matrix.json` line 3 | `decision: "notDoing"` | **should NOT trigger** (deliberate, doesn't count) |
| `pm/matrix.json` line 4 | code `s`, `y` in 3 rivals | signal 4 ("Common among rivals, partial for us") |
| fake `gh issue list` #701 | title `[cargo] ...` | signal 5 ("Issue opened against us") |
| fake `gh issue list` #702 | title doesn't match `K.issue.our` | **should NOT trigger** |
| commit "K12 m.4 ... backend" | on main, within 14 days | find-stale: catches a page line called "in flight" |
| no commit: "K12 m.9" | — | find-stale: still genuinely in flight, no finding |
| fake `gh pr view 501` -> `MERGED` | the page says "#501 open PR" | find-stale: a merged-but-called-open PR |
| page line "#502 (on main)" | already a closed context | find-stale: should **NOT** produce a false positive |
| fake `gh pr list` containing `console.log(card)` | the never pattern | preread: a rule-violation line |
| commit `chore(deps): ...` x 2 | — | collect-status: `dependency: 2`, doesn't open a separate ref group |
| PR #615's commit, title cut off with "…" | its body starts with "…" | collect-status: rejoining a truncated title |

`pm/rivals/sevkpro.md` + `pm/rivals/yolcu360.md` + `pm/us.json` are separate, for the build-matrix.mjs
+ build-page.mjs pipeline, and are deliberately in **Nosy's own (NEW) shape** — different on purpose
from the OLD-shaped `matrix.json` above (see "Two `matrix.json` shapes" below).

## Two `matrix.json` shapes (so it doesn't confuse you)

`verify-setup.mjs` already flags this in its own output: the shape `build-matrix.mjs` PRODUCES
(`{steps, products:[{name, codes:{no:{k,evidence}}}]}`) and the shape `lowhanging.mjs`/
`gather-evidence.mjs`/`verify-setup.mjs` READ for `K.matris` (`{products:[name,...], lines:[{feature,
not, decision, codes:{name:code}}]}`) are **different schemas**. So `fake-product.mjs` sets up two
separate matrices: `pm/matrix.json` is written directly in the OLD shape (the lowhanging/
gather-evidence/verify-setup tests use this); `matrix-page.test.mjs`, on the other hand, actually
RUNS `build-matrix.mjs` to produce the NEW shape and feeds it to `build-page.mjs`. That these two
worlds are NOT connected is also recorded with a `todo` test in `matrix-page.test.mjs` (internal
request 18).

## Fake `gh`

`fakeGhSetup(fixture)` in `helpers.mjs` prepends a temp bin folder to PATH; the executable `gh`
(a Node script) in that folder looks at the arguments and returns fixed JSON from the `fixture`
object. The 7 call shapes the scripts actually make (worked out with `grep`) are covered: `pr view`,
`repo view`, three kinds of `pr list` (no `-R`/`--author @me`/`--limit 50`), two kinds of
`issue list` (`--state open`/`--state all`). On a call it doesn't recognize, it writes to stderr and
exits 1. `preread.mjs` currently does NOT call `gh pr checks` or `gh pr diff` (it only derives CI
status from `pr list`'s `statusCheckRollup` field) — the "gh pr diff" mention in `overheard.md` is a
next step the agent takes by hand, not something the script itself does (internal request 24 isn't
coded yet). So the fake `gh` doesn't have those two endpoints; if the script actually calls them in
the future, update this README and `helpers.mjs`.

## Adding a test for a new script

1. **Read** the script first: what its input is (CLI arguments), which keys it reads from
   `sources.json`, exactly which arguments it calls `gh` with, what its output and exit code are.
2. Open a new `<script-name>.test.mjs`; set up with `fakeProductSetup()` and, if needed,
   `fakeGhSetup(K.gh)`, then run with `run(path.join(Tool, "<script>.mjs"), [...], { env: gh.env })`.
3. Verify the **contract**, not the full text: JSON keys, whether a specific ref/title is
   present/absent, the exit code. If you find a bug in the script, don't fix the script; mark the
   test with `test("...", { todo: "internal request: ..." }, () => {...})` and write it up in the report.

## Files added later (side/test2, a continuation of internal request 25)

- `freshness.test.mjs` — a checkmark/x based on status.json's age, `peek` in "order", the `--strict` exit code;
  the deliberate rule that a rival file's "Sources read" and "Latest major announcement" are judged SEPARATELY.
- `find-sources.test.mjs` — a sources.json suggestion from reading the repo only (ref, preread.decisions,
  request, refs); the `--write`/`--overwrite` writing rules.
- `measure-size.test.mjs` — for a single topic, type:"size" (K/O/B, similar, coverage); the topic's own ref
  is excluded from similar and shows up in "own" instead; type:"size-bulk" with `--bulk`.
- `build-waves.test.mjs` — wave names, work in a PR landing in "When code lands", a matrix decision:"notDoing"
  landing in "outside", inputs.matris:true in both matrix shapes.
- `diff.test.mjs` — save() saying "no change" for identical content, resolved/new psst items,
  `--all`/hidden, `--clear`.
- `privacy-scan.test.mjs` — fake secrets are assembled from parts INSIDE THE TEST; exit code 1 on a
  high-severity finding, 0 on a clean file; `--mask`.
- `learn.test.mjs` — mute/knowingly/important + apply, an expired rule not being applied, apply not
  mutating the input.
- `audit-prd.test.mjs` — the scores of skill/examples/prd/{good,fair,bad}.md, `--strict`, `--pm` blocking a
  K-number that isn't in DECISIONS.
- `collect-signals.test.mjs` — CSV/md signals, goal mapping, masking, `--quote` 0 (note: since the idf
  threshold doesn't clear the default of 16 with the small test data, sources.json's signal threshold is
  lowered in the test's copy).
- `write-notes.test.mjs` — `--audience customer` has no commit hash/author name/chore(deps); `--audience team`
  has refs.
- `read-matrix.test.mjs` — the exported `matrisRead`: both shapes reduce to the same form; an "acquired"
  rival is in `oh`.
- `inventory.test.mjs` — the exported path-guess function: a regression test that apps/backend + apps/web
  doesn't produce a doubled prefix ("apps/apps/...").
