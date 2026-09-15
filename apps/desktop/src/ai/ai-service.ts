/**
 * Optional AI administration layer (spec §12).
 *
 * ADVISORY ONLY. This service sends read-only cluster summaries (never secrets)
 * to the Anthropic Messages API and returns analysis/recommendations as text.
 * It has NO tools and cannot execute any infrastructure action — the spec
 * requires: AI analysis -> recommendation -> USER approval -> validated action
 * -> Proxmox API. Execution always happens through the user-driven, confirmed
 * VM/LXC controls, never here (spec §12).
 *
 * The Anthropic API key is a secret and is stored encrypted via SecretStore
 * (spec §6.3, §21). It is never written to config or logs.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ConfigStore } from "../storage/config-store";
import { SecretStore } from "../storage/secret-store";
import { logger } from "../shared/logger";
import { ErrorCode, type AppError } from "../shared/types";
import type { ProxmoxService } from "../proxmox/proxmox-service";
import type { DashboardData } from "../proxmox/proxmox-types";
import type { AiAnalysisKind, AiAnalysisResult, AiStatus } from "./ai-types";

const AI_CONFIG_FILE = "ai-config";
const AI_SECRET_KEY = "ai-anthropic-api-key";
const DEFAULT_MODEL = "claude-opus-5";

export class AiError extends Error {
  constructor(public readonly appError: AppError) {
    super(appError.message);
    this.name = "AiError";
  }
}

interface AiConfig {
  model: string;
}

const SYSTEM_PROMPT = [
  "You are an assistant embedded in PVE Console, a desktop app for managing Proxmox VE.",
  "You provide read-only ANALYSIS and RECOMMENDATIONS only.",
  "You cannot and must not perform, trigger, or claim to perform any action on the",
  "infrastructure. Never say you have started, stopped, restarted, deleted, or changed",
  "anything. When you suggest an action, describe it as a recommendation the user must",
  "carry out themselves through the app's confirmed controls, and flag any destructive",
  "or service-interrupting step explicitly.",
  "Be concise and practical. If the data is insufficient, say so plainly rather than guessing.",
].join(" ");

export class AiService {
  constructor(
    private readonly secrets: SecretStore,
    private readonly config: ConfigStore,
    private readonly proxmox: ProxmoxService,
  ) {}

  private async readConfig(): Promise<AiConfig> {
    return this.config.readJson<AiConfig>(AI_CONFIG_FILE, { model: DEFAULT_MODEL });
  }

  async getStatus(): Promise<AiStatus> {
    const cfg = await this.readConfig();
    const key = await this.secrets.getSecret(AI_SECRET_KEY);
    return { configured: Boolean(key), model: cfg.model || DEFAULT_MODEL };
  }

  async setApiKey(apiKey: string): Promise<void> {
    if (!apiKey || apiKey.trim().length < 8) {
      throw new AiError({ code: ErrorCode.INTERNAL_ERROR, message: "A valid API key is required." });
    }
    if (!this.secrets.isAvailable()) {
      throw new AiError({
        code: ErrorCode.INTERNAL_ERROR,
        message: "OS secret storage is unavailable; cannot store the API key securely.",
      });
    }
    await this.secrets.setSecret(AI_SECRET_KEY, apiKey.trim());
    logger.info({ module: "ai", event: "api-key-set" });
  }

  async removeApiKey(): Promise<void> {
    await this.secrets.deleteSecret(AI_SECRET_KEY);
    logger.info({ module: "ai", event: "api-key-removed" });
  }

  private async client(): Promise<{ anthropic: Anthropic; model: string }> {
    const apiKey = await this.secrets.getSecret(AI_SECRET_KEY);
    if (!apiKey) {
      throw new AiError({
        code: ErrorCode.AUTH_ERROR,
        message: "The AI assistant is not configured. Add an Anthropic API key in Settings.",
      });
    }
    const cfg = await this.readConfig();
    return { anthropic: new Anthropic({ apiKey }), model: cfg.model || DEFAULT_MODEL };
  }

  private summarizeData(d: DashboardData): string {
    const pct = (f: number) => `${Math.round(f * 100)}%`;
    const nodes = d.nodes
      .map((n) => `- ${n.node} (${n.status}) cpu=${pct(n.cpu ?? 0)}`)
      .join("\n");
    const guests = d.guests
      .map((g) => `- ${g.vmid} ${g.name} [${g.type}] ${g.status}`)
      .join("\n");
    const storage = d.storage
      .map((s) => {
        const used = s.used ?? 0;
        const total = s.total ?? 0;
        const frac = total > 0 ? used / total : 0;
        return `- ${s.storage}@${s.node}: ${pct(frac)} used`;
      })
      .join("\n");
    return [
      `Cluster: nodes=${d.cluster.nodes} vms=${d.cluster.vms} lxc=${d.cluster.lxc} running=${d.cluster.running} stopped=${d.cluster.stopped}`,
      `Usage: CPU=${pct(d.cpuUsage)} RAM=${pct(d.memUsage)} Storage=${pct(d.storageUsage)}`,
      `Nodes:\n${nodes || "(none)"}`,
      `Guests:\n${guests || "(none)"}`,
      `Storage:\n${storage || "(none)"}`,
    ].join("\n\n");
  }

  private async buildPrompt(kind: AiAnalysisKind, profileId: string, input?: string): Promise<string> {
    if (kind === "explain-error") {
      const err = (input ?? "").trim();
      if (!err) throw new AiError({ code: ErrorCode.INTERNAL_ERROR, message: "Paste an error or log to explain." });
      return `Explain the following Proxmox error/log in plain terms and suggest safe troubleshooting steps the user could take:\n\n${err.slice(0, 6000)}`;
    }

    // The other kinds need read-only cluster context from the native API.
    const data = await this.proxmox.getSummary(profileId);
    const context = this.summarizeData(data);
    const task =
      kind === "node-health"
        ? "Summarize the health of these nodes and guests. Call out anything that looks unhealthy or at risk."
        : kind === "resource-pressure"
          ? "Identify any CPU, memory, or storage pressure and which nodes/guests are most affected."
          : "Suggest safe, reversible optimizations. Clearly mark anything that would interrupt services as requiring user confirmation.";
    return `${task}\n\nRead-only cluster snapshot:\n\n${context}`;
  }

  async analyze(profileId: string, kind: AiAnalysisKind, input?: string): Promise<AiAnalysisResult> {
    const prompt = await this.buildPrompt(kind, profileId, input);
    const { anthropic, model } = await this.client();

    try {
      const message = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      });
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      logger.info({ module: "ai", event: "analysis", detail: { kind, model } });
      return { kind, model, text: text || "(no response)" };
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        throw new AiError({
          code: err.status === 401 ? ErrorCode.AUTH_ERROR : ErrorCode.NETWORK_ERROR,
          message:
            err.status === 401
              ? "The Anthropic API key was rejected."
              : `AI request failed: ${err.message}`,
        });
      }
      throw new AiError({
        code: ErrorCode.NETWORK_ERROR,
        message: `AI request failed: ${(err as Error).message}`,
      });
    }
  }
}
