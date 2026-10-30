mock_provider "google" {
  mock_data "google_project" {
    defaults = {
      number          = "123456789012"
      project_id      = "biplan-offline-test"
      billing_account = "ABCDEF-123456-ABCDEF"
    }
  }
}

variables {
  project_id                          = "biplan-offline-test"
  dedicated_billing_project_confirmed = true
}

run "private_staging_plan" {
  command = plan

  assert {
    condition     = google_firestore_database.catalog_control.name == "(default)" && google_firestore_database.catalog_control.type == "FIRESTORE_NATIVE" && google_firestore_database.catalog_control.location_id == var.region
    error_message = "The native default database must share the application's region."
  }
  assert {
    condition     = google_firestore_field.agent_session_ttl.collection == "agentSessions" && google_firestore_field.agent_session_ttl.field == "expiresAt" && length(google_firestore_field.agent_session_ttl.ttl_config) == 1
    error_message = "Agent sessions must have a TTL policy on expiresAt."
  }
  assert {
    condition     = google_storage_bucket.collection.public_access_prevention == "enforced" && google_storage_bucket.collection.uniform_bucket_level_access && !google_storage_bucket.collection.force_destroy && length(google_storage_bucket.collection.lifecycle_rule) == 0
    error_message = "The catalog bucket must stay private and must not expire source objects."
  }
  assert {
    condition     = length(google_secret_manager_secret.application) == 5 && length(google_secret_manager_secret_iam_member.runtime_secret) == 5 && contains(keys(google_secret_manager_secret.application), "gemini_api_key") && contains(keys(google_secret_manager_secret.application), "google_maps_api_key")
    error_message = "Only the five named application secrets and scoped runtime access are prepared."
  }
  assert {
    condition     = strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "1439126446") && strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "108200358") && strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "Efeblk/event-recommender") && strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "environment:gcp-staging") && strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "gcp-staging.yml@refs/heads/master")
    error_message = "Deployment trust must bind this repository, the protected environment, the workflow and the exact branch."
  }
  assert {
    condition     = length(google_project_iam_member.runtime_vertex_ai) == 0 && !contains(local.services, "aiplatform.googleapis.com")
    error_message = "Vertex AI stays off without an explicit opt-in."
  }
  assert {
    condition     = length(google_billing_budget.staging) == 0
    error_message = "A billing budget stays optional without an explicit account."
  }
}

run "unconfirmed_project_rejected" {
  command = plan
  variables { dedicated_billing_project_confirmed = false }
  expect_failures = [var.dedicated_billing_project_confirmed]
}

run "vertex_ai_opt_in" {
  command = plan
  variables { vertex_ai_enabled = true }
  assert {
    condition     = length(google_project_iam_member.runtime_vertex_ai) == 1 && google_project_iam_member.runtime_vertex_ai[0].role == "roles/aiplatform.user" && contains(local.services, "aiplatform.googleapis.com")
    error_message = "The Vertex AI opt-in gives the runtime identity only roles/aiplatform.user."
  }
}

run "optional_budget_and_reviewed_branch" {
  command = plan
  variables {
    budget_billing_account = "ABCDEF-123456-ABCDEF"
    github_allowed_branch  = "t3/sprint4-gcp-deploy"
  }
  assert {
    condition     = length(google_billing_budget.staging) == 1 && google_billing_budget.staging[0].amount[0].specified_amount[0].currency_code == "USD" && google_billing_budget.staging[0].amount[0].specified_amount[0].units == "5"
    error_message = "An explicit account gives the default USD 5 alert."
  }
  assert {
    condition     = length(google_billing_budget.staging[0].all_updates_rule) == 0
    error_message = "Default IAM notifications omit an empty update rule."
  }
  assert {
    condition     = strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "refs/heads/t3/sprint4-gcp-deploy") && !strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "refs/heads/master")
    error_message = "A branch override replaces branch trust. It does not add to it."
  }
}

run "try_budget" {
  command = plan
  variables {
    budget_billing_account       = "ABCDEF-123456-ABCDEF"
    budget_currency_code         = "TRY"
    budget_amount                = 250
    budget_notification_channels = ["projects/biplan-staging-test/notificationChannels/123"]
  }
  assert {
    condition     = google_billing_budget.staging[0].amount[0].specified_amount[0].currency_code == "TRY" && google_billing_budget.staging[0].amount[0].specified_amount[0].units == "250"
    error_message = "A TRY billing account supports an explicit TRY 250 alert."
  }
  assert {
    condition     = length(google_billing_budget.staging[0].all_updates_rule) == 1 && !google_billing_budget.staging[0].all_updates_rule[0].disable_default_iam_recipients
    error_message = "Custom channels keep the default billing IAM recipients."
  }
}

run "invalid_budget_currency_rejected" {
  command = plan
  variables { budget_currency_code = "try" }
  expect_failures = [var.budget_currency_code]
}

run "wrong_billing_account_rejected" {
  command = plan
  variables { budget_billing_account = "AAAAAA-BBBBBB-CCCCCC" }
  expect_failures = [data.google_project.selected]
}
