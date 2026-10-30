import {
  createRunConfig,
  getFunctionCalls,
  getFunctionResponses,
  type Runner,
} from '@google/adk';
import type { AgentEventCard } from './cards.ts';

export const MAX_MESSAGE_CHARS = 1000;
export const MAX_LLM_CALLS_PER_TURN = 8;

export type AgentStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'cards'; tool: string; cards: AgentEventCard[] }
  | { type: 'error'; code: string; message: string }
  | { type: 'done' };

const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;

export interface AgentTurnInput {
  sessionId: string;
  message: string;
}

/** Validates the client body. Unknown fields are ignored. */
export function validateAgentTurn(value: unknown): AgentTurnInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid request.');
  const { sessionId, message } = value as Record<string, unknown>;
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId))
    throw new Error('Invalid session.');
  if (typeof message !== 'string') throw new Error('Invalid message.');
  const text = message.split('\u0000').join('').trim();
  if (!text || text.length > MAX_MESSAGE_CHARS) throw new Error('Invalid message.');
  return { sessionId, message: text };
}

/** Collects cards that tools show during one turn. */
export class CardSink {
  private pending: AgentEventCard[] = [];
  show = (cards: AgentEventCard[]) => {
    this.pending.push(...cards);
  };
  drain() {
    const cards = this.pending;
    this.pending = [];
    return cards;
  }
}

/**
 * Runs one user turn. Text comes from the model. Cards come only from the
 * card sink that tools fill, never from model text.
 */
export async function* runAgentTurn(options: {
  runner: Runner;
  userId: string;
  input: AgentTurnInput;
  sink: CardSink;
  signal?: AbortSignal;
}): AsyncGenerator<AgentStreamEvent> {
  const { runner, userId, input, sink } = options;
  await runner.sessionService.getOrCreateSession({
    appName: runner.appName,
    userId,
    sessionId: input.sessionId,
  });
  for await (const event of runner.runAsync({
    userId,
    sessionId: input.sessionId,
    newMessage: { role: 'user', parts: [{ text: input.message }] },
    runConfig: createRunConfig({ maxLlmCalls: MAX_LLM_CALLS_PER_TURN }),
    abortSignal: options.signal,
  })) {
    if (event.errorCode || event.errorMessage) {
      yield { type: 'error', code: 'model_error', message: 'The assistant could not answer.' };
      continue;
    }
    for (const call of getFunctionCalls(event))
      if (call.name) yield { type: 'tool', name: call.name };
    for (const response of getFunctionResponses(event)) {
      const cards = sink.drain();
      if (cards.length) yield { type: 'cards', tool: response.name ?? 'tool', cards };
    }
    if (event.partial || event.author === 'user') continue;
    const text = (event.content?.parts ?? [])
      .filter((part) => typeof part.text === 'string' && !part.thought)
      .map((part) => part.text)
      .join('')
      .trim();
    if (text) yield { type: 'text', text };
  }
  yield { type: 'done' };
}
