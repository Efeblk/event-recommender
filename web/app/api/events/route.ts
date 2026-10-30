import { jevConfigFrom } from '@/lib/jev';
import { voyageConfigFrom } from '@/lib/voyage';
import { candidates, catalogStatus, runtime } from '@/lib/store';
import { emptyFilters } from '@/lib/types';
import { uniqueEvents } from '@/lib/search';
import { publicEventRecord } from '@/lib/catalog';
export async function GET() {
  try {
    const [events, catalog] = await Promise.all([
      candidates(emptyFilters),
      catalogStatus(),
    ]);
    const cards = uniqueEvents(events, 12);
    return Response.json(
      {
        events: cards.map(publicEventRecord),
        total: events.length,
        aiEnabled: Boolean(
          jevConfigFrom(runtime()) || voyageConfigFrom(runtime()),
        ),
        catalog,
        checkedAt:
          events.reduce(
            (last, e) => (e.checkedAt > last ? e.checkedAt : last),
            '',
          ) || null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { error: 'Etkinlikler şu anda yüklenemiyor.' },
      { status: 503 },
    );
  }
}
