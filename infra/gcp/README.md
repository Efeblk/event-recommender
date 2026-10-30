# GCP staging infrastructure

These Terraform files prepare the GCP side of Bi' Plan staging. They come
from `Efeblk/event_recommender@469b188` (`infra/gcp/`). PostgreSQL and the
collector identity are not included. The changes are:

- GitHub trust is for this repository (`Efeblk/event-recommender`, ID
  `1439126446`).
- There are two more secret names: the Gemini API key and the Google Maps key.
- A Firestore TTL policy on `agentSessions.expiresAt` deletes agent sessions
  after 7 days.
- The Identity Toolkit API is on, for Firebase Auth.
- `vertex_ai_enabled` is an optional switch. It lets the runtime identity
  call Gemini through Vertex AI, with no API key. This is paid.

The files create no project, billing link, Cloud Run service, secret value,
service-account key or public endpoint. The deploy workflow
(`.github/workflows/gcp-staging.yml`) owns the Cloud Run revisions.

> **Do not apply these files to the existing staging project
> (`biplan-stg-efeblk`) without a decision from the user.** That project is
> managed from the old repository. A new apply with new state fails on
> resources that already exist. An import moves GitHub trust from the old
> repository to this one. The old collector then loses its identity, because
> `collector.tf` is not here.

## Resources

| Resource | Configuration |
| --- | --- |
| Firestore | Native `(default)` database in the app region. Delete protection. TTL on `agentSessions.expiresAt` |
| GCS | Private bucket. Uniform access. Public access prevention. 7-day soft delete. No object expiry |
| Artifact Registry | Docker repository. Keep 3 recent versions. Delete untagged versions after 7 days |
| Secret Manager | Names only: sync token, TypeSafe, Voyage, Gemini, Google Maps |
| Runtime identity | Firestore data access, bucket read and create, access to the 5 secrets. `roles/aiplatform.user` only with `vertex_ai_enabled` |
| Deploy identity | Registry write, Cloud Run developer and invoker, service IAM read and update, run as the runtime identity |
| GitHub federation | Repository and owner IDs, environment `gcp-staging`, branch `master`, workflow `gcp-staging.yml` |
| Budget (optional) | Monthly alert at 50 %, 100 % and 100 % forecast. Default USD 5. An alert does not stop spending |

## Check without GCP access

You need Terraform 1.7 or later, below 2.0. CI uses 1.16.4.

```sh
terraform -chdir=infra/gcp init -backend=false
terraform -chdir=infra/gcp fmt -check -recursive
terraform -chdir=infra/gcp validate
terraform -chdir=infra/gcp test
```

The tests use a mock provider and make no GCP calls. A passing mock plan
does not show that the cloud application works.

## Steps for the user (not done yet)

1. **Project.** Choose a dedicated project with billing. Copy
   `terraform.tfvars.example` to `terraform.tfvars` (ignored). Set
   `project_id` and `dedicated_billing_project_confirmed = true`. For the
   budget alert, set `budget_billing_account` and the account currency.
2. **State and apply.** Choose protected state storage, not the application
   bucket. Make a saved plan, review it and apply it. Charges need user
   approval.
3. **Secrets.** Add secret versions with `gcloud secrets versions add`
   through a protected channel. Never put values in files or chat. The
   Gemini and Maps secrets are optional.
4. **Firebase.** In the Firebase console, add Firebase to the project and
   turn on Google and anonymous sign-in. Add the Cloud Run URL to the
   authorized domains. Copy the web API key, the project ID and the auth
   domain. These are public identifiers, not secrets.
5. **GitHub environment.** Create the `gcp-staging` environment with required
   reviewers and the `master` branch only. Copy
   `terraform output -json github_environment_variables` into its variables.
   Add these variables:
   - `GCP_SYNC_TOKEN_SECRET_VERSION`, `GCP_TYPESAFE_API_KEY_SECRET_VERSION` and
     `GCP_VOYAGE_API_KEY_SECRET_VERSION` (required)
   - `GCP_GEMINI_API_KEY_SECRET_VERSION` and
     `GCP_GOOGLE_MAPS_API_KEY_SECRET_VERSION` (optional)
   - `FIREBASE_WEB_API_KEY`, `FIREBASE_PROJECT_ID` and `FIREBASE_AUTH_DOMAIN`
     (optional)
   - `GCP_AGENT_MODEL` (optional)

   Versions are positive numbers. The workflow does not accept `latest`.
6. **Deploy.** Run **Deploy GCP staging** with the exact commit SHA. The
   workflow first checks that `verify`, `collector`, `terraform` and
   `container` passed on that SHA. It deploys a private revision with no
   traffic and checks the revision. Then it moves all traffic to the revision
   and checks private health and readiness. It also checks that a call
   without a token gets 403.

## Public access

Staging stays private. Every deploy uses `--no-allow-unauthenticated`. The
course requires that other people can use the app. Public access needs user
approval in Sprint 4. It also needs these items first:

- sign-in
- the per-user and visitor rate limits
- the daily AI limit
- the budget alert

Make public access a separate reviewed change.

## References

- [Google provider 8.4.0](https://github.com/hashicorp/terraform-provider-google/releases/tag/v8.4.0)
- [Firestore field (TTL)](https://registry.terraform.io/providers/hashicorp/google/8.4.0/docs/resources/firestore_field)
- [Workload Identity Federation provider](https://registry.terraform.io/providers/hashicorp/google/8.4.0/docs/resources/iam_workload_identity_pool_provider)
- [Billing budget](https://registry.terraform.io/providers/hashicorp/google/8.4.0/docs/resources/billing_budget)
- [Cloud Run IAM roles](https://docs.cloud.google.com/run/docs/reference/iam/roles)
