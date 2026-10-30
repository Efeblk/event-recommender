import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import type { EventRecord, SearchResult } from '../../lib/types.ts';
import { checkAgeEvidence } from '../../lib/age-evidence.ts';
import { normalize } from '../../lib/search.ts';
import { eventCard, eventFacts, type AgentEventCard } from '../cards.ts';

export const MAX_SEARCH_RESULTS = 10;
export const MAX_REQUEST_CHARS = 600;

export interface SearchEventsDeps {
  /** The stateless v1 pipeline. One complete request in, checked events out. */
  search: (request: string) => Promise<SearchResult>;
  showCards: (cards: AgentEventCard[]) => void;
}

const parameters = z.object({
  request: z
    .string()
    .trim()
    .min(1)
    .max(MAX_REQUEST_CHARS)
    .describe(
      'One complete, self-contained event request in the user\'s language. ' +
        'Include every condition from the conversation that still applies: dates, ' +
        'times, districts or side, budget, categories, exclusions, ages, group.',
    ),
});

/** The request is for children or minors (Turkish or English). */
export function childAudienceRequested(request: string) {
  return /\b(?:cocuk\w*|minik\w*|kids?|child(?:ren)?|toddlers?|minors?|teens?|teenagers?|ergen\w*|aile(?:ce|mle|yle)?|family|18 yas alti\w*|under 18)\b|\b\d{1,2}\s*(?:yas\w*|years? old|yo)\b/.test(
    normalize(request),
  );
}

/** Code guard: a request for children never returns sessions that the source limits to older people. */
const CHILD_AGE = 10;

export function searchEventsResult(result: SearchResult, request = '') {
  const forChildren = childAudienceRequested(request);
  const events: EventRecord[] = result.recommendations
    .map((recommendation) => recommendation.event)
    .filter((event) => !forChildren || checkAgeEvidence(event, CHILD_AGE).status !== 'contradicted')
    .slice(0, MAX_SEARCH_RESULTS);
  return {
    events,
    response: {
      status: result.status,
      notice: result.notice,
      clarification: result.clarification ?? [],
      totalCandidates: result.totalCandidates,
      ...(forChildren ? { ageGuard: 'removed sessions with an age limit above children' } : {}),
      events: events.map(eventFacts),
    },
  };
}

export function createSearchEventsTool(deps: SearchEventsDeps) {
  return new FunctionTool({
    name: 'search_events',
    description:
      'Search the checked Istanbul event catalog (Biletinial, Bubilet, Biletix). ' +
      'Code checks hard conditions (date, place, budget, category, exclusions, age) ' +
      'and removes duplicate sessions. Returns at most 10 events. Status ' +
      '"needs_input" means one condition is unclear: ask the user about it.',
    parameters,
    execute: async ({ request }) => {
      const { events, response } = searchEventsResult(await deps.search(request), request);
      deps.showCards(events.map(eventCard));
      return response;
    },
  });
}
