/**
 * Optional AI administration layer types (spec §12).
 *
 * The AI layer is ADVISORY ONLY. It summarizes health/logs, explains errors,
 * identifies resource pressure and suggests safe optimizations. It MUST NOT
 * automatically execute destructive infrastructure actions (spec §12). Any
 * action a recommendation implies is performed by the user through the normal
 * confirmed VM/LXC controls — never by this layer.
 */

export type AiAnalysisKind = "node-health" | "resource-pressure" | "optimize" | "explain-error";

export interface AiStatus {
  configured: boolean;
  model: string;
}

export interface AiAnalysisRequest {
  profileId: string;
  kind: AiAnalysisKind;
  /** Free-text input for the "explain-error" kind (e.g. a Proxmox error/log). */
  input?: string;
}

export interface AiAnalysisResult {
  kind: AiAnalysisKind;
  model: string;
  /** Advisory analysis text. Recommendations require explicit user action. */
  text: string;
}
