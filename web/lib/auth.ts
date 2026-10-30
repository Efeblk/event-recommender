import { createPublicKey, createVerify, type KeyObject } from 'node:crypto';

/** Google's public certificates for Firebase Auth ID tokens. */
export const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const CLOCK_SKEW_S = 60;
const MAX_TOKEN_CHARS = 4096;

export interface AuthUser {
  uid: string;
  anonymous: boolean;
  email: string | null;
  name: string | null;
}

export type KeySource = (kid: string) => Promise<KeyObject | null>;

const base64url = (part: string) => Buffer.from(part, 'base64url');
const json = (part: string) => JSON.parse(base64url(part).toString('utf8')) as Record<string, unknown>;

/**
 * Verifies a Firebase Auth ID token (RS256) for one project. Returns null for
 * every invalid, expired or foreign token. Never throws on bad input.
 */
export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
  keys: KeySource,
  nowMs = Date.now(),
): Promise<AuthUser | null> {
  try {
    if (!token || token.length > MAX_TOKEN_CHARS) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = json(parts[0]);
    const payload = json(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
    const key = await keys(header.kid);
    if (!key) return null;
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    if (!verifier.verify(key, base64url(parts[2]))) return null;
    const now = Math.floor(nowMs / 1000);
    const { exp, iat, aud, iss, sub } = payload;
    if (typeof exp !== 'number' || exp + CLOCK_SKEW_S <= now) return null;
    if (typeof iat !== 'number' || iat - CLOCK_SKEW_S > now) return null;
    if (aud !== projectId || iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (typeof sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(sub)) return null;
    const firebase = payload.firebase as { sign_in_provider?: unknown } | undefined;
    return {
      uid: sub,
      anonymous: firebase?.sign_in_provider === 'anonymous',
      email: typeof payload.email === 'string' ? payload.email : null,
      name: typeof payload.name === 'string' ? payload.name : null,
    };
  } catch {
    return null;
  }
}

/** Fetches and caches Google's certificates for the time that Cache-Control allows. */
export function googleCertificateKeys(fetcher: typeof fetch = fetch): KeySource {
  let cache: { keys: Map<string, KeyObject>; expiresAt: number } | null = null;
  return async (kid) => {
    if (!cache || cache.expiresAt <= Date.now()) {
      const response = await fetcher(FIREBASE_CERTS_URL, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return null;
      const certificates = (await response.json()) as Record<string, string>;
      const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 3600);
      cache = {
        keys: new Map(Object.entries(certificates).map(([id, pem]) => [id, createPublicKey(pem)])),
        expiresAt: Date.now() + Math.min(maxAge, 86400) * 1000,
      };
    }
    return cache.keys.get(kid) ?? null;
  };
}

/** Reads a bearer token from the Authorization header. */
export function bearerToken(request: Request) {
  const value = request.headers.get('authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(value.trim());
  return match ? match[1] : null;
}

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
}

/** Public Firebase web settings. Without them, sign-in is off. */
export function firebaseWebConfigFrom(env: Record<string, string | undefined>): FirebaseWebConfig | null {
  const apiKey = env.FIREBASE_WEB_API_KEY?.trim();
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  if (!apiKey || !projectId || !/^[a-z][a-z0-9-]{4,29}$/.test(projectId)) return null;
  return {
    apiKey,
    projectId,
    authDomain: env.FIREBASE_AUTH_DOMAIN?.trim() || `${projectId}.firebaseapp.com`,
  };
}
