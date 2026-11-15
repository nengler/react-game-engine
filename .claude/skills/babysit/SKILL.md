---
name: babysit
description: How to watch a pull request in this repository until it is mergeable - CI failures, review comments, merge conflicts, and which checks to run before pushing. Use when a PR is opened in a session, or when a PR event (CI result, review, comment) arrives.
---

# Watching a pull request in react-game-engine

A PR you opened, or were asked to get mergeable, is yours until CI is green on its current head, it has no merge
conflict, and no review is waiting on a change. Subscribe with `subscribe_pr_activity` when it is opened; CI results
and reviews then wake you, so do not poll. Unsubscribe with `unsubscribe_pr_activity` when it is merged or closed, or
when the user says stop.

- **CI green and no open review:** report it once and wait. Do not unsubscribe: a review or the merge still wakes you.
- **CI red:** read the failing job's log (`get_job_logs`), find the cause, fix it on the PR branch, and push. See
  "When CI fails" below.
- **Review comments:** do the small, clear asks, reply on the thread, and resolve what you addressed. Bring larger asks
  (a redesign, an API change) to the user as a proposal before writing them.
- **Merge conflict:** merge `main` into the branch. Do not rebase, amend or force-push a branch someone else has
  pushed to.

Never skip, disable or loosen a test to get green; never push an empty commit or close and reopen to rerun CI. A job
gets one rerun at most, and only once you can say why it failed.

## Before you push

Run what the change touches, and for a CI fix show the failing check passing locally. A fresh container needs
`npm ci` first; the native builds take about a minute.

| Changed | Run |
| --- | --- |
| Anything | `npm run generate`, `npm test`, `npm run typecheck` |
| The guide (`docs/*.html`) | `npm run docs:index` (rebuilds the search index in every page; a test fails if it is stale) |
| A game (`packages/kite`, `packages/hearth`, `packages/demo`) or the engine it uses | `npm run check:<game>` |
| `games/bramble`, packaging, `packages/cli`, or a package's exports | `npm run native:build:headless`, then `npm run check:outside` |
| The player, runtime, compiler output, or anything on the frame path | `npm run bench:check` |
| The Rust host or the parity between hosts | `npm run host:build:headless`, then `RGE_HOST_BIN=host/target/release/rge-host RGE_REQUIRE_HOST=1 node --test packages/demo/test/parity.test.ts` |

`check:<game>` compares against the Rust host only when `host/target/release/rge-host` exists; say so when it was not
built. Bramble is not a workspace: after an engine change, `npm run bramble:install` repacks the engine into it.

## What the CI jobs run

`.github/workflows/ci.yml`: **check** (`npm test`, typecheck, the bench under Node against budgets), **host** (the Rust host built headless, parity with
Node, packaging the demo), **native** and **native-desktop**
(`librge`, the C smoke test, the Node host against the real library, packaged builds under a virtual display), and
**outside** (`check:outside`: Bramble packed, installed and checked from a temporary folder).

`npm run ci:local` (`tools/ci-local.sh`) runs the same jobs here, step for step; `npm run ci:local -- check host` runs only
those. It skips native-desktop, and says so, when `xvfb-run` is missing. When `ci.yml` changes, change the script with it.

## When Actions doesn't run

Every job failing within seconds, with no steps, no logs (`get_job_logs` returns 404) and `runner_id: 0`, means GitHub never
started them: usually the account is out of Actions minutes or has a billing hold. It is not the PR, and a rerun won't help.
Run `npm run ci:local` on the PR head instead, then say once on the PR that Actions didn't run and which jobs passed locally
(and any it skipped). Passing locally is not passing CI: merge on it only when the user says to.

## When CI fails

- **A bench budget** (`bench:check`, budgets in `packages/player/bench/budget.json`). Small scenes take hundredths of
  a millisecond of real work, and shared runners measure them at two to three times local numbers. Before you blame
  noise or raise a budget, compare the scene locally between the base commit and the PR head
  (`git checkout <base> -- <files>`, run `node packages/player/bench/frame.ts`, then restore), and look at what the
  previous green run measured for it. If the PR made it slower on purpose, raise that scene's budget and say why in the
  commit. If it is noise, fix the measurement, not the budget.
- **A test that pinned old behaviour** the PR changes on purpose: update the test and say in the commit what changed
  and why. A test that fails for any other reason is a bug to fix.
- **Parity** between Node and the Rust host must stay byte-identical; a difference is a bug, not a baseline to update.

## Commits

Engine changes (`packages/runtime`, `compiler`, `player`, `player-node`, `cli`, `native`, and `native/`, `host/`) and
game changes (`packages/kite`, `packages/hearth`, `packages/demo`, `games/bramble`) go in separate commits. The design notes (`docs/DESIGN.md`, `docs/NATIVE_PLAN.md`, a game's
`DESIGN.md`) and the guide (`docs/*.html`) change in the same PR as the behaviour they describe.
