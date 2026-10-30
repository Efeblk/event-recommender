import {
  BaseLlm,
  Gemini,
  InMemorySessionService,
  LlmAgent,
  Runner,
  type BaseSessionService,
  type BaseTool,
} from '@google/adk';
import type { AgentModelConfig } from './config.ts';
import { agentInstruction } from './instruction.ts';

export const AGENT_APP_NAME = 'biplan';

export function geminiModel(config: AgentModelConfig): BaseLlm {
  return new Gemini(
    config.vertexai
      ? { model: config.model, vertexai: true, project: config.project, location: config.location }
      : { model: config.model, apiKey: config.apiKey },
  );
}

export function createAgent(options: { model: BaseLlm; tools: BaseTool[]; now?: () => Date }) {
  const now = options.now ?? (() => new Date());
  return new LlmAgent({
    name: 'biplan_planner',
    description: 'Plans Istanbul outings from checked, bookable events.',
    model: options.model,
    instruction: () => agentInstruction(now()),
    tools: options.tools,
  });
}

export function createRunner(agent: LlmAgent, sessionService: BaseSessionService) {
  return new Runner({ appName: AGENT_APP_NAME, agent, sessionService });
}

/**
 * Process-local sessions for development and Sprint 1. The oldest sessions are
 * removed above the limit. Firestore sessions replace this in Sprint 2.
 */
export class BoundedSessionService extends InMemorySessionService {
  private readonly order: { appName: string; userId: string; sessionId: string }[] = [];
  private readonly limit: number;
  constructor(limit = 500) {
    super();
    this.limit = limit;
  }
  override async createSession(request: Parameters<InMemorySessionService['createSession']>[0]) {
    const session = await super.createSession(request);
    this.order.push({ appName: session.appName, userId: session.userId, sessionId: session.id });
    while (this.order.length > this.limit) await super.deleteSession(this.order.shift()!);
    return session;
  }
}
