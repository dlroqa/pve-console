/**
 * Optional AI administration layer types (spec §12).
 *
 * The AI layer is ADVISORY ONLY. It summarizes health/logs, explains errors,
 * identifies resource pressure and suggests safe optimizations. It MUST NOT
 * automatically execute destructive infrastructure actions (spec §12). Any
 * action a recommendation implies is performed by the user through the normal
 * confirmed VM/LXC controls — never by this layer.
 *
 * Two providers are supported: Anthropic (Claude) and any OpenAI-compatible
 * chat-completions endpoint (OpenAI, local models, gateways) via a configurable
 * base URL.
 */

export type AiProvider = "anthropic" | "openai";

export type AiAnalysisKind = "node-health" | "resource-pressure" | "optimize" | "explain-error";

export interface AiProviderConfig {
  model: string;
  /** OpenAI-compatible base URL (e.g. https://api.openai.com/v1). Ignored for Anthropic. */
  baseUrl?: string;
}

export interface AiConfig {
  provider: AiProvider;
  anthropic: AiProviderConfig;
  openai: AiProviderConfig;
}

export interface AiStatus {
  provider: AiProvider;
  model: string;
  baseUrl?: string;
  /** Whether the active provider has an API key configured. */
  configured: boolean;
}

export interface AiAnalysisRequest {
  profileId: string;
  kind: AiAnalysisKind;
  /** Free-text input for the "explain-error" kind (e.g. a Proxmox error/log). */
  input?: string;
}

export interface AiAnalysisResult {
  kind: AiAnalysisKind;
  provider: AiProvider;
  model: string;
  /** Advisory analysis text. Recommendations require explicit user action. */
  text: string;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: "anthropic",
  anthropic: { model: "claude-opus-5" },
  openai: { model: "gpt-4o", baseUrl: "https://api.openai.com/v1" },
};
