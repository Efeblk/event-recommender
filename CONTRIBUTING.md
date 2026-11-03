# Contributing

This guide tells teammates how to change the code. Read the
[onboarding guide](docs/onboarding.md) first. The
[project plan](docs/project-plan.md) has priority over this guide.

## Workflow

1. Pick a task from the current sprint in the project plan, or open an issue
   with the **Task** form. Tell the team in the group chat that you own it.
2. Update `master` and create a branch:

   ```sh
   git switch master
   git pull
   git switch -c <your-name>/<short-task-name>
   ```

3. Make small commits. Write commit messages in the imperative
   ("Add weather card", not "Added weather card").
4. Run the checks for the parts that you changed (see below).
5. Push the branch and open a PR to `master`. Fill in the PR template.
6. Ask one teammate to review. Answer each comment. Resolve all conversations.
7. When CI is green and a teammate approves, click **Squash and merge**.
   GitHub deletes the branch.

## Rules for `master`

GitHub enforces these rules on `master`:

- Changes enter only through a pull request. Direct pushes are blocked.
- Force pushes and branch deletion are blocked.
- One approval is necessary. A new push removes old approvals.
- All review conversations must be resolved.
- These CI checks must pass: `collector (ubuntu-latest)`,
  `verify (ubuntu-latest)`, `container`, `terraform`, `docs` and
  `dependency-review`. The branch must be up to date with `master`.
- Only squash merges are permitted. The history stays linear.

The repository admin can merge a PR without an approval when no teammate is
available. The admin cannot push directly to `master` either.

If your branch is behind `master`, click **Update branch** on the PR or run
`git pull --rebase origin master` and push again. Do not force push to a
branch that another person also uses.

## Checks to run before you push

Use Node from `web/.nvmrc`.

| You changed | Run |
|---|---|
| `web/` | `npm test`, `npm run typecheck` and `npm run lint` in `web/` |
| `web/agent/` | Also `npm run eval:agent` in `web/` |
| UI | `npm run build:node`, then `EVENT_REC_BROWSER_START=1 npm run test:browser` in `web/` |
| `collector/` | `npm test` in `collector/` |
| `infra/gcp/` | `terraform fmt -check -recursive`, `terraform validate` and `terraform test` in `infra/gcp/` |
| Documentation | `node .github/scripts/check-doc-links.mjs` and read your diff |

In PowerShell, set `$env:EVENT_REC_BROWSER_START = '1'` before the browser tests.

## What CI does

`.github/workflows/web.yml` runs on each PR and on each push to `master`:

- `collector`: collector tests.
- `verify`: web unit tests, agent evaluation replay, release and input checks,
  Jev replay, typecheck, lint, Node build and smoke test, Playwright browser tests.
- `container`: builds the Linux Docker image and smokes it without credentials.
- `terraform`: format, validate and mocked plans for `infra/gcp/`.
- `docs`: checks relative links in Markdown files.
- `dependency-review` (PRs only): blocks new dependencies with known
  high-severity vulnerabilities.

No CI job calls a paid API or needs a secret. A manual run (**Run workflow**)
also tests Windows.

Dependabot opens weekly PRs for npm packages and GitHub Actions. Review and
merge them like any other PR.

`.github/workflows/gcp-staging.yml` is a manual deploy to private staging. Only
the project owner runs it.

## Review checklist

When you review a PR, check that:

- The PR does one task and the description says how it was tested.
- Event cards come only from tool results.
- Dates, places, budgets, categories, negations and age limits stay correct.
- New behavior has a test.
- There are no secrets, personal data or new paid calls.
- Unrelated issues go to the Later list in the project plan, not into this PR.

## Writing style

Write documents in short sentences and active voice. Follow ASD-STE100
Simplified Technical English. Keep technical names, commands and paths exact.
Do not create new report documents. Link to evidence (PRs, CI runs) instead.

## Secrets and costs

- Never commit or print API keys or tokens. Local keys go in ignored
  `web/.env` or `web/.dev.vars`. Deployed keys go in Secret Manager.
- Gemini above the free tier, TypeSafe/Jev, Voyage and Google Maps cost money.
  Ask the project owner for a budget before you use them.
- If you commit a secret by mistake, tell the project owner at once. The key
  must be revoked. Removing the commit is not enough.
