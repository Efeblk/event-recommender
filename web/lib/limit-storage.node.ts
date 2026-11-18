import { createHash } from 'node:crypto';
import type { LimitConsumer } from './rate-limit.ts';

interface Snapshot {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
type Reference = object;
export interface LimitFirestore {
  doc(path: string): Reference;
  runTransaction<T>(
    callback: (transaction: {
      get(reference: Reference): Promise<Snapshot>;
      set(reference: Reference, value: Record<string, unknown>): void;
    }) => Promise<T>,
  ): Promise<T>;
}

export function memoryLimitConsumer(now = () => Date.now()): LimitConsumer {
  const counters = new Map<string, { count: number; expiresAt: number }>();
  return async (key, limit, expiresAt) => {
    const time = now();
    if (expiresAt <= time) return false;
    const previous = counters.get(key);
    const count = previous && previous.expiresAt > time ? previous.count : 0;
    if (count >= limit) return false;
    counters.set(key, { count: count + 1, expiresAt });
    return true;
  };
}

export function firestoreLimitConsumer(
  firestore: LimitFirestore,
  namespace: string,
  now = () => Date.now(),
): LimitConsumer {
  return async (key, limit, expiresAt) => {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      !Number.isFinite(expiresAt)
    )
      throw new Error('Invalid request limit');
    const digest = createHash('sha256').update(key).digest('hex');
    const reference = firestore.doc(`envs/${namespace}/limits/${digest}`);
    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const previous = snapshot.exists ? snapshot.data() : undefined;
      const time = now();
      if (expiresAt <= time) return false;
      const previousExpiry = Number(previous?.expiresAt);
      const count =
        previous && previousExpiry > time ? Number(previous.count) : 0;
      if (!Number.isSafeInteger(count) || count < 0)
        throw new Error('Invalid request counter');
      if (count >= limit) return false;
      transaction.set(reference, { count: count + 1, expiresAt });
      return true;
    });
  };
}
