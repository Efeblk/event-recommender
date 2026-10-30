import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { FORECAST_DAYS, type WeatherLookup } from '../../lib/weather.ts';

const istanbulDate = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(at);

export function createWeatherTool(deps: { weather: WeatherLookup; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  return new FunctionTool({
    name: 'get_weather',
    description:
      'Afternoon and evening forecast (12:00-23:00) for one Istanbul date and ' +
      `district, up to ${FORECAST_DAYS - 1} days ahead. Use it for outdoor events. ` +
      'outdoorAdvice "risky" or "poor" means: suggest indoor options too.',
    parameters: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD in Istanbul time'),
      district: z.string().trim().max(60).optional(),
    }),
    execute: async ({ date, district }) => {
      const today = istanbulDate(now());
      const days = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
      if (!Number.isFinite(days) || days < 0 || days >= FORECAST_DAYS)
        return { status: 'out_of_range', today, maxDaysAhead: FORECAST_DAYS - 1 };
      try {
        const forecast = await deps.weather(date, district);
        return forecast ? { status: 'ok', ...forecast } : { status: 'unavailable' };
      } catch {
        return { status: 'unavailable' };
      }
    },
  });
}
