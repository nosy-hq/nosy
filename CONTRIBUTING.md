# Contributing

Small, focused changes are welcome. Open an issue first for anything larger than a fix.

## Run the tests

```sh
npm test
```

That runs `node --test skill/test/*.test.mjs`. The tests are hermetic: a fake product and a fake `gh`, no network, no writes outside a temp folder. It takes a few minutes (about 680 tests). Node 18.17 or newer and git are all you need. See `skill/test/README.md` for how the fake product works.

## Rules for code

- **Plain Node, no dependencies.** No `package.json` dependencies, no build step. Use Node's own modules and the global `fetch`. If a change needs a package, it needs a different design.
- **Scripts count, the agent judges.** Deterministic work (counting, matching, reading git) belongs in a script under `skill/tools/`. Interpretation belongs in the command prompts under `skill/commands/`.
- **Add a test** for a behavior change or a bug fix, next to the others in `skill/test/`.
- **Hooks never block.** A hook that throws or times out must stay silent, not stop the session.
- Keep files English. Product text in other languages is only read, never written as Nosy's own output.

## Nosy doesn't review code

Nosy makes product decisions: what to build next, what shipped, what rivals did. It does not comment on bugs, style or code quality, and a change that adds that will be declined. Code review has good tools already.

## Product decisions vs code

A bug fix or a test needs no discussion. A change to what a command says, recommends or ranks is a product decision: open an issue, say what you saw and what you'd change, and wait for a yes before writing it. We'd rather turn down an idea early than after your weekend.

## Licence

Contributions are under the MIT licence in `LICENSE`.

## Security

Not here: see `SECURITY.md`.
