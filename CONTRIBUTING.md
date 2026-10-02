# Contributing

Small, focused changes are welcome. Open an issue first for anything larger than a fix.

## Run the tests

```sh
npm test
```

That runs `node --test skill/test/*.test.mjs`: about 1,000 tests, roughly a minute on a laptop. They are hermetic: a fake product and a fake `gh`, no network, no writes outside a temp folder. You need Node 18.17 or newer and git. [`skill/test/README.md`](skill/test/README.md) explains the fake product.

## Rules for code

- **Plain Node, no dependencies.** No `package.json` dependencies, no build step. Use Node's own modules and the global `fetch`. If a change needs a package, it needs a different design.
- **Scripts count, the agent judges.** Deterministic work (counting, matching, reading git) goes in a script under `skill/tools/`. Interpretation goes in the command prompts under `skill/commands/`.
- **Add a test** for a behavior change or a bug fix, next to the others in `skill/test/`.
- **Hooks never block.** A hook that throws or times out must stay silent, not stop the session.
- **Keep files English.** Product text in other languages is only read, never written as Nosy's own output.

## What gets declined

Nosy makes product decisions: what to build next, what shipped, what rivals did. It does not comment on bugs, style or code quality, and a change that adds that will be declined. Code review has good tools already.

A bug fix or a test needs no discussion. A change to what a command says, recommends or ranks is a product decision: open an issue, say what you saw and what you'd change, and wait for a yes before writing it.

## Licence and security

Contributions are under the MIT licence in [`LICENSE`](LICENSE). For vulnerabilities, see [`SECURITY.md`](SECURITY.md): use a private advisory, not an issue.
