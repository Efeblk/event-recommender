import { catalogWritesEnabled, digest, runtime, legacySync } from '@/lib/store';
export async function POST(request: Request) {
  if (!catalogWritesEnabled())
    return Response.json(
      { error: 'Bundled catalog is read-only' },
      { status: 405 },
    );
  const token = runtime().SYNC_TOKEN;
  if (
    !token ||
    (await digest(request.headers.get('authorization') ?? '')) !==
      (await digest(`Bearer ${token}`))
  )
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return legacySync(request);
}
