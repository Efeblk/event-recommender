# Agent instructions

Read [the project plan](docs/project-plan.md) first.
The project plan has priority over all other documents.
Use [the architecture](docs/architecture.md) for the current system.
The "Course scope" section below overrides the project plan where they
disagree (solo work, deployment target, public access, collection schedule,
Sprint 4).

## Course scope

- The goal is full marks in the course, not a production product.
- This is a solo project. There is no team. Ignore team roles, role owners
  and teammate reviews in the project plan and other documents.
- Do only the work the "Group Project Guidelines" ask for. Skip
  production hardening, scale work and polish that the course does not grade.
- Deploy the web app to Vercel so that the instructors can try it.
  This replaces the GCP staging deployment for the course demo.
- Run event collection manually only. Do not add scheduled scraping
  (GitHub Actions `schedule`, Cloud Scheduler or Vercel Cron).
- Keep the Vercel demo cheap: free tiers, small budgets, rate limits on
  `/api/agent`.

## Product scope

- Event Recommender is a Google ADK agent that plans Istanbul outings.
- The course is JOB191 - Dream Data Labs Solutions AI Augmented Software
  Engineering (1). Its "Group Project Guidelines" set the scope: an ADK
  agent with at least two tools, a UI, stored data, guardrails and a
  deployment that the instructors can use (Vercel).
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

- One task, one branch, one PR from `master`. Do not review PRs: no
  approvals, no review agents, no delegate reviews.
  Squash-merge when CI is green. CI runs on pull requests only, to save
  Actions minutes.
- Answer questions about the project from the documents and the code.
  Give file paths. If a document and the code disagree, say so.
- Delete the branch after merge. Do not create extra worktrees.
- Complete each sprint when its acceptance checks pass.
- Put unrelated issues in the project plan's Later list.
- Update the project plan's status log with the date, PR or run ID, and result.
- Do not create new report documents. Link to preserved evidence.
- Stop after 2 hours without a merged PR. Record the blocker in the status log.
- Show changes to `AGENTS.md` to the user before merge.
- Use short sentences and active voice. Follow ASD-STE100 Simplified Technical English.
- Keep technical names, commands, paths and quoted source text exact.
- Use `gpt-6.2-astra` or `gemini-4-neon` for substantial planning, difficult
  reasoning and visual checks.
- Use `gpt-6.2-sol` for implementation and tests.
- Use `claude-haiku-5-5` for fast, lightweight subtasks (small lookups,
  summaries and simple doc checks).
- Handle trivial edits directly. Reuse existing findings.
- Run independent read-only subagents in parallel. Keep write tasks serial on
  the current branch.

## Verification

- Use Node from `web/.nvmrc`. Both packages require Node >=22.13.
- For web changes, run `npm test`, `npm run typecheck` and `npm run lint` in `web/`.
- For collector changes, run `npm test` in `collector/`.
- For agent changes, run the agent evaluation with recorded responses.
- Build Node before browser checks. Use `npm run build:node` in `web/`.
- Use `EVENT_REC_BROWSER_START=1 npm run test:browser` when a browser check applies.
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
- The Vercel demo URL is for the user and the course instructors.
  Do not promote it publicly.
- Store secrets in Vercel environment variables or ignored local settings.
  Never print or commit secrets.
- `infra/gcp/` and `.github/workflows/gcp-staging.yml` are optional.
  Do not spend course time on GCP unless the user asks.
