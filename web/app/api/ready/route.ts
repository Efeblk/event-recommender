import { checkpointReadiness } from '@/lib/operations';
import {
  currentPublished,
  checkpointExists,
  collectionStateConfigured,
  bundledCatalogConfigured,
  catalogStatus,
} from '@/lib/store';

export async function GET() {
  const checkedAt = new Date().toISOString();
  const headers = { 'cache-control': 'no-store' };
  if (bundledCatalogConfigured()) {
    try {
      const catalog = await catalogStatus();
      const ready = catalog.status === 'ready' && catalog.eligible > 0;
      return Response.json(
        {
          ready,
          checkedAt,
          reasons: ready ? [] : ['catalog_not_ready'],
          catalog,
          source: 'bundled',
          checkpoint: null,
        },
        { status: ready ? 200 : 503, headers },
      );
    } catch {
      return Response.json(
        { ready: false, checkedAt, reasons: ['catalog_unavailable'] },
        { status: 503, headers },
      );
    }
  }
  if (!collectionStateConfigured())
    return Response.json(
      { ready: false, checkedAt, reasons: ['collection_state_unavailable'] },
      { status: 503, headers },
    );
  try {
    const published = await currentPublished();
    const { catalog } = published;
    const checkpoint = published.search
      ? published.search.checkpoint
      : published.checkpoint;
    const comparableCatalog = published.search
      ? { ...published.search.sourceCatalog, status: catalog.status }
      : catalog;
    const reasons = checkpointReadiness(comparableCatalog, checkpoint);
    if (checkpoint) {
      try {
        if (!(await checkpointExists(checkpoint)))
          reasons.push('checkpoint_unavailable');
      } catch {
        reasons.push('checkpoint_unavailable');
      }
    }
    return Response.json(
      {
        ready: reasons.length === 0,
        checkedAt,
        reasons,
        catalog,
        ...(published.search
          ? {
              search: {
                pending: published.search.pending,
                latestCollectedAt: published.checkpoint?.finishedAt ?? null,
                activeCollectedAt: checkpoint?.finishedAt ?? null,
              },
            }
          : {}),
        checkpoint: checkpoint
          ? {
              savedAt: checkpoint.savedAt,
              finishedAt: checkpoint.finishedAt,
              events: checkpoint.events,
              bytes: checkpoint.bytes,
              summary: checkpoint.summary,
            }
          : null,
      },
      { status: reasons.length ? 503 : 200, headers },
    );
  } catch {
    return Response.json(
      { ready: false, checkedAt, reasons: ['database_unavailable'] },
      { status: 503, headers },
    );
  }
}
