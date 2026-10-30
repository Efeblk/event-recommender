import type { BaseLlm, BaseSessionService } from '@google/adk';
import type { EventRecord, SearchResult } from '../lib/types.ts';
import type { RouteLookup } from '../lib/routes.ts';
import type { WeatherLookup } from '../lib/weather.ts';
import type { UserStore } from '../lib/user-store.ts';
import { ANONYMOUS_USER, createAgent, createRunner } from './agent.ts';
import { createEventDetailsTool } from './tools/event-details.ts';
import { createSearchEventsTool } from './tools/search-events.ts';
import { createPlanningTools } from './tools/planning.ts';
import { createWeatherTool } from './tools/weather.ts';
import { createSavedTools } from './tools/saved.ts';
import { CardSink, runAgentTurn, type AgentStreamEvent, type AgentTurnInput } from './turn.ts';
import type { AgentEventCard } from './cards.ts';

export interface AgentToolDeps {
  search: (request: string) => Promise<SearchResult>;
  lookup: (ids: string[]) => Promise<EventRecord[]>;
  /** Null without a Maps key. plan_route then reports "unavailable". */
  route?: RouteLookup | null;
  weather?: WeatherLookup;
  userStore?: () => Promise<UserStore>;
}

/** All agent tools for one turn. `userId` is null for visitors who are not signed in. */
export function agentTools(
  deps: AgentToolDeps,
  showCards: (cards: AgentEventCard[]) => void,
  userId: string | null = null,
) {
  const planning = createPlanningTools({ lookup: deps.lookup, route: deps.route ?? null, showCards });
  return [
    createSearchEventsTool({ search: deps.search, showCards }),
    createEventDetailsTool({ lookup: deps.lookup, showCards }),
    ...planning.tools,
    ...(deps.weather ? [createWeatherTool({ weather: deps.weather })] : []),
    ...(deps.userStore
      ? createSavedTools({ userId, store: deps.userStore, lookup: deps.lookup, legs: planning.cache })
      : []),
  ];
}

/** Runs one turn and encodes it as newline-delimited JSON. */
export function agentTurnStream(options: {
  input: AgentTurnInput;
  /** The Firebase user ID, or null for a visitor who is not signed in. */
  userId: string | null;
  model: BaseLlm;
  sessionService: BaseSessionService;
  tools: AgentToolDeps;
  signal?: AbortSignal;
  onFinish?: () => void;
}): ReadableStream<Uint8Array> {
  const sink = new CardSink();
  const tools = agentTools(options.tools, sink.show, options.userId);
  const runner = createRunner(createAgent({ model: options.model, tools }), options.sessionService);
  const encoder = new TextEncoder();
  const line = (event: AgentStreamEvent) => encoder.encode(`${JSON.stringify(event)}\n`);
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runAgentTurn({
          runner,
          userId: options.userId ?? ANONYMOUS_USER,
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
