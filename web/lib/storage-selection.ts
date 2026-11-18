export type CatalogStorageMode = 'gcp' | 'bundled';

export function catalogStorageMode(
  env: Readonly<Record<string, string | undefined>>,
): CatalogStorageMode {
  const configured = env.EVENT_REC_CATALOG?.trim();
  if (!configured || configured === 'gcp') return 'gcp';
  if (configured === 'bundled') return 'bundled';
  throw new Error('EVENT_REC_CATALOG must be gcp or bundled.');
}
