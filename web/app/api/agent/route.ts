import {
  aiDailyRateLimit,
  candidates,
  catalogStatus,
  consumeLimit,
  requestRateLimit,
  runtime,
  type RateLimitResult,
} from '@/lib/store';
import { recommendRequest } from '@/lib/recommend';
import { searchDependencies } from '@/lib/search-deps';
import { catalogAllowsRecommendations } from '@/lib/catalog-readiness';
import { consumeBuckets, userLimitBuckets, visitorRateLimitEnabled } from '@/lib/rate-limit';
import { publicEventRecord } from '@/lib/catalog';
import { emptyFilters } from '@/lib/types';
import {
  readBoundedRequestText,
  RequestBodyTooLargeError,
} from '@/lib/request-body';
import { DeadlineExceededError, withDeadline } from '@/lib/deadline';
import { agentModelConfigFrom } from '@/agent/config';
import { geminiModel } from '@/agent/agent';
import { agentTurnStream } from '@/agent/stream';
import { validateAgentTurn } from '@/agent/turn';
import { findEvents } from '@/agent/tools/event-details';
import { bearerToken } from '@/lib/auth';
import { agentSessionService, requestUser, userStore } from '@/lib/user-data.node';
import { createRouteLookup, routesConfigFrom, type RouteLookup } from '@/lib/routes';
import { createWeatherLookup } from '@/lib/weather';

const MAX_REQUEST_BYTES = 8_000;
const REQUEST_BODY_TIMEOUT_MS = 5_000;
const TURN_BUDGET_MS = 60_000;

const weather = createWeatherLookup();
let routes: { key: string; lookup: RouteLookup } | undefined;
function routeLookup() {
  const config = routesConfigFrom(runtime());
  if (!config) return null;
  if (routes?.key !== config.apiKey) routes = { key: config.apiKey, lookup: createRouteLookup(config) };
  return routes.lookup;
}

const noStore = { 'Cache-Control': 'no-store' };
const failure = (status: number, code: string, error: string, headers = {}) =>
  Response.json({ error, code }, { status, headers: { ...noStore, ...headers } });

function limited(result: RateLimitResult) {
  return failure(429, 'rate_limited', 'Too many requests. Try again later.', {
    'Retry-After': String(result.retryAfter),
  });
}

export async function POST(request: Request) {
  let input;
  try {
    const raw = await withDeadline(
      REQUEST_BODY_TIMEOUT_MS,
      'Agent request body timed out.',
      (signal) => readBoundedRequestText(request, MAX_REQUEST_BYTES, signal),
      request.signal,
    );
    input = validateAgentTurn(JSON.parse(raw));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return failure(413, 'too_large', 'Message is too long.');
    if (error instanceof DeadlineExceededError)
      return failure(408, 'timeout', 'Message was not received in time.');
    return failure(400, 'invalid_request', 'Message or session is not valid.');
  }
  try {
    const config = agentModelConfigFrom(runtime());
    if (!config)
      return failure(503, 'agent_unavailable', 'The assistant is not configured.');
    const user = await requestUser(request);
    if (bearerToken(request) && !user)
      return failure(401, 'invalid_token', 'Sign-in expired. Sign in again.');
    if (visitorRateLimitEnabled(runtime())) {
      const requestLimit = await requestRateLimit(request, true);
      if (!requestLimit.allowed) return limited(requestLimit);
      if (user) {
        const userLimit = await consumeBuckets(userLimitBuckets(user.uid, Date.now()), Date.now(), consumeLimit);
        if (!userLimit.allowed) return limited(userLimit);
      }
    }
    const now = new Date();
    const catalog = await catalogStatus(now);
    if (!catalogAllowsRecommendations(catalog.status))
      return failure(503, 'catalog_unavailable', 'The event catalog is not ready.', {
        'Retry-After': '300',
      });
    const dailyLimit = await aiDailyRateLimit();
    if (!dailyLimit.allowed) return limited(dailyLimit);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TURN_BUDGET_MS);
    const signal = AbortSignal.any([controller.signal, request.signal]);
    const body = agentTurnStream({
      input,
      userId: user?.uid ?? null,
      model: geminiModel(config),
      sessionService: await agentSessionService(),
      signal,
      onFinish: () => clearTimeout(timer),
      tools: {
        search: (message) =>
          recommendRequest({ message }, searchDependencies({ now: new Date(), signal })),
        lookup: async (ids) =>
          findEvents(await candidates(emptyFilters), ids).map(publicEventRecord),
        route: routeLookup(),
        weather,
        userStore,
      },
    });
    return new Response(body, {
      headers: {
        ...noStore,
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return failure(503, 'agent_failed', 'The assistant is not available.');
  }
}
