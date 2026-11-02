## What and why

<!-- One task per PR. Link the sprint item or issue: "Sprint 2, item 3" or "Closes #12". -->

## How I checked it

<!-- Paste the commands you ran and the result. -->

- [ ] `npm test`, `npm run typecheck` and `npm run lint` in `web/` (web changes)
- [ ] `npm test` in `collector/` (collector changes)
- [ ] `npm run eval:agent` in `web/` (agent changes)
- [ ] `BIPLAN_BROWSER_START=1 npm run test:browser` after `npm run build:node` (UI changes)
- [ ] Links and diff checked (documentation changes)

## Rules

- [ ] No secrets, keys or tokens in the code, logs or screenshots.
- [ ] Event cards come only from tool results.
- [ ] No new paid calls or paid resources without an approved budget.
- [ ] The status log in `docs/project-plan.md` is updated if this PR finishes a sprint item.
