import type { EventRecord } from '../lib/types.ts';

export type TravelMode = 'transit' | 'drive' | 'walk';

/** Estimated event length in minutes when the provider gives no end time. */
const DURATION_MINUTES: Record<string, number> = {
  Konser: 150,
  Tiyatro: 150,
  'Stand-up': 120,
  Workshop: 150,
  Sergi: 90,
  Müze: 90,
  Festival: 240,
  Spor: 150,
  Sinema: 150,
  Söyleşi: 120,
  Dans: 120,
  Gösteri: 120,
  Eğitim: 150,
  Gezi: 180,
};
const DEFAULT_DURATION = 120;
/** Time to leave one venue and get in to the next, besides travel. */
export const BUFFER_MINUTES = 15;

export interface Leg {
  fromEventId: string;
  toEventId: string;
  mode: TravelMode;
  minutes: number | null;
  distanceKm: number | null;
}

export interface TimelineItem {
  eventId: string;
  title: string;
  startsAt: string;
  estimatedEndsAt: string | null;
  /** True for admission windows (museums, exhibitions): any time in the window. */
  flexible: boolean;
  venue: string;
  district: string;
}

export interface PlanConflict {
  kind: 'overlap' | 'travel' | 'different_days';
  fromEventId: string;
  toEventId: string;
  message: string;
}

export function estimatedMinutes(event: Pick<EventRecord, 'category'>) {
  return DURATION_MINUTES[event.category] ?? DEFAULT_DURATION;
}

const istanbulDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(iso));

const flexible = (event: EventRecord) => event.attendanceTiming?.kind === 'admission_window';

/**
 * Orders events by start time and checks that each one can follow the
 * previous one. Code decides conflicts. The model only explains them.
 */
export function buildTimeline(events: EventRecord[], legs: Leg[] = []) {
  const ordered = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const items: TimelineItem[] = ordered.map((event) => ({
    eventId: event.id,
    title: event.title,
    startsAt: event.startsAt,
    estimatedEndsAt: flexible(event)
      ? null
      : new Date(Date.parse(event.startsAt) + estimatedMinutes(event) * 60_000).toISOString(),
    flexible: flexible(event),
    venue: event.venue,
    district: event.district,
  }));
  const conflicts: PlanConflict[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1];
    const next = ordered[i];
    const pair = { fromEventId: previous.id, toEventId: next.id };
    if (istanbulDay(previous.startsAt) !== istanbulDay(next.startsAt))
      conflicts.push({ ...pair, kind: 'different_days', message: `${previous.title} and ${next.title} are on different days.` });
    if (flexible(previous) || flexible(next)) continue;
    const end = Date.parse(items[i - 1].estimatedEndsAt!);
    const start = Date.parse(next.startsAt);
    if (start < end) {
      conflicts.push({
        ...pair,
        kind: 'overlap',
        message: `${next.title} starts before ${previous.title} is expected to end.`,
      });
      continue;
    }
    const leg = legs.find((item) => item.fromEventId === previous.id && item.toEventId === next.id);
    if (leg?.minutes != null && end + (leg.minutes + BUFFER_MINUTES) * 60_000 > start)
      conflicts.push({
        ...pair,
        kind: 'travel',
        message: `About ${leg.minutes} min of travel does not fit between ${previous.title} and ${next.title}.`,
      });
  }
  return { items, conflicts, estimatedDurations: true as const };
}

/** The address that the routes API receives for a venue. */
export function venueAddress(event: Pick<EventRecord, 'venue' | 'address' | 'district' | 'city'>) {
  const parts = [event.venue, event.address || event.district, event.city || 'İstanbul'];
  return [...new Set(parts.map((part) => part?.trim()).filter(Boolean))].join(', ');
}
