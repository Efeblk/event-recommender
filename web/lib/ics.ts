import type { SavedPlan } from './user-store.ts';

/** Estimated length used when a calendar entry needs an end time. */
const DEFAULT_MINUTES = 120;

const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** RFC 5545 text escaping. */
const text = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** RFC 5545 line folding at 75 octets. */
function fold(line: string) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  for (const char of line) {
    const limit = parts.length ? 74 : 75;
    if (new TextEncoder().encode(current + char).length > limit) {
      parts.push(current);
      current = char;
    } else current += char;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** One VEVENT per plan item. Times are UTC. */
export function planToIcs(plan: SavedPlan, now = new Date()) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    "PRODID:-//Bi' Plan//Outing planner//TR",
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${text(plan.title)}`,
  ];
  for (const item of plan.items) {
    const start = new Date(item.startsAt);
    const end = new Date(start.getTime() + DEFAULT_MINUTES * 60_000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${plan.id}-${item.eventId}@biplan`,
      `DTSTAMP:${stamp(now.toISOString())}`,
      `DTSTART:${stamp(start.toISOString())}`,
      `DTEND:${stamp(end.toISOString())}`,
      `SUMMARY:${text(item.title)}`,
      `LOCATION:${text([item.venue, item.address || item.district].filter(Boolean).join(', '))}`,
      `DESCRIPTION:${text([plan.note, `Bilet: ${item.url}`].filter(Boolean).join('\n'))}`,
      `URL:${item.url}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function icsFileName(plan: Pick<SavedPlan, 'title'>) {
  const base = plan.title
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${base || 'plan'}.ics`;
}
