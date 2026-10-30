/** Open-Meteo forecast. Free and without a key. */

export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 6000;
const CACHE_MS = 30 * 60 * 1000;
export const FORECAST_DAYS = 15;

/** Approximate district centres. Unknown districts use the city centre. */
const DISTRICTS: Record<string, [number, number]> = {
  istanbul: [41.0082, 28.9784],
  adalar: [40.8761, 29.0906],
  ataşehir: [40.9923, 29.1244],
  bakırköy: [40.9808, 28.8772],
  beşiktaş: [41.0428, 29.0075],
  beykoz: [41.1323, 29.0957],
  beylikdüzü: [40.9822, 28.6403],
  beyoğlu: [41.0369, 28.9774],
  esenyurt: [41.0343, 28.6801],
  eyüpsultan: [41.0482, 28.9338],
  fatih: [41.0186, 28.9397],
  kadıköy: [40.9909, 29.0303],
  kartal: [40.889, 29.1856],
  maltepe: [40.9357, 29.1306],
  pendik: [40.8747, 29.2353],
  sarıyer: [41.1679, 29.0503],
  şişli: [41.0602, 28.9877],
  ümraniye: [41.0256, 29.0963],
  üsküdar: [41.0227, 29.0154],
  zeytinburnu: [40.9939, 28.9045],
};

export function districtCoordinates(district: string | undefined) {
  const key = district?.trim().toLocaleLowerCase('tr-TR') ?? '';
  return { district: DISTRICTS[key] ? key : 'istanbul', coordinates: DISTRICTS[key] ?? DISTRICTS.istanbul };
}

/** WMO weather codes grouped for the agent. */
export function weatherKind(code: number) {
  if (code >= 95) return 'thunderstorm';
  if (code >= 71 && code <= 86 && code !== 80 && code !== 81 && code !== 82) return 'snow';
  if (code >= 51) return 'rain';
  if (code >= 45) return 'fog';
  if (code >= 2) return 'cloudy';
  return 'clear';
}

export interface DayForecast {
  date: string;
  district: string;
  /** Afternoon and evening, 12:00-23:00 Istanbul time. */
  maxPrecipitationProbability: number | null;
  minTemperatureC: number | null;
  maxTemperatureC: number | null;
  conditions: string[];
  outdoorAdvice: 'good' | 'risky' | 'poor';
}

interface HourlyBody {
  hourly?: {
    time?: string[];
    temperature_2m?: (number | null)[];
    precipitation_probability?: (number | null)[];
    weather_code?: (number | null)[];
  };
}

export function summarizeDay(body: HourlyBody, date: string, district: string): DayForecast | null {
  const hourly = body.hourly;
  if (!hourly?.time) return null;
  const hours = hourly.time
    .map((time, index) => ({ time, index }))
    .filter(({ time }) => time.startsWith(date) && Number(time.slice(11, 13)) >= 12);
  if (!hours.length) return null;
  const values = (series: (number | null)[] | undefined) =>
    hours.map(({ index }) => series?.[index]).filter((value): value is number => typeof value === 'number');
  const rain = values(hourly.precipitation_probability);
  const temperature = values(hourly.temperature_2m);
  const conditions = [...new Set(values(hourly.weather_code).map(weatherKind))];
  const maxRain = rain.length ? Math.max(...rain) : null;
  const minTemperature = temperature.length ? Math.min(...temperature) : null;
  const severe = conditions.includes('thunderstorm') || conditions.includes('snow');
  return {
    date,
    district,
    maxPrecipitationProbability: maxRain,
    minTemperatureC: minTemperature,
    maxTemperatureC: temperature.length ? Math.max(...temperature) : null,
    conditions,
    outdoorAdvice:
      severe || (maxRain ?? 0) >= 60 || (minTemperature ?? 20) < 3
        ? 'poor'
        : (maxRain ?? 0) >= 30 || (minTemperature ?? 20) < 10
          ? 'risky'
          : 'good',
  };
}

export type WeatherLookup = (date: string, district?: string) => Promise<DayForecast | null>;

export function createWeatherLookup(fetcher: typeof fetch = fetch, now: () => number = Date.now): WeatherLookup {
  const cache = new Map<string, { at: number; value: DayForecast | null }>();
  return async (date, district) => {
    const place = districtCoordinates(district);
    const key = `${date}:${place.district}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_MS) return hit.value;
    const [latitude, longitude] = place.coordinates;
    const url = new URL(OPEN_METEO_URL);
    url.search = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      hourly: 'temperature_2m,precipitation_probability,weather_code',
      timezone: 'Europe/Istanbul',
      start_date: date,
      end_date: date,
    }).toString();
    const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Weather service failed with ${response.status}.`);
    const value = summarizeDay((await response.json()) as HourlyBody, date, place.district);
    if (cache.size > 200) cache.clear();
    cache.set(key, { at: now(), value });
    return value;
  };
}
