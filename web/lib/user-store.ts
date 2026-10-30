/** Saved plans and favorites. Each record belongs to one Firebase user ID. */
import { createHash } from 'node:crypto';

export const MAX_PLANS_PER_USER = 50;
export const MAX_FAVORITES_PER_USER = 200;
export const MAX_PLAN_ITEMS = 6;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface SavedItem {
  eventId: string;
  title: string;
  startsAt: string;
  venue: string;
  district: string;
  address: string;
  url: string;
}

export interface SavedLeg {
  fromEventId: string;
  toEventId: string;
  mode: 'transit' | 'drive' | 'walk';
  minutes: number | null;
}

export interface SavedPlan {
  id: string;
  title: string;
  note: string;
  items: SavedItem[];
  legs: SavedLeg[];
  createdAt: string;
  updatedAt: string;
}

export interface SavedFavorite extends SavedItem {
  savedAt: string;
}

export class UserStoreLimitError extends Error {}

export interface UserStore {
  listPlans(uid: string): Promise<SavedPlan[]>;
  getPlan(uid: string, id: string): Promise<SavedPlan | null>;
  savePlan(uid: string, plan: SavedPlan): Promise<SavedPlan>;
  deletePlan(uid: string, id: string): Promise<boolean>;
  listFavorites(uid: string): Promise<SavedFavorite[]>;
  saveFavorite(uid: string, favorite: SavedFavorite): Promise<SavedFavorite>;
  deleteFavorite(uid: string, eventId: string): Promise<boolean>;
}

export function validUserId(uid: string) {
  return ID.test(uid);
}
export function validRecordId(id: string) {
  return ID.test(id);
}
/** Catalog event IDs, for example "biletinial:123" or "session-<hash>". */
export const EVENT_ID = /^[A-Za-z0-9_:.-]{1,200}$/;
export function validEventId(id: string) {
  return EVENT_ID.test(id);
}
/** Document key for a favorite. Event IDs can contain characters that are not safe in a path. */
export function favoriteKey(eventId: string) {
  if (!validEventId(eventId)) throw new Error('Invalid event.');
  return createHash('sha256').update(eventId).digest('hex').slice(0, 40);
}

/** Documents keyed by path. The Firestore store and the memory store share it. */
export interface DocumentCollection {
  list(path: string): Promise<Record<string, unknown>[]>;
  get(path: string): Promise<Record<string, unknown> | null>;
  set(path: string, value: Record<string, unknown>): Promise<void>;
  delete(path: string): Promise<boolean>;
  count(path: string): Promise<number>;
}

const byNewest = <T extends { updatedAt?: string; savedAt?: string }>(a: T, b: T) =>
  (b.updatedAt ?? b.savedAt ?? '').localeCompare(a.updatedAt ?? a.savedAt ?? '');

export function createUserStore(documents: DocumentCollection, namespace: string): UserStore {
  const root = (uid: string) => {
    if (!validUserId(uid)) throw new Error('Invalid user.');
    return `envs/${namespace}/users/${uid}`;
  };
  const plans = (uid: string) => `${root(uid)}/plans`;
  const favorites = (uid: string) => `${root(uid)}/favorites`;
  const recordPath = (collection: string, id: string) => {
    if (!validRecordId(id)) throw new Error('Invalid record.');
    return `${collection}/${id}`;
  };
  return {
    async listPlans(uid) {
      return ((await documents.list(plans(uid))) as unknown as SavedPlan[]).sort(byNewest);
    },
    async getPlan(uid, id) {
      return (await documents.get(recordPath(plans(uid), id))) as SavedPlan | null;
    },
    async savePlan(uid, plan) {
      const path = recordPath(plans(uid), plan.id);
      if (!(await documents.get(path)) && (await documents.count(plans(uid))) >= MAX_PLANS_PER_USER)
        throw new UserStoreLimitError('Plan limit reached.');
      await documents.set(path, plan as unknown as Record<string, unknown>);
      return plan;
    },
    async deletePlan(uid, id) {
      return documents.delete(recordPath(plans(uid), id));
    },
    async listFavorites(uid) {
      return ((await documents.list(favorites(uid))) as unknown as SavedFavorite[]).sort(byNewest);
    },
    async saveFavorite(uid, favorite) {
      const path = recordPath(favorites(uid), favoriteKey(favorite.eventId));
      if (!(await documents.get(path)) && (await documents.count(favorites(uid))) >= MAX_FAVORITES_PER_USER)
        throw new UserStoreLimitError('Favorite limit reached.');
      await documents.set(path, favorite as unknown as Record<string, unknown>);
      return favorite;
    },
    async deleteFavorite(uid, eventId) {
      return documents.delete(recordPath(favorites(uid), favoriteKey(eventId)));
    },
  };
}

/** Process memory documents for tests and local development without GCP. */
export function memoryDocuments(): DocumentCollection {
  const data = new Map<string, Record<string, unknown>>();
  const children = (path: string) =>
    [...data.entries()].filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'));
  const clone = <T>(value: T): T => structuredClone(value);
  return {
    async list(path) {
      return children(path).map(([, value]) => clone(value));
    },
    async get(path) {
      const value = data.get(path);
      return value ? clone(value) : null;
    },
    async set(path, value) {
      data.set(path, clone(value));
    },
    async delete(path) {
      return data.delete(path);
    },
    async count(path) {
      return children(path).length;
    },
  };
}
