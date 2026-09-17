/** Subscription-backed, advisory AI analysis through official vendor CLIs. */
export type AiProvider = "anthropic" | "openai";
export type AiAnalysisKind = "node-health" | "resource-pressure" | "optimize" | "explain-error";
export interface AiProviderConfig { model: string; }
export interface AiConfig { provider: AiProvider; anthropic: AiProviderConfig; openai: AiProviderConfig; }
export interface AiLocalUsage { requests: number; windowStartedAt?: string; resetsAt?: string; }
export interface AiStatus {
  provider: AiProvider;
  model: string;
  configured: boolean;
  cliInstalled: boolean;
  authMessage: string;
  localUsage: AiLocalUsage;
}
export interface AiAnalysisResult { kind: AiAnalysisKind; provider: AiProvider; model: string; text: string; }
export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: "anthropic",
  anthropic: { model: "" },
  openai: { model: "" },
};
