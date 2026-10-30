export interface AgentModelConfig {
  model: string;
  apiKey?: string;
  vertexai: boolean;
  project?: string;
  location?: string;
}

export const DEFAULT_AGENT_MODEL = 'gemini-2.5-flash';

type AgentEnv = Record<string, string | undefined>;

const enabled = (value: string | undefined) =>
  ['1', 'true', 'yes'].includes(value?.trim().toLowerCase() ?? '');

/**
 * Gemini runs through Vertex AI (Application Default Credentials) or a Gemini
 * API key. Without either, the agent is unavailable and the route says so.
 */
export function agentModelConfigFrom(env: AgentEnv): AgentModelConfig | null {
  const model = env.BIPLAN_AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL;
  if (!/^[a-z0-9][a-z0-9.-]{1,80}$/.test(model))
    throw new Error('Invalid agent model configuration.');
  if (enabled(env.GOOGLE_GENAI_USE_VERTEXAI)) {
    const project = env.GOOGLE_CLOUD_PROJECT?.trim();
    const location = env.GOOGLE_CLOUD_LOCATION?.trim() || 'us-central1';
    return project ? { model, vertexai: true, project, location } : null;
  }
  const apiKey = (env.GEMINI_API_KEY || env.GOOGLE_API_KEY)?.trim();
  return apiKey ? { model, apiKey, vertexai: false } : null;
}
