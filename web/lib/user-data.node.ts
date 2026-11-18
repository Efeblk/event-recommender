import type { BaseSessionService } from '@google/adk';
import { env } from './runtime-env.node.ts';
import { BoundedSessionService } from '../agent/agent.ts';
import { DocumentSessionService } from '../agent/sessions.ts';
import {
  createRuntimeFirestore,
  standaloneFirestoreConfigured,
} from './firestore-runtime.node.ts';
import {
  createUserStore,
  memoryDocuments,
  type DocumentCollection,
} from './user-store.ts';
import {
  googleCertificateKeys,
  verifyFirebaseIdToken,
  bearerToken,
  type AuthUser,
} from './auth.ts';

interface FirestoreDoc {
  get(): Promise<{
    exists: boolean;
    data(): Record<string, unknown> | undefined;
  }>;
  set(value: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
}
interface FirestoreCollection {
  get(): Promise<{ docs: { data(): Record<string, unknown> }[] }>;
  count(): { get(): Promise<{ data(): { count: number } }> };
}
interface FirestoreClient {
  doc(path: string): FirestoreDoc;
  collection(path: string): FirestoreCollection;
}

/** Firestore documents. Paths alternate collection and document names. */
export function firestoreDocuments(
  firestore: FirestoreClient,
): DocumentCollection {
  return {
    async list(path) {
      return (await firestore.collection(path).get()).docs.map((doc) =>
        doc.data(),
      );
    },
    async get(path) {
      const snapshot = await firestore.doc(path).get();
      return snapshot.exists ? (snapshot.data() ?? null) : null;
    },
    async set(path, value) {
      await firestore.doc(path).set(value);
    },
    async delete(path) {
      const reference = firestore.doc(path);
      if (!(await reference.get()).exists) return false;
      await reference.delete();
      return true;
    },
    async count(path) {
      return (await firestore.collection(path).count().get()).data().count;
    },
  };
}

let documentsPromise: Promise<DocumentCollection> | undefined;

export function persistentUserDataConfigured() {
  return Boolean(
    (env.GCP_STORAGE_BUCKET && env.EVENT_REC_GCP_PROJECT) ||
    standaloneFirestoreConfigured(env),
  );
}

/**
 * Firestore with explicit Vercel credentials or the existing Cloud Run
 * Application Default Credentials. Process memory is the local fallback.
 */
export function userDocuments(): Promise<DocumentCollection> {
  return (documentsPromise ??= (async () => {
    const firestore = await createRuntimeFirestore(env, {
      allowApplicationDefault: Boolean(
        env.GCP_STORAGE_BUCKET && env.EVENT_REC_GCP_PROJECT,
      ),
    });
    return firestore
      ? firestoreDocuments(firestore as unknown as FirestoreClient)
      : memoryDocuments();
  })().catch((error) => {
    documentsPromise = undefined;
    throw error;
  }));
}

export function userDataNamespace() {
  return env.DEPLOYMENT_ENV?.trim() || 'local';
}

export async function userStore() {
  return createUserStore(await userDocuments(), userDataNamespace());
}

const certificateKeys = googleCertificateKeys();

/** The signed-in user, or null without sign-in settings or a valid token. */
export async function requestUser(request: Request): Promise<AuthUser | null> {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  const token = bearerToken(request);
  if (!projectId || !token) return null;
  return verifyFirebaseIdToken(token, projectId, certificateKeys);
}

let sessionService: BaseSessionService | undefined;

/** Firestore sessions when configured; bounded process memory otherwise. */
export async function agentSessionService(): Promise<BaseSessionService> {
  if (sessionService) return sessionService;
  const documents = await userDocuments();
  sessionService = persistentUserDataConfigured()
    ? new DocumentSessionService(documents, userDataNamespace())
    : new BoundedSessionService();
  return sessionService;
}
