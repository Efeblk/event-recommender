import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import type { EventRecord } from '../../lib/types.ts';
import type { RouteLookup } from '../../lib/routes.ts';
import { eventCard, type AgentEventCard } from '../cards.ts';
import { buildTimeline, venueAddress, type Leg, type TravelMode } from '../planner.ts';

export const MAX_ROUTE_CALLS_PER_TURN = 6;
export const MAX_OUTING_EVENTS = 4;

export interface PlanningDeps {
  lookup: (ids: string[]) => Promise<EventRecord[]>;
  /** Null when no Maps key is configured. */
  route: RouteLookup | null;
  showCards: (cards: AgentEventCard[]) => void;
}

const mode = z.enum(['transit', 'drive', 'walk']).default('transit');

/** Legs found in this turn. save_plan reuses them without new paid calls. */
export class LegCache {
  private readonly legs = new Map<string, Leg>();
  private calls = 0;
  key(from: string, to: string, travelMode: TravelMode) {
    return `${from}>${to}>${travelMode}`;
  }
  get(from: string, to: string, travelMode: TravelMode) {
    return this.legs.get(this.key(from, to, travelMode));
  }
  set(leg: Leg) {
    this.legs.set(this.key(leg.fromEventId, leg.toEventId, leg.mode), leg);
  }
  all() {
    return [...this.legs.values()];
  }
  takeCall() {
    if (this.calls >= MAX_ROUTE_CALLS_PER_TURN) return false;
    this.calls++;
    return true;
  }
}

async function findLeg(
  deps: PlanningDeps,
  cache: LegCache,
  from: EventRecord,
  to: EventRecord,
  travelMode: TravelMode,
): Promise<{ leg: Leg; status: 'ok' | 'no_route' | 'unavailable' | 'limit' }> {
  const known = cache.get(from.id, to.id, travelMode);
  if (known) return { leg: known, status: known.minutes === null ? 'no_route' : 'ok' };
  const empty: Leg = { fromEventId: from.id, toEventId: to.id, mode: travelMode, minutes: null, distanceKm: null };
  if (!deps.route) return { leg: empty, status: 'unavailable' };
  if (!cache.takeCall()) return { leg: empty, status: 'limit' };
  try {
    const result = await deps.route(venueAddress(from), venueAddress(to), travelMode, from.startsAt);
    const leg = result ? { ...empty, minutes: result.minutes, distanceKm: result.distanceKm } : empty;
    cache.set(leg);
    return { leg, status: result ? 'ok' : 'no_route' };
  } catch {
    return { leg: empty, status: 'unavailable' };
  }
}

export function createPlanningTools(deps: PlanningDeps, cache = new LegCache()) {
  const planRoute = new FunctionTool({
    name: 'plan_route',
    description:
      'Travel time and distance between the venues of two events (Google Maps). ' +
      'Modes: transit (default), drive, walk. Status "unavailable" means no ' +
      'route service; do not guess a travel time.',
    parameters: z.object({
      fromEventId: z.string().trim().min(1).max(200),
      toEventId: z.string().trim().min(1).max(200),
      mode,
    }),
    execute: async ({ fromEventId, toEventId, mode: travelMode }) => {
      const events = await deps.lookup([fromEventId, toEventId]);
      const byId = (id: string) => events.find((event) => event.id === id || event.mergedIds?.includes(id));
      const from = byId(fromEventId);
      const to = byId(toEventId);
      if (!from || !to) return { status: 'unknown_event', missing: [fromEventId, toEventId].filter((id) => !byId(id)) };
      const { leg, status } = await findLeg(deps, cache, from, to, travelMode);
      return { status, from: from.venue, to: to.venue, ...leg };
    },
  });

  const planOuting = new FunctionTool({
    name: 'plan_outing',
    description:
      'Check an outing of 2-4 events from earlier results. Orders them by time, ' +
      'estimates event lengths, adds travel between venues and lists conflicts ' +
      '(overlap, not enough travel time, different days). Use it before you ' +
      'propose or save a plan with more than one event.',
    parameters: z.object({
      eventIds: z.array(z.string().trim().min(1).max(200)).min(2).max(MAX_OUTING_EVENTS),
      mode,
    }),
    execute: async ({ eventIds, mode: travelMode }) => {
      const events = await deps.lookup([...new Set(eventIds)]);
      const known = new Set(events.flatMap((event) => [event.id, ...(event.mergedIds ?? [])]));
      const missing = eventIds.filter((id) => !known.has(id));
      if (events.length < 2) return { status: 'unknown_event', missing };
      const ordered = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      const legs: Leg[] = [];
      const routeStatus: string[] = [];
      for (let i = 1; i < ordered.length; i++) {
        const { leg, status } = await findLeg(deps, cache, ordered[i - 1], ordered[i], travelMode);
        legs.push(leg);
        routeStatus.push(status);
      }
      deps.showCards(ordered.map(eventCard));
      return {
        status: 'ok',
        missing,
        ...buildTimeline(ordered, legs),
        legs,
        routeStatus: [...new Set(routeStatus)],
      };
    },
  });
  return { tools: [planRoute, planOuting], cache };
}
