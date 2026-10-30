import type { AuthUser } from './auth.ts';
import type { UserStore } from './user-store.ts';
import { UserStoreLimitError } from './user-store.ts';
import { requestUser, userStore } from './user-data.node.ts';

const noStore = { 'Cache-Control': 'no-store' };

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

/** Runs a handler for the signed-in user. Store failures never leak details. */
export async function forUser(
  request: Request,
  handler: (user: AuthUser, store: UserStore) => Promise<Response>,
) {
  try {
    const user = await requestUser(request);
    if (!user) return json({ error: 'Sign in first.', code: 'unauthorized' }, 401);
    return await handler(user, await userStore());
  } catch (error) {
    if (error instanceof UserStoreLimitError)
      return json({ error: 'Limit reached.', code: 'limit_reached' }, 409);
    return json({ error: 'Saved data is not available.', code: 'unavailable' }, 503);
  }
}

export function queryId(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  return id && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
}
