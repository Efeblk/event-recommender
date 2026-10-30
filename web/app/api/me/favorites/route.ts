import { forUser, json, queryId } from '@/lib/me-route.node';
import { candidates } from '@/lib/store';
import { emptyFilters } from '@/lib/types';
import { findEvents } from '@/agent/tools/event-details';
import { savedItem } from '@/agent/tools/saved';
import { readBoundedRequestText } from '@/lib/request-body';

export function GET(request: Request) {
  return forUser(request, async (user, store) => json({ favorites: await store.listFavorites(user.uid) }));
}

/** POST { eventId } saves a current catalog event. */
export function POST(request: Request) {
  return forUser(request, async (user, store) => {
    let eventId: unknown;
    try {
      eventId = (JSON.parse(await readBoundedRequestText(request, 2_000)) as { eventId?: unknown }).eventId;
    } catch {
      return json({ error: 'Invalid request.', code: 'invalid_request' }, 400);
    }
    if (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(eventId))
      return json({ error: 'Invalid event.', code: 'invalid_request' }, 400);
    const [event] = findEvents(await candidates(emptyFilters), [eventId]);
    if (!event) return json({ error: 'Event not found.', code: 'not_found' }, 404);
    const favorite = await store.saveFavorite(user.uid, { ...savedItem(event), savedAt: new Date().toISOString() });
    return json({ favorite }, 201);
  });
}

export function DELETE(request: Request) {
  return forUser(request, async (user, store) => {
    const id = queryId(request);
    if (!id) return json({ error: 'Invalid event.', code: 'invalid_request' }, 400);
    return (await store.deleteFavorite(user.uid, id))
      ? json({ deleted: id })
      : json({ error: 'Not found.', code: 'not_found' }, 404);
  });
}
