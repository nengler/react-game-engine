# CLAUDE.md

## Pull requests and CI

When a pull request is opened (by you or in this session), subscribe to its activity with `subscribe_pr_activity` right away, then listen for CI results.

- If CI passes, report that and stop.
- If CI fails, read the failing job logs, find the cause, fix it on the PR branch, and push. Do not skip, disable, or weaken tests to get green.
- Handle review comments that come in the same way: address what is actionable and reply where needed.
- Unsubscribe with `unsubscribe_pr_activity` once the PR is merged or closed, or when the user says to stop.

Do not create a pull request unless the user asks for one.
