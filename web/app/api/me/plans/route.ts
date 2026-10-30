import { forUser, json, queryId } from '@/lib/me-route.node';

/** GET lists plans. GET ?id= returns one plan. */
export function GET(request: Request) {
  return forUser(request, async (user, store) => {
    if (!new URL(request.url).searchParams.has('id')) return json({ plans: await store.listPlans(user.uid) });
    const id = queryId(request);
    const plan = id ? await store.getPlan(user.uid, id) : null;
    return plan ? json({ plan }) : json({ error: 'Not found.', code: 'not_found' }, 404);
  });
}

export function DELETE(request: Request) {
  return forUser(request, async (user, store) => {
    const id = queryId(request);
    if (!id) return json({ error: 'Invalid plan.', code: 'invalid_request' }, 400);
    return (await store.deletePlan(user.uid, id))
      ? json({ deleted: id })
      : json({ error: 'Not found.', code: 'not_found' }, 404);
  });
}
