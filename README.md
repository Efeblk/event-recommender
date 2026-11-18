# Event Recommender

Event Recommender is a Google ADK agent that plans Istanbul outings from
Turkish and English requests. It finds correct, bookable events, plans the route between
venues and saves plans for the user.
It is the solo project for the course JOB191 - Dream Data Labs Solutions AI
Augmented Software Engineering (1).
Use [the project plan](docs/project-plan.md) for scope, sprints and acceptance checks.
Use [the architecture](docs/architecture.md) for the target system and the current data flow.

The agent lives in `web/agent/`. The search application below is its
`search_events` tool.

The course demo runs on Vercel. It uses the tracked catalog snapshot and
Firestore on the Firebase Spark plan. The optional GCP files remain available.
The collector supports Biletinial, Bubilet and Biletix.
PostgreSQL is outside the project.

## Install

Use Node from `web/.nvmrc`. Both packages require Node >=22.13.

```sh
npm ci --prefix web
npm ci --prefix collector
```

## Local preview

```sh
cd web
npm run local:start
```

Open **http://127.0.0.1:3001**. The command builds and starts the Node server.
Use `npm run local:start -- --dev` for the development server.
Local settings load from ignored `web/.env` and `web/.dev.vars`.
The command creates a local sync token when needed. It does not print the token.

Without GCP storage settings, the page loads but catalog requests remain unavailable.
`/api/ready` returns 503 in that state. There is no automatic seed catalog.
Use the offline unit tests and mocked browser suite to test catalog behavior.
A local server connected to GCP needs explicit settings and application credentials.
It uses the configured GCP snapshot store. It does not create a local database.
Use a separate development or staging environment. Keep production resources separate.

For a configured local server, import a validated collector report with:

```sh
npm run local:refresh -- --report /path/to/report.json
```

Use `--collect` to collect fresh data first.
Paid Voyage indexing needs an approved budget before use.
Never put secrets in chat, Git, a build artifact or a public environment variable.

## Plan assistant

Open **/plan** for the chat. `POST /api/agent` takes `{ sessionId, message }`
and streams newline-delimited JSON events: `tool`, `cards`, `text`, `error`
and `done`. Cards come only from tool results. Model text cannot create cards.

The root ADK `LlmAgent` (`web/agent/agent.ts`) uses Gemini and these tools:

- `search_events`: the checked search pipeline below. The agent sends one
  complete request each time, so the pipeline stays stateless.
- `get_event_details`: current catalog records for event IDs.
- `plan_outing`: orders 2–6 events, adds travel legs and finds overlap,
  travel and different-day conflicts in code. Durations are estimates.
- `plan_route`: travel time between two events from the Google Maps Routes
  API. At most 6 route calls per turn. Results are cached.
- `get_weather`: the Open-Meteo forecast for a date and district (no key).
- `save_plan`, `list_plans`, `save_favorite`: saved data for a signed-in user.
  Visitors get `sign_in_required`.

Configure Gemini with one of these:

- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) for the Gemini API.
- `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT` and optional
  `GOOGLE_CLOUD_LOCATION` (default `us-central1`) for Vertex AI with
  Application Default Credentials.

`EVENT_REC_AGENT_MODEL` selects the model (default `gemini-2.5-flash`). Without
Gemini settings, `/api/agent` returns 503 with code `agent_unavailable`.
Each turn has a 60 s limit and at most 8 model calls. The route uses the same
body limit, visitor rate limit, daily AI limit and catalog check as search.

Other settings. Each feature turns off safely when its setting is missing:

- `GOOGLE_MAPS_API_KEY`: travel times. Without it, legs have status `unavailable`.
- `FIREBASE_WEB_API_KEY`, `FIREBASE_PROJECT_ID` and `FIREBASE_AUTH_DOMAIN`:
  Google and guest sign-in. Without them, the UI hides sign-in. The server
  checks Firebase ID tokens (RS256, Google certificates) and sets per-user
  limits of 6 turns per minute and 60 per hour.
- `EVENT_REC_GCP_PROJECT` and `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`: Firestore
  for saved data, agent sessions and rate limits on Vercel. The second setting
  is the base64 service-account JSON and must stay secret.
- `GCP_STORAGE_BUCKET` and `EVENT_REC_GCP_PROJECT`: Existing Cloud Run catalog
  storage. Cloud Run can use Application Default Credentials.
  Without Firestore settings, user data stays in process memory.
  `DEPLOYMENT_ENV` sets the namespace (`envs/{env}/...`).

Firestore paths are `envs/{env}/users/{uid}/plans/{id}`,
`envs/{env}/users/{uid}/favorites/{eventId}` and
`envs/{env}/agentSessions/{hash}`. Sessions keep at most 60 events and
expire after 7 days. Add a Firestore TTL policy on the `expiresAt` field of
`agentSessions`.

Signed-in users have **/saved** for plans and favorites, with `.ics` calendar
export. The API is `GET|DELETE /api/me/plans` and `GET|POST|DELETE
/api/me/favorites`. Each call needs `Authorization: Bearer <Firebase ID token>`.

## Search

Code resolves dates in Europe/Istanbul and checks hard constraints.
Retrieval combines BM25 word matching with cached Voyage vectors across the eligible catalog.
TypeSafe Jev checks a shortlist of up to 16 distinct candidates.
Cards use recorded titles, dates, venues, prices and provider links.
Each distinct candidate that passes the support threshold can appear.
Failed providers or missing vectors retain an explicit word-matching fallback.
Unknown prices and policies do not satisfy hard constraints.
Provider starting prices do not prove checkout totals or remaining stock.

Each search uses only the current message. Earlier requests do not affect it.
The interface has event cards, a support placeholder and reserved advertising areas.
There are no user accounts, payments or permanent user profiles.

Use [merge rules](web/docs/event-merging.md), [Jev checks](web/docs/jev-evaluation.md)
and [Voyage retrieval](web/docs/voyage-retrieval.md) for implementation details.

## Collection

```sh
cd collector
npm run collect -- --max-details 2000 --max-http 6000 --max-minutes 40
```

The collector retains unfinished coverage for later runs.
It distinguishes verified, retired, failed, quarantined and unvisited pages.
Failed pages keep their original check times.
Collection does not call TypeSafe. Optional Voyage indexing has a separate budget.

Use [the collector guide](collector/README.md). Run collection manually.
For the optional GCP path, import verified records, publish a complete
checkpoint and read it back. Raw provider pages stay out of workflow
artifacts.

## Verification

```sh
cd web
npm test
npm run typecheck
npm run lint
npm run eval:agent
npm run build:node
npm run test:smoke:node
```

`npm run eval:agent` replays the agent evaluation (`web/fixtures/agent-v1.json`,
34 Turkish and English conversations). The tools run on a synthetic catalog
(`web/evals/agent-catalog-v1.ts`) with fake route and weather services, so
the replay has no network calls. It reports hard-constraint violations,
duplicate cards, event titles that no tool returned, and the pass rate.
`npm test` runs the same replay in CI.

The current steps are scripted by hand (`recording.source: "scripted"`). They
check the tools, guards and expectations, not Gemini. To record a live run,
set the Gemini settings and give a call budget:

```sh
npm run eval:agent -- --record --max-model-calls 250 --out work/agent-eval/live.json
npm run eval:agent -- --fixture work/agent-eval/live.json
```

Record mode never retries a failed call and stops before a case that could
exceed the budget.

After the build, use `EVENT_REC_BROWSER_START=1 npm run test:browser`.
In PowerShell, set `$env:EVENT_REC_BROWSER_START = '1'` first.
The browser suite uses mocked API responses and has no cloud or AI credentials.
Run `npm test` in `collector/` for collector changes.
CI also builds the Linux Docker image and smokes it without credentials
(`web/scripts/smoke-container.sh`). It checks the Terraform files with
`terraform fmt`, `validate` and mocked `terraform test` plans.

`npm run build`, `npm run start` and `npm run test:smoke`
are aliases for the Node commands. They do not run Cloudflare.

## Staging

This repository has the staging deployment files:

- `infra/gcp/`: Terraform for the staging project (Firestore with a TTL on
  agent sessions, private bucket, Artifact Registry, secret names, identities,
  GitHub federation and an optional budget alert). See
  [infra/gcp/README.md](infra/gcp/README.md).
- `.github/workflows/gcp-staging.yml`: a manual deploy of one exact commit
  to a private Cloud Run service, through the protected `gcp-staging`
  environment.

Nothing is applied yet. Staging needs a new GCP project and a user decision.
Staging is private. The product plan permits staging deploys and gate approval.
Public access and new paid resources need user approval.
`/api/health` checks the application. `/api/ready` checks catalog readiness.

## Deploy to Vercel

Create a Vercel project from this repository. Set **Root Directory** to `web`.
The tracked `web/vercel.json` runs `npm run build:vercel` and deploys
`web/.vercel/output/`.

Set `EVENT_REC_CATALOG`, `DEPLOYMENT_ENV`, `GEMINI_API_KEY`,
`EVENT_REC_GCP_PROJECT`, `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`,
`FIREBASE_WEB_API_KEY`, `FIREBASE_PROJECT_ID` and `FIREBASE_AUTH_DOMAIN` in
Vercel. Set `AI_DAILY_LIMIT` if the default limit of 25 is not suitable. The
optional settings are `FIRESTORE_DATABASE`, `EVENT_REC_AGENT_MODEL` and
`GOOGLE_MAPS_API_KEY`. Do not set `GCP_STORAGE_BUCKET` for the bundled demo.

Before deployment, run these offline checks from `web/`:

```sh
npm run build:vercel
npm run test:smoke:vercel
```

Do not deploy the demo URL as a public product. Give it only to the user and
the course instructors.
