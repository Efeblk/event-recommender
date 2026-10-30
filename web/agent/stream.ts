import type { BaseLlm, BaseSessionService, BaseTool } from '@google/adk';
import type { EventRecord, SearchResult } from '../lib/types.ts';
import { createAgent, createRunner } from './agent.ts';
import { createEventDetailsTool } from './tools/event-details.ts';
import { createSearchEventsTool } from './tools/search-events.ts';
import { CardSink, runAgentTurn, type AgentStreamEvent, type AgentTurnInput } from './turn.ts';
import type { AgentEventCard } from './cards.ts';

export interface AgentToolDeps {
  search: (request: string) => Promise<SearchResult>;
  lookup: (ids: string[]) => Promise<EventRecord[]>;
}

/** Extra tools receive the card sink and the signed-in user. */
export type ExtraTools = (context: {
  userId: string;
  showCards: (cards: AgentEventCard[]) => void;
}) => BaseTool[];

export function agentTools(deps: AgentToolDeps, showCards: (cards: AgentEventCard[]) => void) {
  return [
    createSearchEventsTool({ search: deps.search, showCards }),
    createEventDetailsTool({ lookup: deps.lookup, showCards }),
  ];
}

/** Runs one turn and encodes it as newline-delimited JSON. */
export function agentTurnStream(options: {
  input: AgentTurnInput;
  userId: string;
  model: BaseLlm;
  sessionService: BaseSessionService;
  tools: AgentToolDeps;
  extraTools?: ExtraTools;
  signal?: AbortSignal;
  onFinish?: () => void;
}): ReadableStream<Uint8Array> {
  const sink = new CardSink();
  const tools = [
    ...agentTools(options.tools, sink.show),
    ...(options.extraTools?.({ userId: options.userId, showCards: sink.show }) ?? []),
  ];
  const runner = createRunner(createAgent({ model: options.model, tools }), options.sessionService);
  const encoder = new TextEncoder();
  const line = (event: AgentStreamEvent) => encoder.encode(`${JSON.stringify(event)}\n`);
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runAgentTurn({
          runner,
          userId: options.userId,
          input: options.input,
          sink,
          signal: options.signal,
        }))
          controller.enqueue(line(event));
      } catch {
        controller.enqueue(
          line({
            type: 'error',
            code: options.signal?.aborted ? 'timeout' : 'agent_failed',
            message: 'The assistant could not finish this answer.',
          }),
        );
        controller.enqueue(line({ type: 'done' }));
      } finally {
        options.onFinish?.();
        controller.close();
      }
    },
  });
}
