# Agent instructions

Read [the project plan](docs/project-plan.md) first.
The project plan has priority over older instructions and archived documents.
Use [the architecture](docs/architecture.md) for the current system.
The [archived v1 product plan](docs/archive/product-plan-v1.md) keeps the
search history, decisions and status log before 2026-10-30.

## Product scope

- Bi' Plan is a Google ADK agent that plans Istanbul outings.
- The course "Group Project Guidelines" set the scope: an ADK agent with at
  least two tools, a UI, stored data, guardrails and a GCP deployment.
- Build features F1–F4 from the project plan. F5 is a stretch goal.
- Support Turkish and English requests.
- Keep dates, places, budgets, categories, negations and age limits correct.
- Show event cards only from tool results. Gemini text never creates events.
- Do not show duplicate sessions or events without required source evidence.
- `search_events` retrieves from the full eligible catalog before the
  shortlist of up to 16.
- Keep collection work outside agent requests.
- Leave PostgreSQL, new providers and promotions outside the project.

## Work rules

- One task, one branch, one PR from `master`. A teammate reviews each PR.
- Delete the branch after merge. Do not create extra worktrees.
- Complete each sprint when its acceptance checks pass.
- Put unrelated issues in the project plan's Later list.
- Update the project plan's status log with the date, PR or run ID, and result.
- Do not create new report documents. Link to preserved evidence.
- Stop after 2 hours without a merged PR. Record the blocker in the status log.
- Show changes to `AGENTS.md` to the user before merge.
- Use short sentences and active voice. Follow ASD-STE100 Simplified Technical English.
- Keep technical names, commands, paths and quoted source text exact.
- Use `gpt-6-astra` for substantial planning and difficult reasoning.
- Use `gpt-5.6-sol` for implementation, tests and routine reviews.
- Handle trivial edits directly. Reuse existing findings.

## Verification

- Use Node from `web/.nvmrc`. Both packages require Node >=22.13.
- For web changes, run `npm test`, `npm run typecheck` and `npm run lint` in `web/`.
- For collector changes, run `npm test` in `collector/`.
- For agent changes, run the agent evaluation with recorded responses.
- Build Node before browser checks. Use `npm run build:node` in `web/`.
- Use `BIPLAN_BROWSER_START=1 npm run test:browser` when a browser check applies.
- Prefer the T3 Code browser. Report an unavailable host before using Playwright.
- For documentation changes only, check links and the diff. Do not build or call APIs.
- Check CI on the exact latest PR revision. Fix failures before merge.
- Review every returned card and every empty result against source evidence.
- Preserve failed results. Do not treat old evidence as a new live test.

## Cost, deployment and secrets

- Ask once per sprint for a paid budget (Gemini above the free tier,
  TypeSafe/Jev, Voyage, Google Maps). Give a cost estimate.
- Keep paid calls within that budget. Do not retry paid calls automatically.
- Prefer free tiers and free development options. New paid resources need user approval.
- Keep staging private. Public access needs user approval (Sprint 4).
- Keep staging and production resources separate.
- Never print or commit secrets. Use ignored local settings or Secret Manager.
- GCP deployment moves into this repository in Sprint 1. Until then, staging
  runs from `Efeblk/event_recommender`.
- Find old PRs, runs and archived evidence in `Efeblk/event_recommender`.
