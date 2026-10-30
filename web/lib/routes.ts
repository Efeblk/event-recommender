/** Google Maps Routes API (computeRoutes). Needs GOOGLE_MAPS_API_KEY. */

export const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const TIMEOUT_MS = 8000;
const CACHE_LIMIT = 500;

export type RouteMode = 'transit' | 'drive' | 'walk';

export interface RouteResult {
  minutes: number;
  distanceKm: number;
}

export interface RoutesConfig {
  apiKey: string;
}

export function routesConfigFrom(env: Record<string, string | undefined>): RoutesConfig | null {
  const apiKey = env.GOOGLE_MAPS_API_KEY?.trim();
  return apiKey ? { apiKey } : null;
}

const TRAVEL_MODE: Record<RouteMode, string> = { transit: 'TRANSIT', drive: 'DRIVE', walk: 'WALK' };

export type RouteLookup = (
  origin: string,
  destination: string,
  mode: RouteMode,
  departureTime?: string,
) => Promise<RouteResult | null>;

/**
 * Returns a cached route client. Null results (no route) are cached too.
 * Errors propagate so the caller can report an unavailable service.
 */
export function createRouteLookup(config: RoutesConfig, fetcher: typeof fetch = fetch): RouteLookup {
  const cache = new Map<string, RouteResult | null>();
  return async (origin, destination, mode, departureTime) => {
    const departure = departureTime && Date.parse(departureTime) > Date.now() ? departureTime : undefined;
    const key = JSON.stringify([origin, destination, mode, departure?.slice(0, 13)]);
    if (cache.has(key)) return cache.get(key)!;
    const response = await fetcher(ROUTES_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': config.apiKey,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
      },
      body: JSON.stringify({
        origin: { address: origin },
        destination: { address: destination },
        travelMode: TRAVEL_MODE[mode],
        languageCode: 'tr',
        regionCode: 'TR',
        ...(departure ? { departureTime: departure } : {}),
      }),
    });
    if (!response.ok) throw new Error(`Routes API failed with ${response.status}.`);
    const body = (await response.json()) as { routes?: { duration?: string; distanceMeters?: number }[] };
    const route = body.routes?.[0];
    const seconds = Number(/^(\d+(?:\.\d+)?)s$/.exec(route?.duration ?? '')?.[1]);
    const result = Number.isFinite(seconds)
      ? { minutes: Math.max(1, Math.round(seconds / 60)), distanceKm: Math.round((route?.distanceMeters ?? 0) / 100) / 10 }
      : null;
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(key, result);
    return result;
  };
}
