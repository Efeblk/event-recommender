import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import type { EventRecord } from '../../lib/types.ts';
import {
  MAX_PLAN_ITEMS,
  UserStoreLimitError,
  type SavedItem,
  type SavedPlan,
  type UserStore,
} from '../../lib/user-store.ts';
import { buildTimeline } from '../planner.ts';
import type { LegCache } from './planning.ts';

export interface SavedToolsDeps {
  /** Null for visitors who are not signed in. */
  userId: string | null;
  store: () => Promise<UserStore>;
  lookup: (ids: string[]) => Promise<EventRecord[]>;
  legs: LegCache;
  now?: () => Date;
  newId?: () => string;
}

const SIGN_IN_REQUIRED = {
  status: 'sign_in_required',
  message: 'The user must sign in on the page to save plans and favorites.',
} as const;

export function savedItem(event: EventRecord): SavedItem {
  return {
    eventId: event.id,
    title: event.title,
    startsAt: event.startsAt,
    venue: event.venue,
    district: event.district,
    address: event.address,
    url: event.url,
  };
}

export function createSavedTools(deps: SavedToolsDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID().replace(/-/g, ''));

  const savePlan = new FunctionTool({
    name: 'save_plan',
    description:
      'Save a plan of 1-6 events for the signed-in user. Code checks the timeline ' +
      'again and refuses plans with overlapping events or travel that does not fit. ' +
      'Save only after the user agrees to the plan.',
    parameters: z.object({
      title: z.string().trim().min(1).max(80),
      eventIds: z.array(z.string().trim().min(1).max(200)).min(1).max(MAX_PLAN_ITEMS),
      note: z.string().trim().max(500).optional(),
    }),
    execute: async ({ title, eventIds, note }) => {
      if (!deps.userId) return SIGN_IN_REQUIRED;
      const events = await deps.lookup([...new Set(eventIds)]);
      const known = new Set(events.flatMap((event) => [event.id, ...(event.mergedIds ?? [])]));
      const missing = eventIds.filter((id) => !known.has(id));
      if (missing.length) return { status: 'unknown_event', missing };
      const legs = deps.legs.all();
      const timeline = buildTimeline(events, legs);
      const blocking = timeline.conflicts.filter((conflict) => conflict.kind !== 'different_days');
      if (blocking.length) return { status: 'conflict', conflicts: blocking };
      const ordered = timeline.items.map((item) => events.find((event) => event.id === item.eventId)!);
      const at = now().toISOString();
      const plan: SavedPlan = {
        id: newId(),
        title,
        note: note ?? '',
        items: ordered.map(savedItem),
        legs: legs
          .filter((leg) => ordered.some((e) => e.id === leg.fromEventId) && ordered.some((e) => e.id === leg.toEventId))
          .map(({ fromEventId, toEventId, mode, minutes }) => ({ fromEventId, toEventId, mode, minutes })),
        createdAt: at,
        updatedAt: at,
      };
      try {
        await (await deps.store()).savePlan(deps.userId, plan);
      } catch (error) {
        return error instanceof UserStoreLimitError ? { status: 'limit_reached' } : { status: 'unavailable' };
      }
      return { status: 'saved', planId: plan.id, title: plan.title, items: plan.items.length, conflicts: timeline.conflicts };
    },
  });

  const listPlans = new FunctionTool({
    name: 'list_plans',
    description: "List the signed-in user's saved plans (newest first).",
    parameters: z.object({}),
    execute: async () => {
      if (!deps.userId) return SIGN_IN_REQUIRED;
      try {
        const plans = await (await deps.store()).listPlans(deps.userId);
        return {
          status: 'ok',
          plans: plans.slice(0, 20).map((plan) => ({
            id: plan.id,
            title: plan.title,
            note: plan.note,
            items: plan.items.map(({ eventId, title, startsAt, venue }) => ({ eventId, title, startsAt, venue })),
          })),
        };
      } catch {
        return { status: 'unavailable' };
      }
    },
  });

  const saveFavorite = new FunctionTool({
    name: 'save_favorite',
    description: 'Save one event from earlier results to the signed-in user\'s favorites.',
    parameters: z.object({ eventId: z.string().trim().min(1).max(200) }),
    execute: async ({ eventId }) => {
      if (!deps.userId) return SIGN_IN_REQUIRED;
      const [event] = await deps.lookup([eventId]);
      if (!event) return { status: 'unknown_event', missing: [eventId] };
      try {
        await (await deps.store()).saveFavorite(deps.userId, { ...savedItem(event), savedAt: now().toISOString() });
      } catch (error) {
        return error instanceof UserStoreLimitError ? { status: 'limit_reached' } : { status: 'unavailable' };
      }
      return { status: 'saved', eventId: event.id, title: event.title };
    },
  });

  return [savePlan, listPlans, saveFavorite];
}
