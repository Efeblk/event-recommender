import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import type { EventRecord } from '../../lib/types.ts';
import { eventCard, type AgentEventCard } from '../cards.ts';

export const MAX_DETAIL_IDS = 8;
const DESCRIPTION_CHARS = 1200;

export interface EventDetailsDeps {
  lookup: (ids: string[]) => Promise<EventRecord[]>;
  showCards: (cards: AgentEventCard[]) => void;
}

export function eventDetails(event: EventRecord) {
  return {
    ...eventCard(event),
    description: event.description.replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_CHARS),
    checkedAt: event.checkedAt,
  };
}

/** Finds current catalog records by canonical or merged session ID. */
export function findEvents(catalog: EventRecord[], ids: string[]) {
  const wanted = new Set(ids);
  const found = new Map<string, EventRecord>();
  for (const event of catalog)
    if (wanted.has(event.id) || event.mergedIds?.some((id) => wanted.has(id)))
      found.set(event.id, event);
  return [...found.values()];
}

export function createEventDetailsTool(deps: EventDetailsDeps) {
  return new FunctionTool({
    name: 'get_event_details',
    description:
      'Get current details (sessions, venue, address, prices, provider links, ' +
      'description) for event IDs from earlier tool results. Unknown or past ' +
      'IDs are listed in "missing".',
    parameters: z.object({
      ids: z.array(z.string().trim().min(1).max(200)).min(1).max(MAX_DETAIL_IDS),
    }),
    execute: async ({ ids }) => {
      const events = await deps.lookup([...new Set(ids)]);
      const known = new Set(events.flatMap((event) => [event.id, ...(event.mergedIds ?? [])]));
      deps.showCards(events.map(eventCard));
      return {
        events: events.map(eventDetails),
        missing: ids.filter((id) => !known.has(id)),
      };
    },
  });
}
