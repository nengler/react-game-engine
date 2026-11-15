# CLAUDE.md

## Pull requests and CI

When a pull request is opened (by you or in this session), subscribe to its activity with `subscribe_pr_activity` right away, then listen for CI results. The details (which checks to run before pushing, how to read a bench budget failure, merge conflicts) are in `.claude/skills/babysit/SKILL.md`: read it before acting on a PR event.

- If CI passes and no review is waiting on a change, report that once. Stay subscribed until the PR is merged or closed, so a review still reaches you.
- If CI fails, read the failing job logs, find the cause, fix it on the PR branch, and push. Do not skip, disable, or weaken tests to get green.
- Handle review comments that come in the same way: address what is actionable and reply where needed.
- Unsubscribe with `unsubscribe_pr_activity` once the PR is merged or closed, or when the user says to stop.
- If GitHub Actions can't run the jobs (out of minutes, a billing hold: every job fails in seconds with no runner and no logs),
  run CI locally with `npm run ci:local` on the PR's head. It runs the same steps as `.github/workflows/ci.yml`. Say once on the
  PR that Actions didn't run and paste which jobs passed locally. Local green is not CI green: don't merge on it unless the user
  says to.

Do not create a pull request unless the user asks for one.
