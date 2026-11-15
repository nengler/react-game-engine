# CLAUDE.md

## Pull requests and CI

When a pull request is opened (by you or in this session), subscribe to its activity with `subscribe_pr_activity` right away, then listen for CI results. The details (which checks to run before pushing, how to read a bench budget failure, merge conflicts) are in `.claude/skills/babysit/SKILL.md`: read it before acting on a PR event.

- Stay subscribed until the PR is merged or closed, so a review still reaches you.
- If CI fails, read the failing job logs, find the cause, fix it on the PR branch, and push. Do not skip, disable, or weaken tests to get green.
- Handle review comments that come in the same way: address what is actionable and reply where needed.
- Unsubscribe with `unsubscribe_pr_activity` once the PR is merged or closed, or when the user says to stop.
- Every PR runs all five CI jobs (check, native, host, outside, native-desktop) on its current head. If GitHub Actions can't run
  them (out of minutes, a billing hold: every job fails in seconds with no runner and no logs), run them locally with
  `npm run ci:local` on the PR's head, no job names, so all five run. It runs the same steps as `.github/workflows/ci.yml`. Say
  once on the PR that Actions didn't run and which jobs passed locally.
- When all five jobs pass on the PR's head (on Actions, or all five in `ci:local`), there is no merge conflict and no review is
  waiting on a change, merge the PR. A job that was skipped or not run has not passed: don't merge then.
- In a cloud container, native-desktop usually can't pass locally: its OpenGL can't render to a framebuffer, so pixel tests
  read back black. The babysit skill ("native-desktop in a cloud container") says how to show that it isn't the PR's. Then
  report it to the user and let them decide on the merge.

Do not create a pull request unless the user asks for one.
