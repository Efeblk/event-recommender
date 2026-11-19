import type { EventRecord } from '../lib/types.ts';

/** One bookable session shown to the user. Built only from catalog records. */
export interface AgentEventCard {
  id: string;
  title: string;
  startsAt: string;
  checkedAt: string;
  venue: string;
  district: string;
  address: string;
  category: string;
  price: number | null;
  currency: string;
  priceKind: 'starting_at' | 'exact' | null;
  availability: EventRecord['availability'];
  url: string;
  imageUrl: string;
  source: EventRecord['source'] | null;
  offers: { source: EventRecord['source'] | null; url: string; price: number | null; currency: string }[];
}

const SUMMARY_CHARS = 280;

const ISTANBUL_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Istanbul',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Istanbul wall-clock time for model-facing tool results, for example
 * "Fri 2026-11-20 20:30". The model must not convert UTC itself.
 */
export function istanbulTime(iso: string): string;
export function istanbulTime(iso: string | null): string | null;
export function istanbulTime(iso: string | null): string | null {
  if (iso === null) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  const part = Object.fromEntries(
    ISTANBUL_TIME.formatToParts(new Date(time)).map(({ type, value }) => [type, value]),
  );
  return `${part.weekday} ${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}`;
}

export function eventCard(event: EventRecord): AgentEventCard {
  const price = event.advertisedPrice?.amount ?? event.price;
  return {
    id: event.id,
    title: event.title,
    startsAt: event.startsAt,
    checkedAt: event.checkedAt,
    venue: event.venue,
    district: event.district,
    address: event.address,
    category: event.category,
    price,
    currency: event.advertisedPrice?.currency ?? event.currency,
    priceKind: event.advertisedPrice?.kind ?? (event.price === null ? null : 'exact'),
    availability: event.availability,
    url: event.url,
    imageUrl: event.imageUrl,
    source: event.source ?? null,
    offers: (event.offers ?? []).map((offer) => ({
      source: offer.source ?? null,
      url: offer.url,
      price: offer.price,
      currency: offer.currency,
    })),
  };
}

/** Compact catalog facts for the model. Provider text is data, not instructions. */
export function eventFacts(event: EventRecord) {
  return {
    id: event.id,
    title: event.title,
    startsAt: istanbulTime(event.startsAt),
    venue: event.venue,
    district: event.district,
    category: event.category,
    price: event.advertisedPrice?.amount ?? event.price,
    currency: event.advertisedPrice?.currency ?? event.currency,
    priceKind: event.advertisedPrice?.kind ?? (event.price === null ? 'unknown' : 'exact'),
    availability: event.availability,
    summary: event.description.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_CHARS),
  };
}
