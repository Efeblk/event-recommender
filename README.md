# Bi' Plan

Bi' Plan is a Google ADK agent that plans Istanbul outings from Turkish and
English requests. It finds correct, bookable events, plans the route between
venues and saves plans for the user.
Use [the project plan](docs/project-plan.md) for scope, sprints and acceptance checks.
Use [the architecture](docs/architecture.md) for the target system and the current data flow.

The agent lives in `web/agent/`. The search application below is its
`search_events` tool.

The application runs on Node in GCP Cloud Run.
Firestore holds catalog pointers, leases and request limits.
Private Cloud Storage holds catalog checkpoints and cached vectors.
The collector supports Biletinial, Bubilet and Biletix.
PostgreSQL is outside v1. Its code stays in the old repository (see below).

## Repository history

This repository continues
[Efeblk/event_recommender](https://github.com/Efeblk/event_recommender)
from commit `469b188`. It holds only the code that v1 uses.
The old repository keeps the full history, the old PRs and the archived evidence.
GCP deployment is not in this repository yet: no workflows, Terraform or runbooks.
GCP staging still deploys and collects from the old repository.

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

Configure Gemini with one of these:

- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) for the Gemini API.
- `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT` and optional
  `GOOGLE_CLOUD_LOCATION` (default `us-central1`) for Vertex AI with
  Application Default Credentials.

`BIPLAN_AGENT_MODEL` selects the model (default `gemini-2.5-flash`). Without
Gemini settings, `/api/agent` returns 503 with code `agent_unavailable`.
Each turn has a 60 s limit and at most 8 model calls. The route uses the same
body limit, visitor rate limit, daily AI limit and catalog check as search.
Sessions stay in process memory until the Firestore session store exists.

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

Use [the collector guide](collector/README.md).
Scheduled collection runs in the old repository
([GCP collector runbook](https://github.com/Efeblk/event_recommender/blob/469b188e36c51df9a01b8f65bf83e2e99510698a/docs/gcp-collector.md)).
That workflow imports verified records, publishes a complete checkpoint
and reads it back. Raw provider pages are excluded from workflow artifacts.
Small JSON reports remain available.

## Verification

```sh
cd web
npm test
npm run typecheck
npm run lint
npm run test:deploy-config
npm run test:deploy:gcp
npm run build:node
npm run test:smoke:node
```

After the build, use `BIPLAN_BROWSER_START=1 npm run test:browser`.
In PowerShell, set `$env:BIPLAN_BROWSER_START = '1'` first.
The browser suite uses mocked API responses and has no cloud or AI credentials.
Run `npm test` in `collector/` for collector changes.
CI also checks the Linux Docker image.

`npm run build`, `npm run start` and `npm run test:smoke`
are aliases for the Node commands. They do not run Cloudflare.

## Staging

Staging deploys from the old repository ([GCP deployment runbook](https://github.com/Efeblk/event_recommender/blob/469b188e36c51df9a01b8f65bf83e2e99510698a/docs/gcp-deployment.md)).
Staging is private. The product plan permits staging deploys and gate approval.
Public access and new paid resources need user approval.
`/api/health` checks the application. `/api/ready` checks catalog readiness.

[Archived documents](https://github.com/Efeblk/event_recommender/tree/469b188e36c51df9a01b8f65bf83e2e99510698a/docs/archive) preserve earlier plans and evidence.
The [legacy README](https://github.com/Efeblk/event_recommender/blob/469b188e36c51df9a01b8f65bf83e2e99510698a/docs/archive/legacy-readme.md) describes the old Python application.
The old Python and dashboard code do not run the v1 application.
