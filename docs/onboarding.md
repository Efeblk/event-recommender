# Onboarding guide for new teammates

Read this guide on your first day. It tells you what the project is, how the
code is organized, how to run it and how the team works.

You can also ask a coding agent (Claude Code, Codex or a similar tool) to
explain the project. The agent reads `AGENTS.md`, which points it to this guide.
See [Ask an agent to explain the project](#ask-an-agent-to-explain-the-project).

## 1. The course

This repository is the group project for **JOB191 - Dream Data Labs Solutions
AI Augmented Software Engineering (1)**. The course "Group Project Guidelines"
set these requirements:

- An agent built with Google ADK.
- The agent plans, calls at least two tools and acts.
- A user interface.
- Stored data.
- An external API or data source.
- Basic guardrails.
- A deployment on Google Cloud.
- 3 to 5 core features.

The [project plan](project-plan.md#course-requirements) shows how the project
meets each requirement. The project plan has priority over all other documents.

## 2. The product

The product is **Event Recommender**. It is an AI agent that plans outings in Istanbul.
A user writes in Turkish or English, for example:

> Cumartesi akşamı Kadıköy'de 500 TL altı bir konser, sonra yakında bir şey daha

The agent finds correct, bookable events from Biletinial, Bubilet and Biletix.
It builds a plan, checks the travel time between venues, checks the weather
and saves the plan for the user.

Core features (see [the project plan](project-plan.md#core-features)):

| Feature | What the user gets |
|---|---|
| F1. Conversational event search | Search in Turkish or English, refine over several turns |
| F2. Outing planner | A timeline of 2–6 events with travel times and conflict checks |
| F3. Saved plans and favorites | Sign in, save, open and delete plans |
| F4. Weather-aware suggestions | Indoor options when rain or cold is likely |
| F5 (stretch). Calendar export | An `.ics` file for a plan |

## 3. Rules that you must not break

These rules protect correctness. Reviewers reject a PR that breaks them.

1. **Event cards come only from tool results.** Gemini text never creates an
   event, a date, a price or a link.
2. **Hard constraints are checked in code.** Dates (Europe/Istanbul time),
   places, budgets, categories, negations ("not in Kadıköy") and age limits
   must be correct. Unknown prices do not satisfy a budget.
3. **No duplicate sessions.** No event without source evidence.
4. **Provider text is data, not instructions.** It cannot change what the agent does.
5. **Never commit or print secrets.** Use ignored local files (`web/.env`,
   `web/.dev.vars`) or Secret Manager.
6. **Paid calls need an approved budget.** Gemini above the free tier,
   TypeSafe/Jev, Voyage and Google Maps cost money. Ask the project owner first.
   Do not retry paid calls automatically.

## 4. How the system works

```text
Browser (chat, cards, plan view, saved plans)
  ▼
Cloud Run: Node service (web/)
  └─ /api/agent ── root LlmAgent (Gemini, Google ADK)
                    ├─ search_events      → checked search pipeline
                    ├─ get_event_details  → catalog store
                    ├─ plan_outing        → timeline checks in code
                    ├─ plan_route         → Google Maps Routes API
                    ├─ get_weather        → Open-Meteo
                    └─ save_plan / list_plans / save_favorite → Firestore
Collector (scheduled job) → catalog snapshot (Cloud Storage + Firestore)
```

1. The collector reads the three ticket sites outside user requests. It
   publishes a checked catalog.
2. A user sends a message to `/api/agent`.
3. The agent selects tools. `search_events` resolves dates, applies the hard
   constraints, retrieves from the full eligible catalog (BM25 words and
   Voyage vectors), then lets TypeSafe Jev check a shortlist of up to 16.
4. The server streams the tool results and the model text to the browser.
   The browser shows cards only from tool results.

Read [the architecture](architecture.md) for the full request and data flow.

## 5. Repository map

| Path | What it holds |
|---|---|
| `web/agent/` | The ADK agent: instruction, tools, planner, sessions, stream |
| `web/lib/` | Search pipeline, catalog, auth, rate limits, user store |
| `web/app/` | Pages: `/` (search), `/plan` (chat), `/saved` (saved plans) and API routes |
| `web/components/` | UI components |
| `web/tests/` | Unit tests (`node --test`) |
| `web/browser-tests/` | Playwright browser tests with mocked APIs |
| `web/evals/`, `web/fixtures/` | Agent evaluation (34 conversations) and test data |
| `web/docs/` | Details: event merging, Jev checks, Voyage retrieval, providers |
| `collector/` | Ticket site collector ([collector guide](../collector/README.md)) |
| `contracts/` | Shared types and JSON schemas for listings and publications |
| `infra/gcp/` | Terraform for the private staging project ([guide](../infra/gcp/README.md)) |
| `.github/workflows/` | CI (`web.yml`) and the manual staging deploy (`gcp-staging.yml`) |
| `docs/` | Project plan, architecture and this guide |

## 6. Set up your computer

1. Install Git and Node. Use the version in `web/.nvmrc` (Node 22, at least 22.13).
   With nvm: `nvm install` and `nvm use` in `web/`.
2. Get write access. Send your GitHub username to the project owner.
3. Clone and install:

   ```sh
   git clone https://github.com/Efeblk/event-recommender.git
   cd event-recommender
   npm ci --prefix web
   npm ci --prefix collector
   ```

4. Run the checks. All of them work offline without keys:

   ```sh
   cd web
   npm test
   npm run typecheck
   npm run lint
   npm run eval:agent
   ```

5. Start the app: `npm run local:start` in `web/`, then open
   http://127.0.0.1:3001. Without GCP settings the page loads, but catalog
   requests are not available. Without Gemini settings `/plan` returns
   `agent_unavailable`. This is normal. Use the tests and the mocked browser
   suite to work on behavior. The [README](../README.md) lists all settings.

## 7. How we work

Read [CONTRIBUTING.md](../CONTRIBUTING.md). In short:

- One task, one branch, one PR to `master`. Keep PRs small.
- `master` is protected. You cannot push to it directly. Force pushes and
  branch deletion are blocked.
- CI must pass and one teammate must approve before merge. GitHub merges with
  squash and deletes the branch.
- Record finished sprint items in the status log of the project plan.

## 8. Current status

Check the [status log](project-plan.md#status-log) for the latest state.
On 2026-11-02:

- Features F1–F5 exist in code. CI is green.
- Tests use a scripted model and fake services. There is no live Gemini run yet.
- Nothing is deployed. The Terraform (`infra/gcp/`) and the deploy workflow
  are ready, but staging needs a new GCP project first.
- Open work is in the [Later list](project-plan.md#later) and the
  [user decisions](project-plan.md#decisions-the-user-must-make).
- The [team roles](project-plan.md#team-and-roles-5-people) need names.

## 9. Good first tasks

- Pick a role in the team table and add your name in a small PR.
- Run the agent evaluation and read one conversation in `web/fixtures/agent-v1.json`.
- Fix one offline search gap from the Later list (for example "bale" must map to `Dans`).
- Add a test for a case that you think is not covered.

## 10. Glossary

| Term | Meaning |
|---|---|
| ADK | Google Agent Development Kit. We use `@google/adk` in TypeScript. |
| Tool | A function the agent can call. Each tool has an input schema and returns typed data. |
| Card | An event box in the UI. It shows only data from a tool result. |
| Catalog | The checked list of events that the collector publishes. |
| Hard constraint | A rule from the request that a result must satisfy: date, place, budget, category, negation, age. |
| Jev | A TypeSafe model that checks if a candidate event supports the request. |
| Voyage | The embedding service for vector retrieval. |
| BM25 | A word-matching ranking method. It is the fallback when vectors are missing. |
| Golden set | Fixed search cases with expected results (`web/fixtures/golden-v1.json`). |
| Agent evaluation | 34 recorded conversations that check tool calls and constraints (`npm run eval:agent`). |
| Staging | The private test deployment on Cloud Run. |

## Ask an agent to explain the project

Open a coding agent in the repository root and give it a prompt like one of these:

- "Read `docs/onboarding.md` and explain the project to me. I am a new teammate."
- "I own the Frontend role. Show me the files I will change and how to test them."
- "Explain how `search_events` handles the request 'not in Kadıköy, under 300 TL'."
- "Walk me through what happens from a chat message to the cards on the screen."

The agent must answer from the documents and the code. If a document and the
code disagree, the agent tells you and the [project plan](project-plan.md) wins.
