type Environment = Readonly<Record<string, string | undefined>>;

export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

export interface FirestoreRuntimeConfig {
  projectId: string;
  databaseId: string;
  credentials?: ServiceAccountCredentials;
}

const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DATABASE_ID = /^\(default\)$|^[a-z][a-z0-9-]{2,62}$/;
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CREDENTIAL_ERROR = 'GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is invalid.';

/** Parse one Vercel-safe service-account setting without exposing its value. */
export function serviceAccountCredentialsFromEnv(
  env: Environment = process.env,
): ServiceAccountCredentials | null {
  const encoded = env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  if (!encoded) return null;
  try {
    if (!BASE64.test(encoded) || encoded.length % 4 !== 0)
      throw new Error(CREDENTIAL_ERROR);
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded) throw new Error(CREDENTIAL_ERROR);
    const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    if (
      value.type !== 'service_account' ||
      typeof value.client_email !== 'string' ||
      !/^[^\s@]+@[^\s@]+$/.test(value.client_email) ||
      typeof value.private_key !== 'string' ||
      !value.private_key.includes('BEGIN PRIVATE KEY') ||
      !value.private_key.includes('END PRIVATE KEY')
    )
      throw new Error(CREDENTIAL_ERROR);
    const projectId = env.EVENT_REC_GCP_PROJECT?.trim();
    if (
      projectId &&
      typeof value.project_id === 'string' &&
      value.project_id !== projectId
    )
      throw new Error(
        'Service account project does not match EVENT_REC_GCP_PROJECT.',
      );
    return {
      client_email: value.client_email,
      private_key: value.private_key,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        'Service account project does not match EVENT_REC_GCP_PROJECT.'
    )
      throw error;
    throw new Error(CREDENTIAL_ERROR);
  }
}

/**
 * Standalone Firestore needs explicit credentials. Cloud Run can opt in to
 * Application Default Credentials for the existing GCP storage path.
 */
export function firestoreRuntimeConfigFromEnv(
  env: Environment = process.env,
  options: { allowApplicationDefault?: boolean } = {},
): FirestoreRuntimeConfig | null {
  const projectId = env.EVENT_REC_GCP_PROJECT?.trim();
  const credentials = serviceAccountCredentialsFromEnv(env);
  if (!projectId || (!credentials && !options.allowApplicationDefault))
    return null;
  if (!PROJECT_ID.test(projectId))
    throw new Error('EVENT_REC_GCP_PROJECT is invalid.');
  const databaseId = env.FIRESTORE_DATABASE?.trim() || '(default)';
  if (!DATABASE_ID.test(databaseId))
    throw new Error('FIRESTORE_DATABASE is invalid.');
  return {
    projectId,
    databaseId,
    ...(credentials ? { credentials } : {}),
  };
}

export function standaloneFirestoreConfigured(env: Environment = process.env) {
  return Boolean(
    env.EVENT_REC_GCP_PROJECT?.trim() &&
    env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim(),
  );
}

export async function createRuntimeFirestore(
  env: Environment = process.env,
  options: { allowApplicationDefault?: boolean } = {},
) {
  const config = firestoreRuntimeConfigFromEnv(env, options);
  if (!config) return null;
  const { Firestore } = await import('@google-cloud/firestore');
  return new Firestore(config);
}
