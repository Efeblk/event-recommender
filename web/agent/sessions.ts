import { createHash } from 'node:crypto';
import {
  BaseSessionService,
  type AppendEventRequest,
  type CreateSessionRequest,
  type DeleteSessionRequest,
  type Event,
  type GetSessionRequest,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type Session,
} from '@google/adk';

export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
export const MAX_SESSION_EVENTS = 60;
export const MAX_SESSION_BYTES = 600_000;

export interface SessionDocuments {
  get(path: string): Promise<Record<string, unknown> | null>;
  set(path: string, value: Record<string, unknown>): Promise<void>;
  delete(path: string): Promise<boolean>;
}

interface StoredSession {
  id: string;
  appName: string;
  userId: string;
  state: Record<string, unknown>;
  events: Event[];
  lastUpdateTime: number;
}

/**
 * Keeps the newest events that fit the limits. The kept history starts at a
 * user message, so a function response never loses its function call.
 */
export function trimSessionEvents(events: Event[], maxEvents = MAX_SESSION_EVENTS, maxBytes = MAX_SESSION_BYTES) {
  let start = Math.max(0, events.length - maxEvents);
  const size = (from: number) => Buffer.byteLength(JSON.stringify(events.slice(from)));
  while (start < events.length && size(start) > maxBytes) start++;
  while (start > 0 && start < events.length && events[start].author !== 'user') start++;
  return events.slice(start);
}

/**
 * ADK sessions in a document store (Firestore in production). One document per
 * session holds the JSON payload and an `expiresAt` time for a TTL policy.
 */
export class DocumentSessionService extends BaseSessionService {
  private readonly documents: SessionDocuments;
  private readonly namespace: string;
  private readonly now: () => number;
  constructor(documents: SessionDocuments, namespace: string, now: () => number = Date.now) {
    super();
    this.documents = documents;
    this.namespace = namespace;
    this.now = now;
  }

  private path(appName: string, userId: string, sessionId: string) {
    const key = createHash('sha256').update(JSON.stringify([appName, userId, sessionId])).digest('hex');
    return `envs/${this.namespace}/agentSessions/${key}`;
  }

  private async write(session: StoredSession) {
    const stored: StoredSession = {
      id: session.id,
      appName: session.appName,
      userId: session.userId,
      state: session.state,
      events: trimSessionEvents(session.events),
      lastUpdateTime: session.lastUpdateTime,
    };
    await this.documents.set(this.path(session.appName, session.userId, session.id), {
      payload: JSON.stringify(stored),
      expiresAt: new Date(this.now() + SESSION_TTL_MS),
    });
  }

  async createSession({ appName, userId, state, sessionId }: CreateSessionRequest): Promise<Session> {
    const session: StoredSession = {
      id: sessionId?.trim() || crypto.randomUUID(),
      appName,
      userId,
      state: Object.fromEntries(Object.entries(state ?? {}).filter(([key]) => !key.startsWith('temp:'))),
      events: [],
      lastUpdateTime: this.now(),
    };
    await this.write(session);
    return session;
  }

  async getSession({ appName, userId, sessionId, config }: GetSessionRequest): Promise<Session | undefined> {
    const document = await this.documents.get(this.path(appName, userId, sessionId));
    if (!document || typeof document.payload !== 'string') return undefined;
    const session = JSON.parse(document.payload) as StoredSession;
    if (session.appName !== appName || session.userId !== userId || session.id !== sessionId) return undefined;
    if (config?.numRecentEvents) session.events = session.events.slice(-config.numRecentEvents);
    if (config?.afterTimestamp)
      session.events = session.events.filter((event) => event.timestamp >= config.afterTimestamp!);
    return session;
  }

  /** Listing is not part of the product. Sessions are found by ID only. */
  async listSessions(request: ListSessionsRequest): Promise<ListSessionsResponse> {
    return { sessions: [], page: 1, limit: request.limit ?? 0, totalItems: 0, totalPages: 0 };
  }

  async deleteSession({ appName, userId, sessionId }: DeleteSessionRequest): Promise<void> {
    await this.documents.delete(this.path(appName, userId, sessionId));
  }

  override async appendEvent(request: AppendEventRequest): Promise<Event> {
    const event = await super.appendEvent(request);
    if (event.partial) return event;
    request.session.lastUpdateTime = this.now();
    await this.write(request.session);
    return event;
  }
}
