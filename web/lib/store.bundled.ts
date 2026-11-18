import bundledEvents from '../data/events.json' with { type: 'json' };
import {
  buildSearchCatalog,
  searchCatalogCandidates,
  type SearchCatalog,
} from './materialized-catalog.ts';
import { emptyFilters, type EventRecord } from './types.ts';
import type { CatalogStatus, HighLevelStore } from './storage-contract.ts';
import type { LimitConsumer } from './rate-limit.ts';

export class BundledCatalogReadOnlyError extends Error {
  constructor() {
    super('Bundled catalog is read-only.');
  }
}

function readOnly(): never {
  throw new BundledCatalogReadOnlyError();
}

function validatedEvents(value: unknown): EventRecord[] {
  if (!Array.isArray(value) || !value.length)
    throw new Error('Bundled catalog is invalid.');
  for (const event of value)
    if (
      !event ||
      typeof event !== 'object' ||
      typeof (event as EventRecord).id !== 'string' ||
      typeof (event as EventRecord).startsAt !== 'string' ||
      typeof (event as EventRecord).checkedAt !== 'string'
    )
      throw new Error('Bundled catalog is invalid.');
  return value as EventRecord[];
}

function statusFor(
  source: EventRecord[],
  catalog: SearchCatalog,
  now: Date,
): CatalogStatus {
  const eligible = searchCatalogCandidates(catalog, emptyFilters, now).length;
  const checks = source.map((event) => event.checkedAt).sort();
  return {
    status: eligible ? 'ready' : 'empty',
    stored: source.length,
    eligible,
    lastCheckedAt: checks.at(-1) ?? null,
    oldestCheckedAt: checks[0] ?? null,
    expiresAt: null,
  };
}

export function createBundledStore(
  input: unknown,
  options: {
    loadedAt?: Date;
    consumeLimit: LimitConsumer;
  },
): HighLevelStore {
  const source = validatedEvents(input);
  const loadedAt = options.loadedAt ?? new Date();
  const catalog = buildSearchCatalog(source, loadedAt, {
    evidenceMode: 'snapshot',
  });
  const status = (now = new Date()) => statusFor(source, catalog, now);
  const emptyVectors = async () => new Map<string, number[]>();
  return {
    async health() {},
    async candidates(filters, now = new Date()) {
      return searchCatalogCandidates(catalog, filters, now);
    },
    async embeddingCandidates(now = new Date()) {
      return searchCatalogCandidates(catalog, emptyFilters, now);
    },
    async catalogStatus(now = new Date()) {
      return status(now);
    },
    consumeLimit: options.consumeLimit,
    async currentPublished(now = new Date()) {
      return { catalog: status(now), checkpoint: null };
    },
    async checkpointPointer() {
      return null;
    },
    async readCheckpoint() {
      return null;
    },
    async checkpointPublication() {
      return null;
    },
    async checkpointExists() {
      return false;
    },
    voyageVectorsByHash: emptyVectors,
    activateSearchCatalog: async () => readOnly(),
    acquireLease: async () => readOnly(),
    releaseLease: async () => readOnly(),
    importPages: async () => readOnly(),
    publishCheckpoint: async () => readOnly(),
    saveVoyageVectors: async () => readOnly(),
  };
}

let cached: HighLevelStore | undefined;

/** Load and prepare the tracked snapshot once in each warm function instance. */
export function bundledStore(consumeLimit: LimitConsumer): HighLevelStore {
  return (cached ??= createBundledStore(bundledEvents, { consumeLimit }));
}

export function bundledEventCount() {
  return validatedEvents(bundledEvents).length;
}
