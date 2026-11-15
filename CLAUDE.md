# CLAUDE.md

## Pull requests and CI

When a pull request is opened (by you or in this session), subscribe to its activity with `subscribe_pr_activity` right away, then listen for CI results. The details (which checks to run before pushing, how to read a bench budget failure, merge conflicts) are in `.claude/skills/babysit/SKILL.md`: read it before acting on a PR event.

- If CI passes and no review is waiting on a change, report that once. Stay subscribed until the PR is merged or closed, so a review still reaches you.
- If CI fails, read the failing job logs, find the cause, fix it on the PR branch, and push. Do not skip, disable, or weaken tests to get green.
- Handle review comments that come in the same way: address what is actionable and reply where needed.
- If Actions cannot start the jobs (no runner, no log, other PRs failing the same way), run `npm run ci:local -- --ref <branch>` and report its results on the PR; see the skill.
- Unsubscribe with `unsubscribe_pr_activity` once the PR is merged or closed, or when the user says to stop.

Do not create a pull request unless the user asks for one.
